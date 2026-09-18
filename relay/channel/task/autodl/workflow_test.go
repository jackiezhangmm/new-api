package autodl

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeReferences(t *testing.T) {
	tests := []struct {
		name        string
		workflow    string
		req         *relaycommon.TaskSubmitReq
		wantErr     bool
		errContains string
		check       func(t *testing.T, req *relaycommon.TaskSubmitReq)
	}{
		{
			name:     "accepts images array and metadata fields",
			workflow: "minimax_h3_zm_u24",
			req: &relaycommon.TaskSubmitReq{
				Image:  "https://example.com/ref0.png",
				Images: []string{"https://example.com/ref0.png", "https://example.com/ref1.png"},
				Metadata: map[string]interface{}{
					"ref_image_2": "https://example.com/ref2.png",
					"ref_audio_0": "https://example.com/audio0.mp3",
				},
			},
			check: func(t *testing.T, req *relaycommon.TaskSubmitReq) {
				assert.Equal(t, "https://example.com/ref0.png", req.Image)
				assert.Equal(t, "https://example.com/ref1.png", req.Metadata["ref_image_1"])
				assert.Equal(t, "https://example.com/ref2.png", req.Metadata["ref_image_2"])
				assert.Equal(t, "https://example.com/audio0.mp3", req.Metadata["ref_audio_0"])
			},
		},
		{
			name:     "trims whitespace and removes empty fields",
			workflow: "minimax_h3_zm_u24",
			req: &relaycommon.TaskSubmitReq{
				Image: " https://example.com/ref0.png ",
				Metadata: map[string]interface{}{
					"ref_image_1": "  ",
					"ref_audio_0": " https://example.com/audio.mp3 ",
				},
			},
			check: func(t *testing.T, req *relaycommon.TaskSubmitReq) {
				assert.Equal(t, "https://example.com/ref0.png", req.Image)
				assert.Nil(t, req.Metadata["ref_image_1"])
				assert.Equal(t, "https://example.com/audio.mp3", req.Metadata["ref_audio_0"])
			},
		},
		{
			name:     "rejects image conflict with images[0]",
			workflow: "minimax_h3_zm_u24",
			req: &relaycommon.TaskSubmitReq{
				Image:  "https://example.com/conflict.png",
				Images: []string{"https://example.com/different.png"},
			},
			wantErr:     true,
			errContains: "conflicts with images[0]",
		},
		{
			name:     "rejects metadata conflict with images array",
			workflow: "minimax_h3_zm_u24",
			req: &relaycommon.TaskSubmitReq{
				Images: []string{"https://example.com/ref0.png", "https://example.com/ref1.png"},
				Metadata: map[string]interface{}{
					"ref_image_1": "https://example.com/conflicting.png",
				},
			},
			wantErr:     true,
			errContains: "conflicts with images[1]",
		},
		{
			name:     "rejects excess images beyond workflow limit",
			workflow: "minimax_h3_zm_u24",
			req: &relaycommon.TaskSubmitReq{
				Images: []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10"},
			},
			wantErr:     true,
			errContains: "at most 9 reference images",
		},
		{
			name:     "rejects images for text-only workflow",
			workflow: "minimax_h3_z0901",
			req: &relaycommon.TaskSubmitReq{
				Image: "https://example.com/ref.png",
			},
			wantErr:     true,
			errContains: "does not support reference images",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := normalizeReferences(tt.req, tt.workflow)
			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
				return
			}
			require.NoError(t, err)
			if tt.check != nil {
				tt.check(t, tt.req)
			}
		})
	}
}

