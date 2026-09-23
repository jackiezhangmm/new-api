package apimart

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func newAPIMartTaskContext(body string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	return c
}

func testAPIMartInfo() *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBaseUrl:    "https://api.apimart.ai",
			ApiKey:            "test-apimart-key",
			UpstreamModelName: ModelWan3Video,
		},
		TaskRelayInfo: &relaycommon.TaskRelayInfo{
			PublicTaskID: "task_public_test_123",
		},
	}
}

// 1. Duration validation
func TestValidateRequest_DurationBounds(t *testing.T) {
	adaptor := &TaskAdaptor{}

	tests := []struct {
		name        string
		body        string
		wantError   bool
		errContains string
		wantDur     int
	}{
		{
			name:      "duration -1 allowed (dynamic)",
			body:      `{"model":"wan3.0-video","prompt":"sunset","duration":-1}`,
			wantError: false,
			wantDur:   -1,
		},
		{
			name:      "duration 2 allowed (min bound)",
			body:      `{"model":"wan3.0-video","prompt":"sunset","duration":2}`,
			wantError: false,
			wantDur:   2,
		},
		{
			name:      "duration 5 allowed (default range)",
			body:      `{"model":"wan3.0-video","prompt":"sunset","duration":5}`,
			wantError: false,
			wantDur:   5,
		},
		{
			name:      "duration 30 allowed (max bound)",
			body:      `{"model":"wan3.0-video","prompt":"sunset","duration":30}`,
			wantError: false,
			wantDur:   30,
		},
		{
			name:      "duration omitted defaults to 5",
			body:      `{"model":"wan3.0-video","prompt":"sunset"}`,
			wantError: false,
			wantDur:   5,
		},
		{
			name:      "duration 0 defaults to 5",
			body:      `{"model":"wan3.0-video","prompt":"sunset","duration":0}`,
			wantError: false,
			wantDur:   5,
		},
		{
			name:      "seconds string parsed",
			body:      `{"model":"wan3.0-video","prompt":"sunset","seconds":"10"}`,
			wantError: false,
			wantDur:   10,
		},
		{
			name:        "duration 1 rejected (< min bound)",
			body:        `{"model":"wan3.0-video","prompt":"sunset","duration":1}`,
			wantError:   true,
			errContains: "duration must be -1 or between 2 and 30 seconds",
		},
		{
			name:        "duration 31 rejected (> max bound)",
			body:        `{"model":"wan3.0-video","prompt":"sunset","duration":31}`,
			wantError:   true,
			errContains: "duration must be -1 or between 2 and 30 seconds",
		},
		{
			name:        "duration -2 rejected (< -1)",
			body:        `{"model":"wan3.0-video","prompt":"sunset","duration":-2}`,
			wantError:   true,
			errContains: "duration must be -1 or between 2 and 30 seconds",
		},
		{
			name:        "duration non-number string rejected",
			body:        `{"model":"wan3.0-video","prompt":"sunset","duration":"invalid"}`,
			wantError:   true,
			errContains: "duration must be -1 or between 2 and 30 seconds",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newAPIMartTaskContext(tt.body)
			defer common.CleanupBodyStorage(c)
			info := testAPIMartInfo()

			err := adaptor.ValidateRequestAndSetAction(c, info)
			if tt.wantError {
				require.NotNil(t, err)
				assert.Equal(t, http.StatusBadRequest, err.StatusCode)
				assert.Contains(t, err.Message, tt.errContains)
			} else {
				require.Nil(t, err)
				v, exists := c.Get("apimart_req")
				require.True(t, exists)
				req := v.(*apimartSubmitRequest)
				assert.Equal(t, tt.wantDur, req.Duration)
			}
		})
	}
}

