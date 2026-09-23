package apimart

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	taskdto "github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay/channel"
	"github.com/QuantumNous/new-api/relay/channel/task/taskcommon"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/types"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

type ImageWithRole struct {
	URL  string `json:"url"`
	Role string `json:"role"`
}

type apimartSubmitRequest struct {
	Model          string          `json:"model"`
	Prompt         string          `json:"prompt,omitempty"`
	NegativePrompt string          `json:"negative_prompt,omitempty"`
	Resolution     string          `json:"resolution,omitempty"`
	Size           string          `json:"size,omitempty"`
	Duration       int             `json:"duration,omitempty"`
	Audio          *bool           `json:"audio,omitempty"`
	Seed           *int            `json:"seed,omitempty"`
	Watermark      *bool           `json:"watermark,omitempty"`
	NSFWCheck      *bool           `json:"nsfw_check,omitempty"`
	GenerationType string          `json:"generation_type,omitempty"`
	ImageURLs      []string        `json:"image_urls,omitempty"`
	ImageWithRoles []ImageWithRole `json:"image_with_roles,omitempty"`
	VideoURLs      []string        `json:"video_urls,omitempty"`
	AudioURLs      []string        `json:"audio_urls,omitempty"`
	AudioURL       string          `json:"audio_url,omitempty"`
}

type rawClientRequest struct {
	Model          string                 `json:"model"`
	Prompt         string                 `json:"prompt"`
	NegativePrompt string                 `json:"negative_prompt"`
	Resolution     string                 `json:"resolution"`
	Size           string                 `json:"size"`
	AspectRatio    string                 `json:"aspect_ratio"`
	Duration       any                    `json:"duration"`
	Seconds        any                    `json:"seconds"`
	Audio          *bool                  `json:"audio"`
	Seed           *int                   `json:"seed"`
	Watermark      *bool                  `json:"watermark"`
	NSFWCheck      *bool                  `json:"nsfw_check"`
	GenerationType string                 `json:"generation_type"`
	ImageURLs      []string               `json:"image_urls"`
	ImageWithRoles []ImageWithRole        `json:"image_with_roles"`
	VideoURLs      []string               `json:"video_urls"`
	AudioURLs      []string               `json:"audio_urls"`
	AudioURL       string                 `json:"audio_url"`
	FileURL        string                 `json:"file_url"`
	LinkURL        string                 `json:"link_url"`
	Image          string                 `json:"image"`
	Images         []string               `json:"images"`
	InputReference string                 `json:"input_reference"`
	Metadata       map[string]interface{} `json:"metadata"`
}

type TaskAdaptor struct {
	taskcommon.BaseBilling
	ChannelType int
	apiKey      string
	baseURL     string
}

func (a *TaskAdaptor) Init(info *relaycommon.RelayInfo) {
	a.ChannelType = info.ChannelType
	a.baseURL = info.ChannelBaseUrl
	if a.baseURL == "" {
		a.baseURL = constant.ChannelBaseURLs[constant.ChannelTypeAPIMart]
	}
	a.apiKey = info.ApiKey
}

