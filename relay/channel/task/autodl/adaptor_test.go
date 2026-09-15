package autodl

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newTaskContext(body string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}

func autoDLInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl:    "https://autodl.art",
			ApiKey:            "autodl-token",
			UpstreamModelName: "minimax_h3_zm_u24",
		},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{},
	}
}

func TestValidateRequestAndSetActionRequiresImageAndBoundsDuration(t *testing.T) {
	tests := []struct {
		name string
		body string
		code string
	}{
		{name: "missing image", body: `{"prompt":"make a video"}`, code: "missing_image"},
		{name: "duration too short", body: `{"prompt":"make a video","image":"https://example.com/a.png","duration":-1}`, code: "invalid_seconds"},
		{name: "duration too long", body: `{"prompt":"make a video","image":"https://example.com/a.png","duration":16}`, code: "invalid_duration"},
		{name: "metadata bypass", body: `{"prompt":"make a video","image":"https://example.com/a.png","metadata":{"duration":16}}`, code: "invalid_duration"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTaskContext(tt.body)
			defer common.CleanupBodyStorage(c)
			err := (&TaskAdaptor{}).ValidateRequestAndSetAction(c, autoDLInfo())
			require.NotNil(t, err)
			assert.Equal(t, tt.code, err.Code)
			assert.Equal(t, http.StatusBadRequest, err.StatusCode)
		})
	}

	c := newTaskContext(`{"prompt":"make a video","image":"https://example.com/a.png","duration":0}`)
	defer common.CleanupBodyStorage(c)
	info := autoDLInfo()
	require.Nil(t, (&TaskAdaptor{}).ValidateRequestAndSetAction(c, info))
	require.Equal(t, constant.TaskActionGenerate, info.Action)
}

func TestBuildRequestBodyMapsAutoDLFields(t *testing.T) {
	c := newTaskContext(`{"prompt":"make a video","image":" https://example.com/a.png ","seed":0,"metadata":{"resolution":"768p竖","ref_image_1":"image-1","ref_audio_0":"audio-0","ref_image_8":"image-8"}}`)
	defer common.CleanupBodyStorage(c)
	req := relaycommon.TaskSubmitReq{
		Prompt: "make a video",
		Image:  " https://example.com/a.png ",
		Seed:   func() *int64 { v := int64(0); return &v }(),
		Metadata: map[string]interface{}{
			"resolution": "768p竖", "ref_image_1": "image-1", "ref_audio_0": "audio-0", "ref_image_8": "image-8",
		},
	}
	c.Set("task_request", req)

	body, err := (&TaskAdaptor{}).BuildRequestBody(c, autoDLInfo())
	require.NoError(t, err)
	data, err := io.ReadAll(body)
	require.NoError(t, err)
	var payload requestPayload
	require.NoError(t, common.Unmarshal(data, &payload))
	require.Equal(t, "make a video", payload.Prompt)
	require.Equal(t, 5, payload.Duration)
	require.Equal(t, "https://example.com/a.png", payload.RefImage0)
	require.NotNil(t, payload.Seed)
	require.Equal(t, int64(0), *payload.Seed)
	require.NotNil(t, payload.Resolution)
	require.Equal(t, "768p竖", *payload.Resolution)
	require.Equal(t, "image-1", *payload.RefImage1)
	require.Equal(t, "image-8", *payload.RefImage8)
	require.Equal(t, "audio-0", *payload.RefAudio0)
}