// 2. Resolution validation & normalization
func TestValidateRequest_ResolutionAndSize(t *testing.T) {
	adaptor := &TaskAdaptor{}

	tests := []struct {
		name      string
		body      string
		wantError bool
		wantRes   string
		wantSize  string
	}{
		{
			name:      "omitted resolution defaults to 1080P, size adaptive",
			body:      `{"model":"wan3.0-video","prompt":"landscape"}`,
			wantError: false,
			wantRes:   "1080P",
			wantSize:  "adaptive",
		},
		{
			name:      "lowercase 480p normalized to 480P",
			body:      `{"model":"wan3.0-video","prompt":"landscape","resolution":"480p","size":"16:9"}`,
			wantError: false,
			wantRes:   "480P",
			wantSize:  "16:9",
		},
		{
			name:      "lowercase 720p normalized to 720P, aspect_ratio used",
			body:      `{"model":"wan3.0-video","prompt":"landscape","resolution":"720p","aspect_ratio":"9:16"}`,
			wantError: false,
			wantRes:   "720P",
			wantSize:  "9:16",
		},
		{
			name:      "uppercase 1080P kept, size 1:1",
			body:      `{"model":"wan3.0-video","prompt":"landscape","resolution":"1080P","size":"1:1"}`,
			wantError: false,
			wantRes:   "1080P",
			wantSize:  "1:1",
		},
		{
			name:      "unsupported 4K rejected",
			body:      `{"model":"wan3.0-video","prompt":"landscape","resolution":"4K"}`,
			wantError: true,
		},
		{
			name:      "invalid resolution string rejected",
			body:      `{"model":"wan3.0-video","prompt":"landscape","resolution":"ultra"}`,
			wantError: true,
		},
		{
			name:      "invalid size string rejected",
			body:      `{"model":"wan3.0-video","prompt":"landscape","size":"21:9"}`,
			wantError: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newAPIMartTaskContext(tt.body)
			defer common.CleanupBodyStorage(c)
			info := testAPIMartInfo()

			err := adaptor.ValidateRequestAndSetAction(c, info)
			if tt.wantError {
				require.NotNil(t, err)
				assert.Equal(t, http.StatusBadRequest, err.StatusCode)
			} else {
				require.Nil(t, err)
				v, exists := c.Get("apimart_req")
				require.True(t, exists)
				req := v.(*apimartSubmitRequest)
				assert.Equal(t, tt.wantRes, req.Resolution)
				assert.Equal(t, tt.wantSize, req.Size)
			}
		})
	}
}

// 3. Out-of-scope document / webpage rejection
func TestValidateRequest_RejectOutOfScope(t *testing.T) {
	adaptor := &TaskAdaptor{}

	tests := []struct {
		name string
		body string
	}{
		{
			name: "file_url rejected",
			body: `{"model":"wan3.0-video","prompt":"make video","file_url":"https://example.com/doc.pdf"}`,
		},
		{
			name: "link_url rejected",
			body: `{"model":"wan3.0-video","prompt":"make video","link_url":"https://example.com/page"}`,
		},
		{
			name: "both file_url and link_url rejected",
			body: `{"model":"wan3.0-video","file_url":"https://example.com/doc.pdf","link_url":"https://example.com/page"}`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newAPIMartTaskContext(tt.body)
			defer common.CleanupBodyStorage(c)
			info := testAPIMartInfo()

			err := adaptor.ValidateRequestAndSetAction(c, info)
			require.NotNil(t, err)
			assert.Equal(t, http.StatusBadRequest, err.StatusCode)
			assert.Contains(t, err.Message, "file_url and link_url are not supported")
		})
	}
}