func (a *TaskAdaptor) ValidateRequestAndSetAction(c *gin.Context, info *relaycommon.RelayInfo) *taskdto.TaskError {
	var rawReq rawClientRequest
	contentType := c.GetHeader("Content-Type")

	if strings.HasPrefix(contentType, "multipart/form-data") {
		form, err := c.MultipartForm()
		if err != nil {
			return service.TaskErrorWrapperLocal(err, "invalid_multipart_form", http.StatusBadRequest)
		}
		getVal := func(key string) string {
			if vals, ok := form.Value[key]; ok && len(vals) > 0 {
				return vals[0]
			}
			return ""
		}
		rawReq.Model = getVal("model")
		rawReq.Prompt = getVal("prompt")
		rawReq.NegativePrompt = getVal("negative_prompt")
		rawReq.Resolution = getVal("resolution")
		rawReq.Size = getVal("size")
		rawReq.AspectRatio = getVal("aspect_ratio")
		rawReq.GenerationType = getVal("generation_type")
		rawReq.FileURL = getVal("file_url")
		rawReq.LinkURL = getVal("link_url")
		rawReq.AudioURL = getVal("audio_url")
		rawReq.Image = getVal("image")
		rawReq.InputReference = getVal("input_reference")
		if dStr := getVal("duration"); dStr != "" {
			rawReq.Duration = dStr
		} else if sStr := getVal("seconds"); sStr != "" {
			rawReq.Duration = sStr
		}
		if aStr := getVal("audio"); aStr != "" {
			b := strings.ToLower(aStr) == "true" || aStr == "1"
			rawReq.Audio = &b
		}
		if sStr := getVal("seed"); sStr != "" {
			if s, err := strconv.Atoi(sStr); err == nil {
				rawReq.Seed = &s
			}
		}
		if wStr := getVal("watermark"); wStr != "" {
			b := strings.ToLower(wStr) == "true" || wStr == "1"
			rawReq.Watermark = &b
		}
		if nStr := getVal("nsfw_check"); nStr != "" {
			b := strings.ToLower(nStr) == "true" || nStr == "1"
			rawReq.NSFWCheck = &b
		}
		if imgs, ok := form.Value["image_urls"]; ok {
			rawReq.ImageURLs = imgs
		}
		if vids, ok := form.Value["video_urls"]; ok {
			rawReq.VideoURLs = vids
		}
		if auds, ok := form.Value["audio_urls"]; ok {
			rawReq.AudioURLs = auds
		}
	} else {
		if err := common.UnmarshalBodyReusable(c, &rawReq); err != nil {
			return service.TaskErrorWrapperLocal(err, "invalid_json", http.StatusBadRequest)
		}
	}

	// 1. Model validation
	modelName := strings.TrimSpace(rawReq.Model)
	if modelName == "" {
		modelName = c.GetString("model")
	}
	if modelName == "" && info != nil {
		modelName = info.OriginModelName
	}
	if modelName == "" {
		return service.TaskErrorWrapperLocal(errors.New("model field is required"), "missing_model", http.StatusBadRequest)
	}
	rawReq.Model = modelName

	// 2. Reject out of scope materials (file_url / link_url)
	if strings.TrimSpace(rawReq.FileURL) != "" || strings.TrimSpace(rawReq.LinkURL) != "" {
		return service.TaskErrorWrapperLocal(errors.New("file_url and link_url are not supported"), "invalid_request", http.StatusBadRequest)
	}

	// 3. Duration validation
	duration := DefaultDuration
	rawDuration := rawReq.Duration
	if rawDuration == nil {
		rawDuration = rawReq.Seconds
	}
	if rawDuration != nil {
		parsedDuration, ok := parseDurationValue(rawDuration)
		if !ok {
			return service.TaskErrorWrapperLocal(errors.New("duration must be -1 or between 2 and 30 seconds"), "invalid_request", http.StatusBadRequest)
		}
		duration = parsedDuration
	}
	if duration == 0 {
		duration = DefaultDuration
	}
	if duration != DynamicDuration && (duration < MinDurationSeconds || duration > MaxDurationSeconds) {
		return service.TaskErrorWrapperLocal(errors.New("duration must be -1 or between 2 and 30 seconds"), "invalid_request", http.StatusBadRequest)
	}

	// 4. Resolution validation
	resolution := strings.ToUpper(strings.TrimSpace(rawReq.Resolution))
	if resolution == "" {
		resolution = Resolution1080P
	}
	if resolution != Resolution480P && resolution != Resolution720P && resolution != Resolution1080P {
		return service.TaskErrorWrapperLocal(fmt.Errorf("invalid resolution: %s (must be 480P, 720P, or 1080P)", rawReq.Resolution), "invalid_request", http.StatusBadRequest)
	}

	// 5. Size / Aspect Ratio
	size := strings.TrimSpace(rawReq.Size)
	if size == "" {
		size = strings.TrimSpace(rawReq.AspectRatio)
	}
	if size == "" {
		size = "adaptive"
	}
	validSizes := map[string]bool{
		"adaptive": true,
		"16:9":     true,
		"4:3":      true,
		"1:1":      true,
		"3:4":      true,
		"9:16":     true,
	}
	if !validSizes[size] {
		return service.TaskErrorWrapperLocal(fmt.Errorf("invalid size/aspect_ratio: %s (must be 16:9, 4:3, 1:1, 3:4, 9:16, or adaptive)", size), "invalid_request", http.StatusBadRequest)
	}

	// 6. Materials categorization and mutual exclusivity check
	var firstFrame string
	var lastFrame string
	var referenceImages []string

	// Process image_with_roles
	for _, item := range rawReq.ImageWithRoles {
		url := strings.TrimSpace(item.URL)
		if url == "" {
			continue
		}
		role := strings.ToLower(strings.TrimSpace(item.Role))
		switch role {
		case RoleFirstFrame:
			if firstFrame != "" {
				return service.TaskErrorWrapperLocal(errors.New("first_frame can only have at most 1 image"), "invalid_request", http.StatusBadRequest)
			}
			firstFrame = url
		case RoleLastFrame:
			if lastFrame != "" {
				return service.TaskErrorWrapperLocal(errors.New("last_frame can only have at most 1 image"), "invalid_request", http.StatusBadRequest)
			}
			lastFrame = url
		case RoleReferenceImage:
			referenceImages = append(referenceImages, url)
		default:
			return service.TaskErrorWrapperLocal(fmt.Errorf("invalid image role: %s (must be first_frame, last_frame, or reference_image)", item.Role), "invalid_request", http.StatusBadRequest)
		}
	}

	// Collect bare images
	var bareImages []string
	for _, u := range rawReq.ImageURLs {
		if trimmed := strings.TrimSpace(u); trimmed != "" {
			bareImages = append(bareImages, trimmed)
		}
	}
	if len(bareImages) == 0 {
		for _, u := range rawReq.Images {
			if trimmed := strings.TrimSpace(u); trimmed != "" {
				bareImages = append(bareImages, trimmed)
			}
		}
		if trimmed := strings.TrimSpace(rawReq.Image); trimmed != "" {
			bareImages = append(bareImages, trimmed)
		}
		if trimmed := strings.TrimSpace(rawReq.InputReference); trimmed != "" {
			bareImages = append(bareImages, trimmed)
		}
	}

	genType := strings.ToLower(strings.TrimSpace(rawReq.GenerationType))
	if genType != "" && genType != GenerationTypeFrame && genType != GenerationTypeReference {
		return service.TaskErrorWrapperLocal(fmt.Errorf("invalid generation_type: %s", rawReq.GenerationType), "invalid_request", http.StatusBadRequest)
	}

	hasRefMedia := len(rawReq.VideoURLs) > 0 || len(rawReq.AudioURLs) > 0 || strings.TrimSpace(rawReq.AudioURL) != ""

	if genType == GenerationTypeFrame {
		for i, img := range bareImages {
			if i == 0 {
				if firstFrame != "" {
					return service.TaskErrorWrapperLocal(errors.New("first_frame already specified"), "invalid_request", http.StatusBadRequest)
				}
				firstFrame = img
			} else if i == 1 {
				if lastFrame != "" {
					return service.TaskErrorWrapperLocal(errors.New("last_frame already specified"), "invalid_request", http.StatusBadRequest)
				}
				lastFrame = img
			} else {
				return service.TaskErrorWrapperLocal(errors.New("frame generation supports at most 2 images (first_frame and last_frame)"), "invalid_request", http.StatusBadRequest)
			}
		}
	} else if genType == GenerationTypeReference {
		referenceImages = append(referenceImages, bareImages...)
	} else {
		// Omitted generation_type
		if hasRefMedia {
			referenceImages = append(referenceImages, bareImages...)
		} else {
			for i, img := range bareImages {
				if i == 0 {
					if firstFrame != "" {
						return service.TaskErrorWrapperLocal(errors.New("first_frame already specified"), "invalid_request", http.StatusBadRequest)
					}
					firstFrame = img
				} else if i == 1 {
					if lastFrame != "" {
						return service.TaskErrorWrapperLocal(errors.New("last_frame already specified"), "invalid_request", http.StatusBadRequest)
					}
					lastFrame = img
				} else {
					return service.TaskErrorWrapperLocal(errors.New("frame generation supports at most 2 images (first_frame and last_frame)"), "invalid_request", http.StatusBadRequest)
				}
			}
		}
	}

	// Two-family mutual exclusivity validation
	hasFrameFamily := firstFrame != "" || lastFrame != ""
	hasReferenceFamily := len(referenceImages) > 0 || hasRefMedia

	if hasFrameFamily && hasReferenceFamily {
		return service.TaskErrorWrapperLocal(errors.New("cannot mix frame materials (first_frame/last_frame) with reference materials (reference_image/video/audio)"), "invalid_request", http.StatusBadRequest)
	}

	// Material bounds validation
	if len(referenceImages) > MaxReferenceImages {
		return service.TaskErrorWrapperLocal(fmt.Errorf("reference images count %d exceeds maximum of %d", len(referenceImages), MaxReferenceImages), "invalid_request", http.StatusBadRequest)
	}
	if len(rawReq.VideoURLs) > MaxReferenceVideos {
		return service.TaskErrorWrapperLocal(fmt.Errorf("reference videos count %d exceeds maximum of %d", len(rawReq.VideoURLs), MaxReferenceVideos), "invalid_request", http.StatusBadRequest)
	}
	audioCount := len(rawReq.AudioURLs)
	if strings.TrimSpace(rawReq.AudioURL) != "" {
		audioCount++
	}
	if audioCount > MaxReferenceAudios {
		return service.TaskErrorWrapperLocal(fmt.Errorf("reference audios count %d exceeds maximum of %d", audioCount, MaxReferenceAudios), "invalid_request", http.StatusBadRequest)
	}

	// 7. Prompt & material existence check
	prompt := strings.TrimSpace(rawReq.Prompt)
	if prompt == "" && !hasFrameFamily && !hasReferenceFamily {
		return service.TaskErrorWrapperLocal(errors.New("prompt or material is required"), "invalid_request", http.StatusBadRequest)
	}
	if len(prompt) > MaxPromptLength {
		prompt = prompt[:MaxPromptLength]
	}

	// 8. Action determination
	action := constant.TaskActionTextGenerate
	if hasFrameFamily || hasReferenceFamily {
		action = constant.TaskActionGenerate
	}

	// 9. Construct normalized submit request for upstream
	submitReq := &apimartSubmitRequest{
		Model:          rawReq.Model,
		Prompt:         prompt,
		NegativePrompt: rawReq.NegativePrompt,
		Resolution:     resolution,
		Size:           size,
		Duration:       duration,
		Audio:          rawReq.Audio,
		Seed:           rawReq.Seed,
		Watermark:      rawReq.Watermark,
		NSFWCheck:      rawReq.NSFWCheck,
		VideoURLs:      rawReq.VideoURLs,
		AudioURLs:      rawReq.AudioURLs,
		AudioURL:       rawReq.AudioURL,
	}

	if hasFrameFamily {
		submitReq.GenerationType = GenerationTypeFrame
		if firstFrame != "" && lastFrame != "" {
			submitReq.ImageWithRoles = []ImageWithRole{
				{URL: firstFrame, Role: RoleFirstFrame},
				{URL: lastFrame, Role: RoleLastFrame},
			}
		} else if firstFrame != "" {
			submitReq.ImageURLs = []string{firstFrame}
		} else if lastFrame != "" {
			submitReq.ImageWithRoles = []ImageWithRole{
				{URL: lastFrame, Role: RoleLastFrame},
			}
		}
	} else if hasReferenceFamily {
		submitReq.GenerationType = GenerationTypeReference
		if len(referenceImages) > 0 {
			submitReq.ImageURLs = referenceImages
		}
	}

	c.Set("apimart_req", submitReq)

	taskSubmitReq := relaycommon.TaskSubmitReq{
		Prompt:   prompt,
		Model:    rawReq.Model,
		Duration: duration,
		Size:     size,
	}
	relaycommon.StoreTaskRequest(c, info, action, taskSubmitReq)
	return nil
}

