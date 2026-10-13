package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"golang.org/x/text/cases"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const (
	DigitalAssetTypeText  = "text"
	DigitalAssetTypeImage = "image"
)

var ErrDigitalAssetNotFound = errors.New("数字资产不存在")

type DigitalAsset struct {
	Id         int               `json:"id" gorm:"primaryKey"`
	UserId     int               `json:"user_id" gorm:"not null;index:idx_digital_assets_user_updated,priority:1;index:idx_digital_assets_user_favorite_updated,priority:1"`
	AssetType  string            `json:"asset_type" gorm:"type:varchar(32);not null"`
	Title      string            `json:"title" gorm:"type:varchar(100);not null"`
	Content    string            `json:"content" gorm:"type:text;not null"`
	ImageId    *string           `json:"image_id,omitempty" gorm:"type:varchar(64);index"`
	IsFavorite bool              `json:"is_favorite" gorm:"not null;default:false;index:idx_digital_assets_user_favorite_updated,priority:2"`
	CreatedAt  int64             `json:"created_at" gorm:"type:bigint;not null;autoCreateTime"`
	UpdatedAt  int64             `json:"updated_at" gorm:"type:bigint;not null;autoCreateTime;index:idx_digital_assets_user_updated,priority:2,sort:desc;index:idx_digital_assets_user_favorite_updated,priority:3,sort:desc"`
	Image      *Image            `json:"image,omitempty" gorm:"foreignKey:ImageId;references:Id"`
	Tags       []DigitalAssetTag `json:"tags" gorm:"-"`
	User       User              `json:"-" gorm:"foreignKey:UserId;references:Id;constraint:OnDelete:CASCADE"`
}

type DigitalAssetTag struct {
	Id             int    `json:"id" gorm:"primaryKey"`
	UserId         int    `json:"user_id" gorm:"not null;uniqueIndex:uk_digital_asset_tags_user_name,priority:1;index:idx_digital_asset_tags_user_name,priority:1"`
	Name           string `json:"name" gorm:"type:varchar(32);not null"`
	NormalizedName string `json:"-" gorm:"type:varchar(32);not null;uniqueIndex:uk_digital_asset_tags_user_name,priority:2;index:idx_digital_asset_tags_user_name,priority:2"`
	CreatedAt      int64  `json:"created_at" gorm:"type:bigint;not null;autoCreateTime"`
	UpdatedAt      int64  `json:"updated_at" gorm:"type:bigint;not null;autoCreateTime;autoUpdateTime"`
	User           User   `json:"-" gorm:"foreignKey:UserId;references:Id;constraint:OnDelete:CASCADE"`
}

type DigitalAssetTagLink struct {
	AssetId int             `json:"asset_id" gorm:"primaryKey;column:asset_id"`
	TagId   int             `json:"tag_id" gorm:"primaryKey;column:tag_id;index:idx_digital_asset_tag_links_tag_asset,priority:1"`
	Asset   DigitalAsset    `json:"-" gorm:"foreignKey:AssetId;references:Id;constraint:OnDelete:CASCADE"`
	Tag     DigitalAssetTag `json:"-" gorm:"foreignKey:TagId;references:Id;constraint:OnDelete:CASCADE"`
}

type DigitalAssetListFilter struct {
	Favorite  *bool
	Search    string
	TagIds    []int
	AssetType string
}

var digitalAssetTagCaseFolder = cases.Fold()

func NormalizeDigitalAssetTagName(name string) string {
	return digitalAssetTagCaseFolder.String(strings.TrimSpace(name))
}

func ListDigitalAssets(userId int, filter DigitalAssetListFilter, pageInfo *common.PageInfo) ([]*DigitalAsset, int64, error) {
	query := DB.Model(&DigitalAsset{}).Where("user_id = ?", userId)
	if filter.Favorite != nil {
		query = query.Where("is_favorite = ?", *filter.Favorite)
	}
	if filter.AssetType != "" {
		query = query.Where("asset_type = ?", filter.AssetType)
	}
	if search := strings.TrimSpace(filter.Search); search != "" {
		pattern := "%" + search + "%"
		query = query.Where("title ILIKE ? OR content ILIKE ?", pattern, pattern)
	}
	if len(filter.TagIds) > 0 {
		subquery := DB.Model(&DigitalAssetTagLink{}).
			Select("digital_asset_tag_links.asset_id").
			Joins("JOIN digital_asset_tags ON digital_asset_tags.id = digital_asset_tag_links.tag_id").
			Where("digital_asset_tags.user_id = ? AND digital_asset_tag_links.tag_id IN ?", userId, filter.TagIds).
			Group("digital_asset_tag_links.asset_id").
			Having("COUNT(DISTINCT digital_asset_tag_links.tag_id) = ?", len(filter.TagIds))
		query = query.Where("id IN (?)", subquery)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	assets := make([]*DigitalAsset, 0)
	if err := query.Preload("Image").Order("updated_at DESC, id DESC").Offset(pageInfo.GetStartIdx()).Limit(pageInfo.GetPageSize()).Find(&assets).Error; err != nil {
		return nil, 0, err
	}
	if err := loadDigitalAssetTags(assets); err != nil {
		return nil, 0, err
	}
	return assets, total, nil
}

func GetDigitalAsset(userId int, id int) (*DigitalAsset, error) {
	asset := &DigitalAsset{}
	if err := DB.Preload("Image").Where("id = ? AND user_id = ?", id, userId).First(asset).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrDigitalAssetNotFound
		}
		return nil, err
	}
	if err := loadDigitalAssetTags([]*DigitalAsset{asset}); err != nil {
		return nil, err
	}
	return asset, nil
}