// 4. Materials attribution & mutual exclusivity
func TestValidateRequest_MaterialsMutualExclusivity(t *testing.T) {
	adaptor := &TaskAdaptor{}

	tests := []struct {
		name        string
		body        string
		wantError   bool
		errContains string
		wantAction  string
		wantGenType string
	}{
		{
			name:        "pure text-to-video",
			body:        `{"model":"wan3.0-video","prompt":"a cat running"}`,
			wantError:   false,
			wantAction:  constant.TaskActionTextGenerate,
			wantGenType: "",
		},
		{
			name:        "single bare image defaults to first_frame",
			body:        `{"model":"wan3.0-video","prompt":"animate this","image_urls":["https://example.com/1.png"]}`,
			wantError:   false,
			wantAction:  constant.TaskActionGenerate,
			wantGenType: GenerationTypeFrame,
		},
		{
			name:        "two bare images default to first and last frame",
			body:        `{"model":"wan3.0-video","prompt":"animate this","image_urls":["https://example.com/1.png","https://example.com/2.png"]}`,
			wantError:   false,
			wantAction:  constant.TaskActionGenerate,
			wantGenType: GenerationTypeFrame,
		},
		{
			name:        "three bare images with frame generation rejected (> 2 frames)",
			body:        `{"model":"wan3.0-video","prompt":"animate this","generation_type":"frame","image_urls":["https://example.com/1.png","https://example.com/2.png","https://example.com/3.png"]}`,
			wantError:   true,
			errContains: "frame generation supports at most 2 images",
		},
		{
			name:        "three bare images with reference generation allowed",
			body:        `{"model":"wan3.0-video","prompt":"animate this","generation_type":"reference","image_urls":["https://example.com/1.png","https://example.com/2.png","https://example.com/3.png"]}`,
			wantError:   false,
			wantAction:  constant.TaskActionGenerate,
			wantGenType: GenerationTypeReference,
		},
		{
			name:        "bare images with video_urls auto attribute to reference",
			body:        `{"model":"wan3.0-video","prompt":"multi-modal","image_urls":["https://example.com/1.png","https://example.com/2.png"],"video_urls":["https://example.com/v.mp4"]}`,
			wantError:   false,
			wantAction:  constant.TaskActionGenerate,
			wantGenType: GenerationTypeReference,
		},
		{
			name: "explicit image_with_roles frame family allowed",
			body: `{"model":"wan3.0-video","prompt":"interpolate","image_with_roles":[{"url":"https://example.com/1.png","role":"first_frame"},{"url":"https://example.com/2.png","role":"last_frame"}]}`,
			wantError:   false,
			wantAction:  constant.TaskActionGenerate,
			wantGenType: GenerationTypeFrame,
		},
		{
			name: "mixed frame and reference in image_with_roles rejected",
			body: `{"model":"wan3.0-video","prompt":"interpolate","image_with_roles":[{"url":"https://example.com/1.png","role":"first_frame"},{"url":"https://example.com/2.png","role":"reference_image"}]}`,
			wantError:   true,
			errContains: "cannot mix frame materials",
		},
		{
			name: "first_frame mixed with video_urls rejected",
			body: `{"model":"wan3.0-video","prompt":"mix","image_with_roles":[{"url":"https://example.com/1.png","role":"first_frame"}],"video_urls":["https://example.com/v.mp4"]}`,
			wantError:   true,
			errContains: "cannot mix frame materials",
		},
		{
			name: "last_frame mixed with audio_urls rejected",
			body: `{"model":"wan3.0-video","prompt":"mix","image_with_roles":[{"url":"https://example.com/2.png","role":"last_frame"}],"audio_urls":["https://example.com/a.mp3"]}`,
			wantError:   true,
			errContains: "cannot mix frame materials",
		},
		{
			name: "first_frame bare image and last_frame in image_with_roles combine cleanly",
			body: `{"model":"wan3.0-video","prompt":"interpolate","image_urls":["https://example.com/first.png"],"image_with_roles":[{"url":"https://example.com/last.png","role":"last_frame"}]}`,
			wantError:   false,
			wantAction:  constant.TaskActionGenerate,
			wantGenType: GenerationTypeFrame,
		},
		{
			name:        "empty prompt and empty materials rejected",
			body:        `{"model":"wan3.0-video"}`,
			wantError:   true,
			errContains: "prompt or material is required",
		},
		{
			name:        "empty prompt with valid material allowed",
			body:        `{"model":"wan3.0-video","image_urls":["https://example.com/1.png"]}`,
			wantError:   false,
			wantAction:  constant.TaskActionGenerate,
			wantGenType: GenerationTypeFrame,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newAPIMartTaskContext(tt.body)
			defer common.CleanupBodyStorage(c)
			info := testAPIMartInfo()

			err := adaptor.ValidateRequestAndSetAction(c, info)
			if tt.wantError {
				require.NotNil(t, err)
				assert.Equal(t, http.StatusBadRequest, err.StatusCode)
				assert.Contains(t, err.Message, tt.errContains)
			} else {
				require.Nil(t, err)
				assert.Equal(t, tt.wantAction, info.Action)
				v, exists := c.Get("apimart_req")
				require.True(t, exists)
				req := v.(*apimartSubmitRequest)
				assert.Equal(t, tt.wantGenType, req.GenerationType)
			}
		})
	}
}