func parseDurationValue(v any) (int, bool) {
	switch val := v.(type) {
	case int:
		return val, true
	case int64:
		return int(val), true
	case float64:
		return int(val), true
	case string:
		trimmed := strings.TrimSpace(val)
		if trimmed == "" {
			return DefaultDuration, true
		}
		n, err := strconv.Atoi(trimmed)
		if err != nil {
			return 0, false
		}
		return n, true
	default:
		return 0, false
	}
}

func (a *TaskAdaptor) EstimateBilling(c *gin.Context, info *relaycommon.RelayInfo) map[string]float64 {
	v, exists := c.Get("apimart_req")
	if !exists {
		return nil
	}
	req, ok := v.(*apimartSubmitRequest)
	if !ok {
		return nil
	}

	ratios := make(map[string]float64)
	var seconds float64

	if req.Duration == DynamicDuration {
		seconds = float64(MaxDurationSeconds)
		ratios["dynamic_duration"] = 1.0
	} else {
		seconds = float64(req.Duration)
	}
	ratios["seconds"] = seconds

	switch req.Resolution {
	case Resolution480P:
		ratios["resolution-480P"] = RatioResolution480P
	case Resolution720P:
		ratios["resolution-720P"] = RatioResolution720P
	case Resolution1080P:
		ratios["resolution-1080P"] = RatioResolution1080P
	default:
		ratios["resolution-1080P"] = RatioResolution1080P
	}

	return ratios
}