func CreateDigitalAsset(userId int, assetType string, title string, content string, tagNames []string, imageId *string) (*DigitalAsset, error) {
	asset := &DigitalAsset{
		UserId:    userId,
		AssetType: assetType,
		Title:     title,
		Content:   content,
		ImageId:   imageId,
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(asset).Error; err != nil {
			return err
		}
		tags, err := resolveDigitalAssetTags(tx, userId, tagNames)
		if err != nil {
			return err
		}
		return replaceDigitalAssetTagLinks(tx, asset.Id, tags)
	})
	if err != nil {
		return nil, err
	}
	return GetDigitalAsset(userId, asset.Id)
}

func UpdateDigitalAsset(userId int, id int, assetType string, title string, content string, tagNames []string, imageId *string) (*DigitalAsset, error) {
	err := DB.Transaction(func(tx *gorm.DB) error {
		asset := &DigitalAsset{}
		if err := tx.Where("id = ? AND user_id = ?", id, userId).First(asset).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return ErrDigitalAssetNotFound
			}
			return err
		}
		tags, err := resolveDigitalAssetTags(tx, userId, tagNames)
		if err != nil {
			return err
		}
		now := common.GetTimestamp()
		if now <= asset.UpdatedAt {
			now = asset.UpdatedAt + 1
		}
		updates := map[string]any{
			"asset_type": assetType,
			"title":      title,
			"content":    content,
			"updated_at": now,
		}
		if assetType == DigitalAssetTypeImage {
			if imageId != nil && *imageId != "" {
				updates["image_id"] = *imageId
			}
		} else if assetType == DigitalAssetTypeText {
			if imageId != nil && *imageId != "" {
				updates["image_id"] = *imageId
			} else {
				updates["image_id"] = nil
			}
		}
		if err := tx.Model(asset).Updates(updates).Error; err != nil {
			return err
		}
		return replaceDigitalAssetTagLinks(tx, id, tags)
	})
	if err != nil {
		return nil, err
	}
	return GetDigitalAsset(userId, id)
}

func SetDigitalAssetFavorite(userId int, id int, isFavorite bool) (*DigitalAsset, error) {
	result := DB.Model(&DigitalAsset{}).
		Where("id = ? AND user_id = ?", id, userId).
		UpdateColumn("is_favorite", isFavorite)
	if result.Error != nil {
		return nil, result.Error
	}
	if result.RowsAffected == 0 {
		return nil, ErrDigitalAssetNotFound
	}
	return GetDigitalAsset(userId, id)
}

func DeleteDigitalAsset(userId int, id int) error {
	result := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&DigitalAsset{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrDigitalAssetNotFound
	}
	return nil
}

func ListDigitalAssetTags(userId int) ([]*DigitalAssetTag, error) {
	tags := make([]*DigitalAssetTag, 0)
	err := DB.Where("user_id = ?", userId).Order("normalized_name ASC, id ASC").Find(&tags).Error
	return tags, err
}

func DeleteDigitalAssetTag(userId int, id int) error {
	result := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&DigitalAssetTag{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrDigitalAssetNotFound
	}
	return nil
}

func loadDigitalAssetTags(assets []*DigitalAsset) error {
	if len(assets) == 0 {
		return nil
	}
	assetIds := make([]int, 0, len(assets))
	assetsById := make(map[int]*DigitalAsset, len(assets))
	for _, asset := range assets {
		asset.Tags = make([]DigitalAssetTag, 0)
		assetIds = append(assetIds, asset.Id)
		assetsById[asset.Id] = asset
	}
	type tagRow struct {
		AssetId int `gorm:"column:asset_id"`
		DigitalAssetTag
	}
	rows := make([]tagRow, 0)
	err := DB.Table("digital_asset_tag_links").
		Select("digital_asset_tag_links.asset_id, digital_asset_tags.*").
		Joins("JOIN digital_asset_tags ON digital_asset_tags.id = digital_asset_tag_links.tag_id").
		Where("digital_asset_tag_links.asset_id IN ?", assetIds).
		Order("digital_asset_tags.normalized_name ASC, digital_asset_tags.id ASC").
		Scan(&rows).Error
	if err != nil {
		return err
	}
	for _, row := range rows {
		asset := assetsById[row.AssetId]
		asset.Tags = append(asset.Tags, row.DigitalAssetTag)
	}
	return nil
}

func resolveDigitalAssetTags(tx *gorm.DB, userId int, names []string) ([]DigitalAssetTag, error) {
	tags := make([]DigitalAssetTag, 0, len(names))
	for _, name := range names {
		displayName := strings.TrimSpace(name)
		normalizedName := NormalizeDigitalAssetTagName(displayName)
		tag := DigitalAssetTag{UserId: userId, Name: displayName, NormalizedName: normalizedName}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "user_id"}, {Name: "normalized_name"}},
			DoNothing: true,
		}).Create(&tag).Error; err != nil {
			return nil, err
		}
		if err := tx.Where("user_id = ? AND normalized_name = ?", userId, normalizedName).First(&tag).Error; err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, nil
}

func replaceDigitalAssetTagLinks(tx *gorm.DB, assetId int, tags []DigitalAssetTag) error {
	if err := tx.Where("asset_id = ?", assetId).Delete(&DigitalAssetTagLink{}).Error; err != nil {
		return err
	}
	if len(tags) == 0 {
		return nil
	}
	links := make([]DigitalAssetTagLink, 0, len(tags))
	for _, tag := range tags {
		links = append(links, DigitalAssetTagLink{AssetId: assetId, TagId: tag.Id})
	}
	return tx.Create(&links).Error
}