// 5. Upstream Request Body Serialization
func TestBuildRequestBody(t *testing.T) {
	adaptor := &TaskAdaptor{}
	bodyJSON := `{
		"model": "wan3.0-video",
		"prompt": "一只小猫奔跑",
		"resolution": "720p",
		"size": "16:9",
		"duration": 5,
		"seed": 42,
		"image_urls": ["https://example.com/cat.png"]
	}`

	c := newAPIMartTaskContext(bodyJSON)
	defer common.CleanupBodyStorage(c)
	info := testAPIMartInfo()

	taskErr := adaptor.ValidateRequestAndSetAction(c, info)
	require.Nil(t, taskErr)

	reader, err := adaptor.BuildRequestBody(c, info)
	require.NoError(t, err)

	data, err := io.ReadAll(reader)
	require.NoError(t, err)

	var result map[string]any
	require.NoError(t, common.Unmarshal(data, &result))

	assert.Equal(t, "wan3.0-video", result["model"])
	assert.Equal(t, "一只小猫奔跑", result["prompt"])
	assert.Equal(t, "720P", result["resolution"])
	assert.Equal(t, "16:9", result["size"])
	assert.Equal(t, float64(5), result["duration"])
	assert.Equal(t, float64(42), result["seed"])
	assert.Equal(t, "frame", result["generation_type"])

	imgURLs, ok := result["image_urls"].([]any)
	require.True(t, ok)
	require.Len(t, imgURLs, 1)
	assert.Equal(t, "https://example.com/cat.png", imgURLs[0])
}

func TestBuildRequestBody_CombinesFrameMaterials(t *testing.T) {
	adaptor := &TaskAdaptor{}
	bodyJSON := `{
		"model": "wan3.0-video",
		"prompt": "interpolate between frames",
		"image_urls": ["https://example.com/first.png"],
		"image_with_roles": [{"url":"https://example.com/last.png","role":"last_frame"}]
	}`

	c := newAPIMartTaskContext(bodyJSON)
	defer common.CleanupBodyStorage(c)
	info := testAPIMartInfo()

	taskErr := adaptor.ValidateRequestAndSetAction(c, info)
	require.Nil(t, taskErr)

	reader, err := adaptor.BuildRequestBody(c, info)
	require.NoError(t, err)

	data, err := io.ReadAll(reader)
	require.NoError(t, err)

	var result map[string]any
	require.NoError(t, common.Unmarshal(data, &result))

	roles, ok := result["image_with_roles"].([]any)
	require.True(t, ok)
	require.Len(t, roles, 2)
	assert.Equal(t, "first_frame", roles[0].(map[string]any)["role"])
	assert.Equal(t, "https://example.com/first.png", roles[0].(map[string]any)["url"])
	assert.Equal(t, "last_frame", roles[1].(map[string]any)["role"])
	assert.Equal(t, "https://example.com/last.png", roles[1].(map[string]any)["url"])
}

// 6. Upfront Billing Estimation
func TestEstimateBilling(t *testing.T) {
	adaptor := &TaskAdaptor{}

	tests := []struct {
		name         string
		body         string
		wantSeconds  float64
		wantResKey   string
		wantResRatio float64
		wantDynamic  bool
	}{
		{
			name:         "480P 5 seconds",
			body:         `{"model":"wan3.0-video","prompt":"test","resolution":"480P","duration":5}`,
			wantSeconds:  5.0,
			wantResKey:   "resolution-480P",
			wantResRatio: 1.0,
			wantDynamic:  false,
		},
		{
			name:         "720P 10 seconds",
			body:         `{"model":"wan3.0-video","prompt":"test","resolution":"720P","duration":10}`,
			wantSeconds:  10.0,
			wantResKey:   "resolution-720P",
			wantResRatio: 2.0,
			wantDynamic:  false,
		},
		{
			name:         "1080P 5 seconds (default)",
			body:         `{"model":"wan3.0-video","prompt":"test","resolution":"1080P","duration":5}`,
			wantSeconds:  5.0,
			wantResKey:   "resolution-1080P",
			wantResRatio: 4.0,
			wantDynamic:  false,
		},
		{
			name:         "dynamic duration -1 caps to 30 seconds for pre-charge",
			body:         `{"model":"wan3.0-video","prompt":"test","resolution":"1080P","duration":-1}`,
			wantSeconds:  30.0,
			wantResKey:   "resolution-1080P",
			wantResRatio: 4.0,
			wantDynamic:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newAPIMartTaskContext(tt.body)
			defer common.CleanupBodyStorage(c)
			info := testAPIMartInfo()

			err := adaptor.ValidateRequestAndSetAction(c, info)
			require.Nil(t, err)

			ratios := adaptor.EstimateBilling(c, info)
			require.NotNil(t, ratios)
			assert.Equal(t, tt.wantSeconds, ratios["seconds"])
			assert.Equal(t, tt.wantResRatio, ratios[tt.wantResKey])

			if tt.wantDynamic {
				assert.Equal(t, 1.0, ratios["dynamic_duration"])
			} else {
				_, hasDynamic := ratios["dynamic_duration"]
				assert.False(t, hasDynamic)
			}
		})
	}
}