func (a *TaskAdaptor) AdjustBillingOnComplete(task *model.Task, taskResult *relaycommon.TaskInfo) int {
	if task == nil {
		return 0
	}
	bc := task.PrivateData.BillingContext
	if bc == nil || bc.PerCallBilling {
		return 0
	}
	if bc.OtherRatios == nil || bc.OtherRatios["dynamic_duration"] != 1.0 {
		return 0
	}

	actualDuration := 0
	if taskResult != nil && taskResult.Duration > 0 {
		actualDuration = taskResult.Duration
	} else if len(task.Data) > 0 {
		actualDuration = extractDurationFromRawData(task.Data)
	}

	if actualDuration <= 0 {
		return 0
	}

	// Clamp duration to valid bounds [2, 30]
	actualDuration = min(max(actualDuration, MinDurationSeconds), MaxDurationSeconds)

	baseQuota, err := common.QuotaFromFloatStrict(bc.ModelRatio / 2 * float64(common.QuotaPerUnit) * bc.GroupRatio)
	if err != nil {
		return 0
	}

	priceData := &types.PriceData{}
	for k, v := range bc.OtherRatios {
		if k == "seconds" {
			priceData.AddOtherRatio(k, float64(actualDuration))
		} else if k != "dynamic_duration" {
			priceData.AddOtherRatio(k, v)
		}
	}

	quotaWithRatios := priceData.ApplyOtherRatiosToFloat(float64(baseQuota))
	actualQuota, _ := common.QuotaFromFloatChecked(quotaWithRatios)
	return actualQuota
}

