package autodl

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	taskdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	taskcommon "github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

const (
	channelName     = "AutoDL"
	defaultDuration = 5
	maxDuration     = 15
)

var modelList = []string{"minimax_h3_zm_u24"}

type requestPayload struct {
	Prompt     string  `json:"prompt"`
	Duration   int     `json:"duration"`
	RefImage0  string  `json:"ref_image_0"`
	Seed       *int64  `json:"seed,omitempty"`
	Resolution *string `json:"resolution,omitempty"`
	RefImage1  *string `json:"ref_image_1,omitempty"`
	RefImage2  *string `json:"ref_image_2,omitempty"`
	RefImage3  *string `json:"ref_image_3,omitempty"`
	RefImage4  *string `json:"ref_image_4,omitempty"`
	RefImage5  *string `json:"ref_image_5,omitempty"`
	RefImage6  *string `json:"ref_image_6,omitempty"`
	RefImage7  *string `json:"ref_image_7,omitempty"`
	RefImage8  *string `json:"ref_image_8,omitempty"`
	RefAudio0  *string `json:"ref_audio_0,omitempty"`
	RefAudio1  *string `json:"ref_audio_1,omitempty"`
	RefAudio2  *string `json:"ref_audio_2,omitempty"`
}

type metadataFields struct {
	Duration   *int    `json:"duration,omitempty"`
	Resolution *string `json:"resolution,omitempty"`
	RefImage1  *string `json:"ref_image_1,omitempty"`
	RefImage2  *string `json:"ref_image_2,omitempty"`
	RefImage3  *string `json:"ref_image_3,omitempty"`
	RefImage4  *string `json:"ref_image_4,omitempty"`
	RefImage5  *string `json:"ref_image_5,omitempty"`
	RefImage6  *string `json:"ref_image_6,omitempty"`
	RefImage7  *string `json:"ref_image_7,omitempty"`
	RefImage8  *string `json:"ref_image_8,omitempty"`
	RefAudio0  *string `json:"ref_audio_0,omitempty"`
	RefAudio1  *string `json:"ref_audio_1,omitempty"`
	RefAudio2  *string `json:"ref_audio_2,omitempty"`
}

type submitResponse struct {
	Code string `json:"code"`
	Data struct {
		TaskID string `json:"task_id"`
	} `json:"data"`
	Message string `json:"msg"`
}

type resultResponse struct {
	Code string `json:"code"`
	Data struct {
		TaskID  string          `json:"task_id"`
		Status  string          `json:"status"`
		Results json.RawMessage `json:"results"`
		Message string          `json:"message"`
	} `json:"data"`
	Message string `json:"msg"`
}

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.apiKey = info.ApiKey
	a.baseURL = info.ChannelBaseUrl
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *taskdto.TaskError {
	if err := relaycommon.ValidateBasicTaskRequest(c, info, constant.TaskActionGenerate); err != nil {
		return err
	}
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return service.TaskErrorWrapper(err, "get_task_request_failed", http.StatusBadRequest)
	}
	image := strings.TrimSpace(req.Image)
	if image == "" && len(req.Images) > 0 {
		image = strings.TrimSpace(req.Images[0])
	}
	if image == "" {
		return service.TaskErrorWrapperLocal(fmt.Errorf("image is required"), "missing_image", http.StatusBadRequest)
	}
	if _, err := requestDuration(req); err != nil {
		return service.TaskErrorWrapperLocal(err, "invalid_duration", http.StatusBadRequest)
	}
	info.Action = constant.TaskActionGenerate
	return nil
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	if info == nil || strings.TrimSpace(info.UpstreamModelName) == "" {
		return "", fmt.Errorf("workflow id is required")
	}
	return fmt.Sprintf("%s/api/v1/comfyui/comfyui_workflow/%s", strings.TrimRight(a.baseURL, "/"), url.PathEscape(info.UpstreamModelName)), nil
}

func (a *TaskAdaptor) BuildRequestHeader(_ *gin.Context, req *http.Request, _ *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, _ *relaycommon.RelayInfo) (io.Reader, error) {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil, err
	}
	body, err := a.requestPayload(req)
	if err != nil {
		return nil, errors.Wrap(err, "build autodl request payload failed")
	}
	data, err := common.Marshal(body)
	if err != nil {
		return nil, err
	}
	return bytes.NewReader(data), nil
}

func (a *TaskAdaptor) requestPayload(req relaycommon.TaskSubmitReq) (*requestPayload, error) {
	duration, err := requestDuration(req)
	if err != nil {
		return nil, err
	}
	metadata := metadataFields{}
	if err := req.UnmarshalMetadata(&metadata); err != nil {
		return nil, err
	}
	image := strings.TrimSpace(req.Image)
	if image == "" && len(req.Images) > 0 {
		image = strings.TrimSpace(req.Images[0])
	}
	return &requestPayload{
		Prompt: req.Prompt, Duration: duration, RefImage0: image, Seed: req.Seed,
		Resolution: metadata.Resolution,
		RefImage1:  metadata.RefImage1, RefImage2: metadata.RefImage2, RefImage3: metadata.RefImage3,
		RefImage4: metadata.RefImage4, RefImage5: metadata.RefImage5, RefImage6: metadata.RefImage6,
		RefImage7: metadata.RefImage7, RefImage8: metadata.RefImage8,
		RefAudio0: metadata.RefAudio0, RefAudio1: metadata.RefAudio1, RefAudio2: metadata.RefAudio2,
	}, nil
}