func TestValidateWorkflow(t *testing.T) {
	validSeed := int64(123456)
	invalidSeed := int64(0)
	tooLongPrompt := string(make([]rune, 10001))

	tests := []struct {
		name        string
		workflow    string
		req         relaycommon.TaskSubmitReq
		wantErr     bool
		errContains string
	}{
		{
			name:        "empty prompt rejected",
			workflow:    "minimax_h3_z0901",
			req:         relaycommon.TaskSubmitReq{Prompt: "  "},
			wantErr:     true,
			errContains: "prompt must contain",
		},
		{
			name:        "prompt exceeding limit rejected",
			workflow:    "minimax_h3_z0901",
			req:         relaycommon.TaskSubmitReq{Prompt: tooLongPrompt},
			wantErr:     true,
			errContains: "prompt must contain",
		},
		{
			name:        "seed below 1 rejected",
			workflow:    "minimax_h3_z0901",
			req:         relaycommon.TaskSubmitReq{Prompt: "valid prompt", Seed: &invalidSeed},
			wantErr:     true,
			errContains: "seed must be between",
		},
		{
			name:     "valid seed accepted",
			workflow: "minimax_h3_z0901",
			req:      relaycommon.TaskSubmitReq{Prompt: "valid prompt", Seed: &validSeed},
			wantErr:  false,
		},
		{
			name:        "missing audio for z0903 rejected",
			workflow:    "minimax_h3_z0903",
			req:         relaycommon.TaskSubmitReq{Prompt: "valid prompt"},
			wantErr:     true,
			errContains: "ref_audio_0 is required",
		},
		{
			name:     "valid audio for z0903 accepted",
			workflow: "minimax_h3_z0903",
			req: relaycommon.TaskSubmitReq{
				Prompt:   "valid prompt",
				Metadata: map[string]interface{}{"ref_audio_0": "https://example.com/audio.mp3"},
			},
			wantErr: false,
		},
		{
			name:     "empty resolution is optional and accepted",
			workflow: "minimax_h3_lightx2v_v5",
			req:      relaycommon.TaskSubmitReq{Prompt: "valid prompt"},
			wantErr:  false,
		},
		{
			name:     "valid resolution accepted",
			workflow: "minimax_h3_lightx2v_v5",
			req: relaycommon.TaskSubmitReq{
				Prompt:   "valid prompt",
				Metadata: map[string]interface{}{"resolution": "1080p竖"},
			},
			wantErr: false,
		},
		{
			name:     "unsupported resolution rejected",
			workflow: "minimax_h3_b99_003_12s",
			req: relaycommon.TaskSubmitReq{
				Prompt:   "valid prompt",
				Metadata: map[string]interface{}{"resolution": "2160p横"},
			},
			wantErr:     true,
			errContains: "unsupported resolution",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateWorkflow(tt.req, tt.workflow)
			if tt.wantErr {
				require.Error(t, err)
				if tt.errContains != "" {
					assert.Contains(t, err.Error(), tt.errContains)
				}
				return
			}
			require.NoError(t, err)
		})
	}
}

func TestEstimateBillingResolutionFallback(t *testing.T) {
	adaptor := &TaskAdaptor{}
	tests := []struct {
		name          string
		workflow      string
		body          string
		expectedRatio float64
	}{
		{
			name:          "workflow valid resolution",
			workflow:      "minimax_h3_lightx2v_v5",
			body:          `{"prompt":"test","image":"https://example.com/a.png","duration":5,"metadata":{"resolution":"1080p竖"}}`,
			expectedRatio: 3.0,
		},
		{
			name:          "workflow z0901 1440p",
			workflow:      "minimax_h3_z0901",
			body:          `{"prompt":"test","duration":5,"metadata":{"resolution":"1440p竖(1440*2560)"}}`,
			expectedRatio: 2.0,
		},
		{
			name:          "workflow missing resolution falls back to 1.0",
			workflow:      "minimax_h3_lightx2v_v5",
			body:          `{"prompt":"test","image":"https://example.com/a.png","duration":5}`,
			expectedRatio: 1.0,
		},
		{
			name:          "workflow unknown resolution falls back to 1.0 safely",
			workflow:      "minimax_h3_z0903",
			body:          `{"prompt":"test","image":"https://example.com/a.png","duration":5,"metadata":{"resolution":"invalid_res"}}`,
			expectedRatio: 1.0,
		},
		{
			name:          "legacy workflow 768p ratio",
			workflow:      "minimax_h3_zm_u24",
			body:          `{"prompt":"test","image":"https://example.com/a.png","duration":5,"metadata":{"resolution":"768p横"}}`,
			expectedRatio: 1.333,
		},
		{
			name:          "legacy workflow default ratio",
			workflow:      "minimax_h3_zm_u24",
			body:          `{"prompt":"test","image":"https://example.com/a.png","duration":5}`,
			expectedRatio: 1.0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := newTaskContext(tt.body)
			defer common.CleanupBodyStorage(c)
			info := autoDLInfo()
			info.UpstreamModelName = tt.workflow
			var req relaycommon.TaskSubmitReq
			require.NoError(t, common.Unmarshal([]byte(tt.body), &req))
			c.Set("task_request", req)
			rates := adaptor.EstimateBilling(c, info)
			require.NotNil(t, rates)
			assert.Equal(t, tt.expectedRatio, rates["resolution"])
			assert.Equal(t, 5.0, rates["seconds"])
		})
	}
}