func extractDurationFromRawData(data []byte) int {
	var raw map[string]any
	if err := common.Unmarshal(data, &raw); err != nil {
		return 0
	}
	dObj, _ := raw["data"].(map[string]any)
	if dObj == nil {
		dObj = raw
	}
	if usage, ok := dObj["usage"].(map[string]any); ok {
		if d, ok := extractDuration(usage["duration"]); ok && d > 0 {
			return d
		}
	}
	if result, ok := dObj["result"].(map[string]any); ok {
		if d, ok := extractDuration(result["duration"]); ok && d > 0 {
			return d
		}
	}
	if d, ok := extractDuration(dObj["actual_time"]); ok && d > 0 {
		return d
	}
	return 0
}

func (a *TaskAdaptor) BuildRequestURL(info *relaycommon.RelayInfo) (string, error) {
	return fmt.Sprintf("%s/v1/videos/generations", a.baseURL), nil
}

func (a *TaskAdaptor) BuildRequestHeader(c *gin.Context, req *http.Request, info *relaycommon.RelayInfo) error {
	req.Header.Set("Authorization", "Bearer "+a.apiKey)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	return nil
}

func (a *TaskAdaptor) BuildRequestBody(c *gin.Context, info *relaycommon.RelayInfo) (io.Reader, error) {
	v, exists := c.Get("apimart_req")
	if !exists {
		return nil, errors.New("apimart request not found in context")
	}
	req, ok := v.(*apimartSubmitRequest)
	if !ok {
		return nil, errors.New("invalid apimart request type in context")
	}
	logger.LogJson(c, "apimart video request body", req)

	bodyBytes, err := common.Marshal(req)
	if err != nil {
		return nil, errors.Wrap(err, "marshal apimart request failed")
	}
	return bytes.NewReader(bodyBytes), nil
}