func requestDuration(req relaycommon.TaskSubmitReq) (int, error) {
	duration := req.Duration
	metadata := metadataFields{}
	if err := req.UnmarshalMetadata(&metadata); err != nil {
		return 0, err
	}
	if metadata.Duration != nil {
		duration = *metadata.Duration
	}
	if duration == 0 {
		return defaultDuration, nil
	}
	if duration < 1 || duration > maxDuration {
		return 0, fmt.Errorf("duration must be between 1 and %d", maxDuration)
	}
	return duration, nil
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *taskdto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", nil, service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
	}
	_ = resp.Body.Close()

	var response submitResponse
	if err := common.Unmarshal(responseBody, &response); err != nil {
		return "", nil, service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
	}
	if response.Code != "" && !strings.EqualFold(response.Code, "success") {
		message := response.Message
		if message == "" {
			message = response.Code
		}
		return "", nil, service.TaskErrorWrapper(fmt.Errorf("%s", message), "autodl_api_error", http.StatusBadRequest)
	}
	if response.Data.TaskID == "" {
		message := response.Message
		if message == "" {
			message = "task_id is empty"
		}
		return "", nil, service.TaskErrorWrapper(fmt.Errorf("%s", message), "invalid_response", http.StatusBadRequest)
	}

	video := dto.NewOpenAIVideo()
	video.ID = info.PublicTaskID
	video.TaskID = info.PublicTaskID
	video.CreatedAt = time.Now().Unix()
	video.Model = info.OriginModelName
	c.JSON(http.StatusOK, video)
	return response.Data.TaskID, responseBody, nil
}

func (a *TaskAdaptor) FetchTask(baseURL, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("invalid task_id")
	}
	uri := fmt.Sprintf("%s/api/v1/comfyui/comfyui_workflow/result/%s", strings.TrimRight(baseURL, "/"), url.PathEscape(taskID))
	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) GetModelList() []string { return modelList }

func (a *TaskAdaptor) GetChannelName() string { return channelName }

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, _ *relaycommon.RelayInfo) map[string]float64 {
	req, err := relaycommon.GetTaskRequest(c)
	if err != nil {
		return nil
	}
	duration, err := requestDuration(req)
	if err != nil {
		return nil
	}
	return map[string]float64{"seconds": float64(duration), "resolution": resolutionRatio(metadataResolution(req))}
}

func resolutionRatio(resolution string) float64 {
	res := strings.ToLower(strings.TrimSpace(resolution))
	if strings.Contains(res, "768p") {
		return 1.333
	}
	return 1.0
}

func metadataResolution(req relaycommon.TaskSubmitReq) string {
	metadata := metadataFields{}
	if err := req.UnmarshalMetadata(&metadata); err != nil || metadata.Resolution == nil {
		return ""
	}
	return *metadata.Resolution
}

func parseResultsURL(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var items []struct {
		URL string `json:"url"`
	}
	if err := common.Unmarshal(raw, &items); err == nil {
		for _, item := range items {
			if item.URL != "" {
				return item.URL
			}
		}
	}
	var urls []string
	if err := common.Unmarshal(raw, &urls); err == nil {
		for _, u := range urls {
			if u != "" {
				return u
			}
		}
	}
	return ""
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var response resultResponse
	if err := common.Unmarshal(respBody, &response); err != nil {
		return nil, errors.Wrap(err, "unmarshal task result failed")
	}
	if response.Code != "" && !strings.EqualFold(response.Code, "success") {
		return nil, fmt.Errorf("autodl api error: %s", response.Message)
	}
	result := &relaycommon.TaskInfo{}
	switch response.Data.Status {
	case "QUEUED", "RUNNING":
		result.Status = model.TaskStatusInProgress
	case "SUCCESS":
		result.Status = model.TaskStatusSuccess
		result.Url = parseResultsURL(response.Data.Results)
	case "FAILED":
		result.Status = model.TaskStatusFailure
		result.Reason = response.Data.Message
		if result.Reason == "" {
			result.Reason = response.Message
		}
	default:
		return nil, fmt.Errorf("unknown task status: %s", response.Data.Status)
	}
	return result, nil
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	var response resultResponse
	if err := common.Unmarshal(task.Data, &response); err != nil {
		return nil, errors.Wrap(err, "unmarshal autodl task data failed")
	}
	video := dto.NewOpenAIVideo()
	video.ID = task.TaskID
	video.Status = task.Status.ToVideoStatus()
	video.SetProgressStr(task.Progress)
	video.CreatedAt = task.CreatedAt
	video.CompletedAt = task.UpdatedAt
	if videoURL := parseResultsURL(response.Data.Results); videoURL != "" {
		video.SetMetadata("url", videoURL)
	}
	if task.Status == model.TaskStatusFailure {
		message := response.Data.Message
		if message == "" {
			message = response.Message
		}
		if message != "" {
			video.Error = &dto.OpenAIVideoError{Message: message, Code: "task_failed"}
		}
	}
	return common.Marshal(video)
}