// 7. Dynamic Duration Settlement on Task Completion
func TestAdjustBillingOnComplete(t *testing.T) {
	adaptor := &TaskAdaptor{}

	// Helper to create task with billing context
	// ModelRatio = 0.3 -> baseQuota = 0.3 / 2 * 500000 * 1.0 = 75000
	// 1080P ratio = 4.0
	// For 30s pre-charge: quota = 75000 * 30 * 4 = 9,000,000
	createDynamicTask := func(preConsumedQuota int) *model.Task {
		task := &model.Task{
			TaskID: "task_test_dynamic_123",
			Quota:  preConsumedQuota,
		}
		task.PrivateData.BillingContext = &model.TaskBillingContext{
			ModelRatio:      0.3,
			GroupRatio:      1.0,
			OriginModelName: "wan3.0-video",
			PerCallBilling:  false,
			OtherRatios: map[string]float64{
				"seconds":          30.0,
				"resolution-1080P": 4.0,
				"dynamic_duration": 1.0,
			},
		}
		return task
	}

	t.Run("dynamic duration completed with 5s produces quota for 5s", func(t *testing.T) {
		task := createDynamicTask(9000000)
		taskResult := &relaycommon.TaskInfo{
			Status:   string(model.TaskStatusSuccess),
			Duration: 5,
		}

		actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult)
		// Expected: 75000 * 5 * 4 = 1,500,000
		assert.Equal(t, 1500000, actualQuota)
	})

	t.Run("dynamic duration completed with 30s produces quota for 30s", func(t *testing.T) {
		task := createDynamicTask(9000000)
		taskResult := &relaycommon.TaskInfo{
			Status:   string(model.TaskStatusSuccess),
			Duration: 30,
		}

		actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult)
		// Expected: 75000 * 30 * 4 = 9,000,000
		assert.Equal(t, 9000000, actualQuota)
	})

	t.Run("dynamic duration clamped if upstream returns duration < 2", func(t *testing.T) {
		task := createDynamicTask(9000000)
		taskResult := &relaycommon.TaskInfo{
			Status:   string(model.TaskStatusSuccess),
			Duration: 1, // < 2, should clamp to 2
		}

		actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult)
		// Expected: 75000 * 2 * 4 = 600,000
		assert.Equal(t, 600000, actualQuota)
	})

	t.Run("dynamic duration clamped if upstream returns duration > 30", func(t *testing.T) {
		task := createDynamicTask(9000000)
		taskResult := &relaycommon.TaskInfo{
			Status:   string(model.TaskStatusSuccess),
			Duration: 45, // > 30, should clamp to 30
		}

		actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult)
		// Expected: 75000 * 30 * 4 = 9,000,000
		assert.Equal(t, 9000000, actualQuota)
	})

	t.Run("fallback to task data when taskResult Duration is 0", func(t *testing.T) {
		task := createDynamicTask(9000000)
		task.Data = []byte(`{"data":{"usage":{"duration":10}}}`)
		taskResult := &relaycommon.TaskInfo{
			Status: string(model.TaskStatusSuccess),
		}

		actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult)
		// Expected: 75000 * 10 * 4 = 3,000,000
		assert.Equal(t, 3000000, actualQuota)
	})

	t.Run("fixed duration task returns 0 (no adjustment)", func(t *testing.T) {
		task := &model.Task{
			TaskID: "task_test_fixed_123",
			Quota:  1500000,
		}
		task.PrivateData.BillingContext = &model.TaskBillingContext{
			ModelRatio:      0.3,
			GroupRatio:      1.0,
			OriginModelName: "wan3.0-video",
			PerCallBilling:  false,
			OtherRatios: map[string]float64{
				"seconds":          5.0,
				"resolution-1080P": 4.0,
			},
		}
		taskResult := &relaycommon.TaskInfo{
			Status:   string(model.TaskStatusSuccess),
			Duration: 5,
		}

		actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult)
		assert.Equal(t, 0, actualQuota)
	})

	t.Run("per call billing task returns 0", func(t *testing.T) {
		task := createDynamicTask(9000000)
		task.PrivateData.BillingContext.PerCallBilling = true
		taskResult := &relaycommon.TaskInfo{
			Status:   string(model.TaskStatusSuccess),
			Duration: 5,
		}

		actualQuota := adaptor.AdjustBillingOnComplete(task, taskResult)
		assert.Equal(t, 0, actualQuota)
	})
}