func (a *TaskAdaptor) DoRequest(c *gin.Context, info *relaycommon.RelayInfo, requestBody io.Reader) (*http.Response, error) {
	return channel.DoTaskApiRequest(a, c, info, requestBody)
}

func (a *TaskAdaptor) DoResponse(c *gin.Context, resp *http.Response, info *relaycommon.RelayInfo) (taskID string, taskData []byte, taskErr *taskdto.TaskError) {
	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		taskErr = service.TaskErrorWrapper(err, "read_response_body_failed", http.StatusInternalServerError)
		return
	}
	_ = resp.Body.Close()

	if resp.StatusCode >= 400 {
		var errResp struct {
			Error struct {
				Code    any    `json:"code"`
				Message string `json:"message"`
				Type    string `json:"type"`
			} `json:"error"`
			Message string `json:"message"`
		}
		if unmarshalErr := common.Unmarshal(responseBody, &errResp); unmarshalErr == nil {
			msg := errResp.Error.Message
			if msg == "" {
				msg = errResp.Message
			}
			if msg != "" {
				taskErr = service.TaskErrorWrapper(fmt.Errorf("%s", msg), "apimart_api_error", resp.StatusCode)
				return
			}
		}
		taskErr = service.TaskErrorWrapper(fmt.Errorf("upstream error with status %d: %s", resp.StatusCode, string(responseBody)), "apimart_api_error", resp.StatusCode)
		return
	}

	var submitResp struct {
		Code int    `json:"code"`
		Data any    `json:"data"`
		ID   string `json:"id"`
	}
	if err := common.Unmarshal(responseBody, &submitResp); err != nil {
		taskErr = service.TaskErrorWrapper(errors.Wrapf(err, "body: %s", responseBody), "unmarshal_response_body_failed", http.StatusInternalServerError)
		return
	}

	upstreamTaskID := extractUpstreamTaskID(submitResp.Data)
	if upstreamTaskID == "" {
		upstreamTaskID = submitResp.ID
	}
	if upstreamTaskID == "" {
		taskErr = service.TaskErrorWrapper(fmt.Errorf("upstream task_id is empty, response: %s", string(responseBody)), "invalid_response", http.StatusInternalServerError)
		return
	}

	openAIResp := dto.NewOpenAIVideo()
	openAIResp.ID = info.PublicTaskID
	openAIResp.TaskID = info.PublicTaskID
	openAIResp.Model = c.GetString("model")
	if openAIResp.Model == "" && info != nil {
		openAIResp.Model = info.OriginModelName
	}
	openAIResp.Status = dto.VideoStatusQueued
	openAIResp.CreatedAt = common.GetTimestamp()

	c.JSON(http.StatusOK, openAIResp)
	return upstreamTaskID, responseBody, nil
}

