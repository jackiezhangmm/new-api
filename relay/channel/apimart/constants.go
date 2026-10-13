package apimart

import (
	taskapimart "github.com/QuantumNous/new-api/relay/channel/task/apimart"
	"github.com/QuantumNous/new-api/relaykit/dto"
)

const (
	ChannelName         = "APIMart"
	ModelName           = "gpt-image-2-official"
	MidjourneyModelName = "mj_imagine"
)

var ModelList = []string{
	ModelName,
	dto.APIMartGrokImagineModel,
	MidjourneyModelName,
	taskapimart.ModelWan3Video,
	taskapimart.ModelWan3VideoPrime,
}