// 8. Defensive Upstream Result Parsing
func TestParseTaskResult(t *testing.T) {
	adaptor := &TaskAdaptor{}

	t.Run("completed task with string array videos", func(t *testing.T) {
		body := []byte(`{
			"code": 200,
			"data": {
				"id": "task_01KA040M0HP1GJWBJYZMKX1XS1",
				"status": "completed",
				"progress": 100,
				"result": {
					"videos": ["https://cdn.example.com/output.mp4"]
				},
				"usage": {
					"duration": 5
				}
			}
		}`)

		info, err := adaptor.ParseTaskResult(body)
		require.NoError(t, err)
		assert.Equal(t, "task_01KA040M0HP1GJWBJYZMKX1XS1", info.TaskID)
		assert.Equal(t, string(model.TaskStatusSuccess), info.Status)
		assert.Equal(t, "100%", info.Progress)
		assert.Equal(t, "https://cdn.example.com/output.mp4", info.Url)
		assert.Equal(t, 5, info.Duration)
	})

	t.Run("completed task with object array videos", func(t *testing.T) {
		body := []byte(`{
			"code": 200,
			"data": {
				"id": "task_01KA040M0HP1GJWBJYZMKX1XS1",
				"status": "completed",
				"progress": 100,
				"result": {
					"videos": [{"url": "https://cdn.example.com/output2.mp4"}]
				},
				"actual_time": 8
			}
		}`)

		info, err := adaptor.ParseTaskResult(body)
		require.NoError(t, err)
		assert.Equal(t, string(model.TaskStatusSuccess), info.Status)
		assert.Equal(t, "https://cdn.example.com/output2.mp4", info.Url)
		assert.Equal(t, 8, info.Duration)
	})

	t.Run("completed task with nested url array", func(t *testing.T) {
		body := []byte(`{
			"code": 200,
			"data": {
				"id": "task_01KA040M0HP1GJWBJYZMKX1XS1",
				"status": "succeeded",
				"progress": 100,
				"result": {
					"videos": [{"url": ["https://cdn.example.com/output3.mp4"]}]
				}
			}
		}`)

		info, err := adaptor.ParseTaskResult(body)
		require.NoError(t, err)
		assert.Equal(t, string(model.TaskStatusSuccess), info.Status)
		assert.Equal(t, "https://cdn.example.com/output3.mp4", info.Url)
	})

	t.Run("processing task status and progress", func(t *testing.T) {
		body := []byte(`{
			"code": 200,
			"data": {
				"id": "task_01KA040M0HP1GJWBJYZMKX1XS1",
				"status": "processing",
				"progress": 45
			}
		}`)

		info, err := adaptor.ParseTaskResult(body)
		require.NoError(t, err)
		assert.Equal(t, string(model.TaskStatusInProgress), info.Status)
		assert.Equal(t, "45%", info.Progress)
	})

	t.Run("failed task with error object", func(t *testing.T) {
		body := []byte(`{
			"code": 200,
			"data": {
				"id": "task_01KA040M0HP1GJWBJYZMKX1XS1",
				"status": "failed",
				"error": {
					"code": 400,
					"message": "input video too long",
					"type": "invalid_parameter"
				}
			}
		}`)

		info, err := adaptor.ParseTaskResult(body)
		require.NoError(t, err)
		assert.Equal(t, string(model.TaskStatusFailure), info.Status)
		assert.Equal(t, "input video too long", info.Reason)
	})

	t.Run("top level error response", func(t *testing.T) {
		body := []byte(`{
			"error": {
				"code": 401,
				"message": "身份验证失败",
				"type": "authentication_error"
			}
		}`)

		info, err := adaptor.ParseTaskResult(body)
		require.NoError(t, err)
		assert.Equal(t, "FAILURE", info.Status)
		assert.Equal(t, "身份验证失败", info.Reason)
	})
}

