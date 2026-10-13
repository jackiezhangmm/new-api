package apimart

const (
	ChannelName = "apimart"

	ModelWan3Video      = "wan3.0-video"
	ModelWan3VideoPrime = "wan3.0-video-prime"

	Resolution480P  = "480P"
	Resolution720P  = "720P"
	Resolution1080P = "1080P"

	GenerationTypeFrame     = "frame"
	GenerationTypeReference = "reference"

	RoleFirstFrame     = "first_frame"
	RoleLastFrame      = "last_frame"
	RoleReferenceImage = "reference_image"

	RatioResolution480P  = 1.0
	RatioResolution720P  = 2.0
	RatioResolution1080P = 4.0

	MaxDurationSeconds = 30
	MinDurationSeconds = 2
	DynamicDuration    = -1
	DefaultDuration    = 5

	MaxPromptLength = 20000

	MaxReferenceImages = 10
	MaxReferenceVideos = 5
	MaxReferenceAudios = 5
)

var ModelList = []string{
	ModelWan3Video,
	ModelWan3VideoPrime,
}