func TestAutoDLURLHeaderAndBilling(t *testing.T) {
	adaptor := &TaskAdaptor{baseURL: "https://autodl.art/", apiKey: "secret"}
	info := autoDLInfo()
	url, err := adaptor.BuildRequestURL(info)
	require.NoError(t, err)
	assert.Equal(t, "https://autodl.art/api/v1/comfyui/comfyui_workflow/minimax_h3_zm_u24", url)

	req := httptest.NewRequest(http.MethodPost, url, nil)
	require.NoError(t, adaptor.BuildRequestHeader(nil, req, info))
	assert.Equal(t, "secret", req.Header.Get("Authorization"))
	assert.Equal(t, "application/json", req.Header.Get("Content-Type"))

	c := newTaskContext(`{"prompt":"make a video","image":"image","duration":10,"metadata":{"resolution":"480p竖"}}`)
	defer common.CleanupBodyStorage(c)
	require.Nil(t, adaptor.ValidateRequestAndSetAction(c, info))
	info.ChannelOtherSettings.ResolutionRatios = map[string]float64{"480p竖": 0.6}
	assert.Equal(t, map[string]float64{"seconds": 10, "resolution": 0.6}, adaptor.EstimateBilling(c, info))

	fallback := newTaskContext(`{"prompt":"make a video","image":"image","duration":10,"metadata":{"resolution":"720p竖"}}`)
	defer common.CleanupBodyStorage(fallback)
	require.Nil(t, adaptor.ValidateRequestAndSetAction(fallback, info))
	assert.Equal(t, map[string]float64{"seconds": 10, "resolution": 1.0}, adaptor.EstimateBilling(fallback, info))
}

func TestParseTaskResultMapsAutoDLStatuses(t *testing.T) {
	tests := []struct {
		status string
		want   string
	}{
		{"QUEUED", model.TaskStatusInProgress},
		{"RUNNING", model.TaskStatusInProgress},
		{"SUCCESS", model.TaskStatusSuccess},
		{"FAILED", model.TaskStatusFailure},
	}
	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			body := `{"data":{"status":"` + tt.status + `","results":["https://example.com/video.mp4"],"message":"failed"}}`
			result, err := (&TaskAdaptor{}).ParseTaskResult([]byte(body))
			require.NoError(t, err)
			assert.Equal(t, tt.want, result.Status)
			if tt.status == "SUCCESS" {
				assert.Equal(t, "https://example.com/video.mp4", result.Url)
			}
		})
	}
}

func TestDoResponseAndFetchTask(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/comfyui/comfyui_workflow/result/task-1", r.URL.Path)
		assert.Equal(t, "token", r.Header.Get("Authorization"))
		_, _ = w.Write([]byte(`{"data":{"task_id":"task-1","status":"RUNNING"}}`))
	}))
	defer server.Close()

	adaptor := &TaskAdaptor{}
	resp, err := adaptor.FetchTask(server.URL, "token", map[string]any{"task_id": "task-1"}, "")
	require.NoError(t, err)
	defer resp.Body.Close()
	result, err := io.ReadAll(resp.Body)
	require.NoError(t, err)
	assert.Contains(t, string(result), `"RUNNING"`)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	info := autoDLInfo()
	info.PublicTaskID = "task_public"
	response := &http.Response{Body: io.NopCloser(strings.NewReader(`{"code":"Success","data":{"task_id":"upstream-1"}}`))}
	taskID, data, taskErr := adaptor.DoResponse(c, response, info)
	require.Nil(t, taskErr)
	assert.Equal(t, "upstream-1", taskID)
	assert.NotEmpty(t, data)
	assert.Equal(t, http.StatusOK, recorder.Code)
}

func TestDoResponseRejectsBusinessError(t *testing.T) {
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	response := &http.Response{Body: io.NopCloser(strings.NewReader(`{"code":"Error","msg":"workflow rejected"}`))}

	_, _, taskErr := (&TaskAdaptor{}).DoResponse(c, response, autoDLInfo())
	require.NotNil(t, taskErr)
	assert.Equal(t, "autodl_api_error", taskErr.Code)
	assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
}

func TestConvertToOpenAIVideo(t *testing.T) {
	task := &model.Task{TaskID: "task_public", Status: model.TaskStatusSuccess, Progress: "100%", Data: []byte(`{"data":{"status":"SUCCESS","results":["https://example.com/video.mp4"]}}`)}
	data, err := (&TaskAdaptor{}).ConvertToOpenAIVideo(task)
	require.NoError(t, err)
	assert.Contains(t, string(data), "https://example.com/video.mp4")
}