// 9. ConvertToOpenAIVideo Formatting
func TestConvertToOpenAIVideo(t *testing.T) {
	adaptor := &TaskAdaptor{}

	t.Run("success task converted to OpenAI video", func(t *testing.T) {
		task := &model.Task{
			TaskID:     "task_pub_999",
			Status:     model.TaskStatusSuccess,
			Progress:   "100%",
			CreatedAt:  1700000000,
			FinishTime: 1700000060,
			Properties: model.Properties{
				OriginModelName: "wan3.0-video",
			},
			Data: []byte(`{"data":{"usage":{"duration":5}}}`),
		}
		task.PrivateData.ResultURL = "https://cdn.example.com/video.mp4"

		data, err := adaptor.ConvertToOpenAIVideo(task)
		require.NoError(t, err)

		var video dto.OpenAIVideo
		require.NoError(t, common.Unmarshal(data, &video))

		assert.Equal(t, "task_pub_999", video.ID)
		assert.Equal(t, dto.VideoStatusCompleted, video.Status)
		assert.Equal(t, "wan3.0-video", video.Model)
		assert.Equal(t, 100, video.Progress)
		assert.Equal(t, int64(1700000000), video.CreatedAt)
		assert.Equal(t, int64(1700000060), video.CompletedAt)
		assert.Equal(t, "https://cdn.example.com/video.mp4", video.Metadata["url"])
		assert.Equal(t, "5", video.Seconds)
		assert.Nil(t, video.Error)
	})

	t.Run("failed task converted to OpenAI video with error", func(t *testing.T) {
		task := &model.Task{
			TaskID:     "task_pub_fail",
			Status:     model.TaskStatusFailure,
			Progress:   "100%",
			CreatedAt:  1700000000,
			FinishTime: 1700000010,
			FailReason: "generation timed out",
			Properties: model.Properties{
				OriginModelName: "wan3.0-video",
			},
		}

		data, err := adaptor.ConvertToOpenAIVideo(task)
		require.NoError(t, err)

		var video dto.OpenAIVideo
		require.NoError(t, common.Unmarshal(data, &video))

		assert.Equal(t, "task_pub_fail", video.ID)
		assert.Equal(t, dto.VideoStatusFailed, video.Status)
		require.NotNil(t, video.Error)
		assert.Equal(t, "generation timed out", video.Error.Message)
		assert.Equal(t, "task_failed", video.Error.Code)
	})
}

// 10. DoResponse handling
func TestDoResponse(t *testing.T) {
	adaptor := &TaskAdaptor{}

	t.Run("array data submit response", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)

		info := testAPIMartInfo()
		resp := &http.Response{
			StatusCode: http.StatusOK,
			Body: io.NopCloser(bytes.NewBufferString(`{
				"code": 200,
				"data": [
					{
						"status": "submitted",
						"task_id": "task_upstream_abc123"
					}
				]
			}`)),
		}

		taskID, taskData, taskErr := adaptor.DoResponse(c, resp, info)
		require.Nil(t, taskErr)
		assert.Equal(t, "task_upstream_abc123", taskID)
		assert.NotEmpty(t, taskData)

		var openAIResp dto.OpenAIVideo
		require.NoError(t, common.Unmarshal(w.Body.Bytes(), &openAIResp))
		assert.Equal(t, "task_public_test_123", openAIResp.ID)
		assert.Equal(t, dto.VideoStatusQueued, openAIResp.Status)
	})

	t.Run("object data submit response", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)

		info := testAPIMartInfo()
		resp := &http.Response{
			StatusCode: http.StatusOK,
			Body: io.NopCloser(bytes.NewBufferString(`{
				"code": 200,
				"data": {
					"status": "submitted",
					"task_id": "task_upstream_xyz789"
				}
			}`)),
		}

		taskID, taskData, taskErr := adaptor.DoResponse(c, resp, info)
		require.Nil(t, taskErr)
		assert.Equal(t, "task_upstream_xyz789", taskID)
		assert.NotEmpty(t, taskData)
	})

	t.Run("error response status 400", func(t *testing.T) {
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		c.Request = httptest.NewRequest(http.MethodPost, "/v1/videos", nil)

		info := testAPIMartInfo()
		resp := &http.Response{
			StatusCode: http.StatusBadRequest,
			Body: io.NopCloser(bytes.NewBufferString(`{
				"error": {
					"code": 400,
					"message": "请求参数无效",
					"type": "invalid_request_error"
				}
			}`)),
		}

		_, _, taskErr := adaptor.DoResponse(c, resp, info)
		require.NotNil(t, taskErr)
		assert.Equal(t, http.StatusBadRequest, taskErr.StatusCode)
		assert.Contains(t, taskErr.Message, "请求参数无效")
	})
}
