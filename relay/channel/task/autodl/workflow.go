package autodl

import (
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	relaycommon "github.com/QuantumNous/new-api/relay/common"
)

type workflowSpec struct {
	maxDuration int
	maxPrompt   int
	maxImages   int
	minAudio    int
	maxAudio    int
	resolutions map[string]float64
}

var workflows = map[string]workflowSpec{
	"minimax_h3_lightx2v_v5": {
		maxDuration: 10, maxPrompt: 500000, maxImages: 9,
		resolutions: map[string]float64{
			"480p竖": 1, "480p横": 1, "480p(1:1)": 1,
			"768p竖": 1.333, "768p横": 1.333, "768p(1:1)": 1.333,
			"1080p竖": 3, "1080p横": 3, "1080p(1:1)": 3,
		},
	},
	"minimax_h3_b99_003_12s": {
		maxDuration: 12, maxPrompt: 10000, maxImages: 9,
		resolutions: map[string]float64{"736p竖": 1, "736p横": 1, "736p(1:1)": 1},
	},
	"minimax_h3_z0901": {
		maxDuration: 15, maxPrompt: 10000,
		resolutions: map[string]float64{
			"480p竖(480*864)": 1, "480p横(864*480)": 1,
			"768p竖(768*1344)": 1.75, "768p横(1344*768)": 1.75,
			"1088p竖(1088*1920)": 1.75, "1088p横(1920*1088)": 1.75,
			"1440p竖(1440*2560)": 2, "1440p横(2560*1440)": 2,
		},
	},
	"minimax_h3_z0903": {
		maxDuration: 15, maxPrompt: 10000, maxImages: 6, minAudio: 1, maxAudio: 3,
		resolutions: map[string]float64{
			"480p竖(480*864)": 1, "480p横(864*480)": 1,
			"768p竖(768*1376)": 1.75, "768p横(1376*768)": 1.75,
			"1088p竖(1088*1920)": 1.75, "1088p横(1920*1088)": 1.75,
			"1440p竖(1440*2560)": 2, "1440p横(2560*1440)": 2,
		},
	},
}

// 同时兼容标准 images 数组与已有 metadata.ref_image_* 调用；冲突时拒绝静默覆盖素材。
func normalizeReferences(req *relaycommon.TaskSubmitReq, workflow string) error {
	maxImages, maxAudio := 9, 3
	if spec, ok := workflows[workflow]; ok {
		maxImages, maxAudio = spec.maxImages, spec.maxAudio
	}
	if len(req.Images) > maxImages {
		return fmt.Errorf("at most %d reference images are supported", maxImages)
	}
	metadata := make(map[string]interface{}, len(req.Metadata)+len(req.Images))
	for key, value := range req.Metadata {
		metadata[key] = value
	}
	req.Metadata = metadata
	req.Image = strings.TrimSpace(req.Image)
	for index, image := range req.Images {
		image = strings.TrimSpace(image)
		if image == "" {
			return fmt.Errorf("reference image %d is empty", index)
		}
		if index == 0 {
			if req.Image != "" && req.Image != image {
				return fmt.Errorf("image conflicts with images[0]")
			}
			req.Image = image
			continue
		}
		key := fmt.Sprintf("ref_image_%d", index)
		if value, exists := metadata[key]; exists && value != image {
			return fmt.Errorf("%s conflicts with images[%d]", key, index)
		}
		metadata[key] = image
	}
	for key, value := range metadata {
		var limit int
		var isImage, isAudio bool
		switch {
		case strings.HasPrefix(key, "ref_image_"):
			limit, isImage = maxImages, true
		case strings.HasPrefix(key, "ref_audio_"):
			limit, isAudio = maxAudio, true
		default:
			continue
		}
		text, ok := value.(string)
		if !ok {
			return fmt.Errorf("%s must be a string", key)
		}
		trimmed := strings.TrimSpace(text)
		if trimmed == "" {
			delete(metadata, key)
			continue
		}
		metadata[key] = trimmed
		indexText := key[strings.LastIndex(key, "_")+1:]
		index, err := strconv.Atoi(indexText)
		if err != nil || index < 0 || strconv.Itoa(index) != indexText {
			return fmt.Errorf("unsupported reference field: %s", key)
		}
		if isImage && index >= limit {
			return fmt.Errorf("unsupported reference field: %s", key)
		}
		if isAudio && index >= limit {
			return fmt.Errorf("unsupported reference field: %s", key)
		}
		if key == "ref_image_0" {
			if req.Image != "" && req.Image != trimmed {
				return fmt.Errorf("ref_image_0 conflicts with image")
			}
			req.Image = trimmed
		}
	}
	if maxImages == 0 && req.Image != "" {
		return fmt.Errorf("this workflow does not support reference images")
	}
	return nil
}

func validateWorkflow(req relaycommon.TaskSubmitReq, workflow string) error {
	spec, ok := workflows[workflow]
	if !ok {
		return nil
	}
	if strings.TrimSpace(req.Prompt) == "" || utf8.RuneCountInString(req.Prompt) > spec.maxPrompt {
		return fmt.Errorf("prompt must contain 1 to %d characters", spec.maxPrompt)
	}
	if req.Seed != nil && (*req.Seed < 1 || *req.Seed > 999999999999999) {
		return fmt.Errorf("seed must be between 1 and 999999999999999")
	}
	if spec.minAudio > 0 {
		if audio, _ := req.Metadata["ref_audio_0"].(string); strings.TrimSpace(audio) == "" {
			return fmt.Errorf("ref_audio_0 is required")
		}
	}
	if resolution := metadataResolution(req); resolution != "" {
		if _, ok := spec.resolutions[resolution]; !ok {
			return fmt.Errorf("unsupported resolution: %s", resolution)
		}
	}
	return nil
}