func extractUpstreamTaskID(data any) string {
	if data == nil {
		return ""
	}
	switch d := data.(type) {
	case []any:
		if len(d) > 0 {
			if first, ok := d[0].(map[string]any); ok {
				if id, ok := first["task_id"].(string); ok && id != "" {
					return id
				}
				if id, ok := first["id"].(string); ok && id != "" {
					return id
				}
			}
		}
	case map[string]any:
		if id, ok := d["task_id"].(string); ok && id != "" {
			return id
		}
		if id, ok := d["id"].(string); ok && id != "" {
			return id
		}
	}
	return ""
}

func (a *TaskAdaptor) FetchTask(baseUrl, key string, body map[string]any, proxy string) (*http.Response, error) {
	taskID, ok := body["task_id"].(string)
	if !ok || strings.TrimSpace(taskID) == "" {
		return nil, fmt.Errorf("invalid task_id")
	}

	uri := fmt.Sprintf("%s/v1/videos/generations/%s", baseUrl, taskID)

	req, err := http.NewRequest(http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Authorization", "Bearer "+key)

	client, err := service.GetHttpClientWithProxy(proxy)
	if err != nil {
		return nil, fmt.Errorf("new proxy http client failed: %w", err)
	}
	return client.Do(req)
}

func (a *TaskAdaptor) ParseTaskResult(respBody []byte) (*relaycommon.TaskInfo, error) {
	var raw map[string]any
	if err := common.Unmarshal(respBody, &raw); err != nil {
		return nil, errors.Wrap(err, "unmarshal apimart task result failed")
	}

	// Check top-level error
	if errObj, ok := raw["error"].(map[string]any); ok && errObj != nil {
		msg := fmt.Sprintf("%v", errObj["message"])
		return relaycommon.FailTaskInfo(msg), nil
	}

	data, _ := raw["data"].(map[string]any)
	if data == nil {
		data = raw
	}

	taskID := fmt.Sprintf("%v", data["id"])
	if taskID == "" || taskID == "<nil>" {
		taskID = fmt.Sprintf("%v", data["task_id"])
	}
	if taskID == "<nil>" {
		taskID = ""
	}

	upstreamStatus := strings.ToLower(fmt.Sprintf("%v", data["status"]))
	taskInfo := &relaycommon.TaskInfo{
		TaskID: taskID,
	}

	if errObj, ok := data["error"].(map[string]any); ok && errObj != nil {
		taskInfo.Reason = fmt.Sprintf("%v", errObj["message"])
	}

	switch upstreamStatus {
	case "submitted", "pending", "queued":
		taskInfo.Status = string(model.TaskStatusSubmitted)
	case "processing", "in_progress", "running":
		taskInfo.Status = string(model.TaskStatusInProgress)
	case "completed", "succeeded", "success":
		taskInfo.Status = string(model.TaskStatusSuccess)
	case "failed", "cancelled", "canceled":
		taskInfo.Status = string(model.TaskStatusFailure)
		if taskInfo.Reason == "" {
			taskInfo.Reason = "task failed upstream"
		}
	default:
		taskInfo.Status = upstreamStatus
	}

	if p, ok := data["progress"].(float64); ok {
		taskInfo.Progress = fmt.Sprintf("%d%%", int(p))
	} else if pStr, ok := data["progress"].(string); ok && pStr != "" {
		taskInfo.Progress = pStr
	}

	if result, ok := data["result"].(map[string]any); ok {
		taskInfo.Url = extractVideoURL(result)
		if d, ok := extractDuration(result["duration"]); ok && d > 0 {
			taskInfo.Duration = d
		}
	}

	if taskInfo.Duration == 0 {
		if usage, ok := data["usage"].(map[string]any); ok {
			if d, ok := extractDuration(usage["duration"]); ok && d > 0 {
				taskInfo.Duration = d
			}
		}
	}
	if taskInfo.Duration == 0 {
		if d, ok := extractDuration(data["actual_time"]); ok && d > 0 {
			taskInfo.Duration = d
		}
	}

	return taskInfo, nil
}

func extractVideoURL(result map[string]any) string {
	if videos, ok := result["videos"].([]any); ok && len(videos) > 0 {
		switch v := videos[0].(type) {
		case string:
			return v
		case map[string]any:
			if u, ok := v["url"].(string); ok && u != "" {
				return u
			}
			if uArr, ok := v["url"].([]any); ok && len(uArr) > 0 {
				if uStr, ok := uArr[0].(string); ok {
					return uStr
				}
			}
		}
	}
	if vURL, ok := result["video_url"].(string); ok && vURL != "" {
		return vURL
	}
	if v, ok := result["video"].(string); ok && v != "" {
		return v
	}
	return ""
}

func extractDuration(val any) (int, bool) {
	if val == nil {
		return 0, false
	}
	switch v := val.(type) {
	case float64:
		return int(v), true
	case int:
		return v, true
	case int64:
		return int(v), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err == nil {
			return n, true
		}
	}
	return 0, false
}

func (a *TaskAdaptor) ConvertToOpenAIVideo(task *model.Task) ([]byte, error) {
	if task == nil {
		return nil, errors.New("task is nil")
	}

	openAIResp := dto.NewOpenAIVideo()
	openAIResp.ID = task.TaskID
	openAIResp.TaskID = task.TaskID
	openAIResp.Status = task.Status.ToVideoStatus()
	openAIResp.Model = task.Properties.OriginModelName
	openAIResp.SetProgressStr(task.Progress)
	openAIResp.CreatedAt = task.CreatedAt
	openAIResp.CompletedAt = task.FinishTime
	if openAIResp.CompletedAt == 0 {
		openAIResp.CompletedAt = task.UpdatedAt
	}

	actualDuration := 0
	if len(task.Data) > 0 {
		actualDuration = extractDurationFromRawData(task.Data)
	}
	if actualDuration > 0 {
		openAIResp.Seconds = strconv.Itoa(actualDuration)
	} else if bc := task.PrivateData.BillingContext; bc != nil && bc.OtherRatios != nil {
		if sec, ok := bc.OtherRatios["seconds"]; ok && sec > 0 {
			openAIResp.Seconds = strconv.Itoa(int(sec))
		}
	}

	videoURL := task.PrivateData.ResultURL
	if videoURL == "" && len(task.Data) > 0 {
		var raw map[string]any
		if err := common.Unmarshal(task.Data, &raw); err == nil {
			dObj, _ := raw["data"].(map[string]any)
			if dObj == nil {
				dObj = raw
			}
			if result, ok := dObj["result"].(map[string]any); ok {
				videoURL = extractVideoURL(result)
			}
		}
	}
	if videoURL != "" {
		openAIResp.SetMetadata("url", videoURL)
	}

	if task.Status == model.TaskStatusFailure {
		msg := task.FailReason
		if msg == "" {
			msg = "task failed"
		}
		openAIResp.Error = &dto.OpenAIVideoError{
			Code:    "task_failed",
			Message: msg,
		}
	}

	return common.Marshal(openAIResp)
}

func (a *TaskAdaptor) GetModelList() []string {
	return ModelList
}

func (a *TaskAdaptor) GetChannelName() string {
	return ChannelName
}
