package dto

const (
	DigitalAssetMaxTitleLength      = 100
	DigitalAssetMaxContentLength    = 100000
	DigitalAssetMaxTagLength        = 32
	DigitalAssetMaxTags             = 20
	DigitalAssetMaxRequestBodyBytes = 512 * 1024
)

type DigitalAssetWriteRequest struct {
	AssetType string   `json:"asset_type"`
	Title     string   `json:"title"`
	Content   string   `json:"content"`
	Tags      []string `json:"tags"`
	ImageId   *string  `json:"image_id"`
}

type DigitalAssetFavoriteRequest struct {
	IsFavorite *bool `json:"is_favorite"`
}
