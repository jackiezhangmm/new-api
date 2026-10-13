package controller

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func ListDigitalAssets(c *gin.Context) {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	pageInfo := common.GetPageQuery(c)
	filter := model.DigitalAssetListFilter{Search: c.Query("search")}
	if assetType := strings.TrimSpace(c.Query("asset_type")); assetType != "" {
		if assetType != model.DigitalAssetTypeText && assetType != model.DigitalAssetTypeImage {
			common.ApiErrorMsg(c, "资产类型无效")
			return
		}
		filter.AssetType = assetType
	}
	if favoriteValue := c.Query("favorite"); favoriteValue != "" {
		favorite, err := strconv.ParseBool(favoriteValue)
		if err != nil {
			common.ApiErrorMsg(c, "收藏筛选参数无效")
			return
		}
		filter.Favorite = &favorite
	}
	if tagValues := c.QueryArray("tag_id"); len(tagValues) > 0 {
		filter.TagIds = make([]int, 0, len(tagValues))
		seen := make(map[int]struct{}, len(tagValues))
		for _, value := range tagValues {
			tagId, err := strconv.Atoi(value)
			if err != nil || tagId <= 0 {
				common.ApiErrorMsg(c, "标签筛选参数无效")
				return
			}
			if _, exists := seen[tagId]; exists {
				continue
			}
			seen[tagId] = struct{}{}
			filter.TagIds = append(filter.TagIds, tagId)
		}
	}

	assets, total, err := model.ListDigitalAssets(userId, filter, pageInfo)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(assets)
	common.ApiSuccess(c, pageInfo)
}

func GetDigitalAsset(c *gin.Context) {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	id, ok := parseDigitalAssetId(c)
	if !ok {
		return
	}
	asset, err := model.GetDigitalAsset(userId, id)
	if err != nil {
		digitalAssetError(c, err)
		return
	}
	common.ApiSuccess(c, asset)
}

func CreateDigitalAsset(c *gin.Context) {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	request, ok := bindDigitalAssetWriteRequest(c)
	if !ok {
		return
	}
	asset, err := model.CreateDigitalAsset(userId, request.AssetType, request.Title, request.Content, request.Tags, request.ImageId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, asset)
}

func UpdateDigitalAsset(c *gin.Context) {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	id, ok := parseDigitalAssetId(c)
	if !ok {
		return
	}
	request, ok := bindDigitalAssetWriteRequest(c)
	if !ok {
		return
	}
	asset, err := model.UpdateDigitalAsset(userId, id, request.AssetType, request.Title, request.Content, request.Tags, request.ImageId)
	if err != nil {
		digitalAssetError(c, err)
		return
	}
	common.ApiSuccess(c, asset)
}

func SetDigitalAssetFavorite(c *gin.Context) {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	id, ok := parseDigitalAssetId(c)
	if !ok {
		return
	}
	request := dto.DigitalAssetFavoriteRequest{}
	if err := c.ShouldBindJSON(&request); err != nil || request.IsFavorite == nil {
		common.ApiErrorMsg(c, "收藏状态无效")
		return
	}
	asset, err := model.SetDigitalAssetFavorite(userId, id, *request.IsFavorite)
	if err != nil {
		digitalAssetError(c, err)
		return
	}
	common.ApiSuccess(c, asset)
}

func DeleteDigitalAsset(c *gin.Context) {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	id, ok := parseDigitalAssetId(c)
	if !ok {
		return
	}
	if err := model.DeleteDigitalAsset(userId, id); err != nil {
		digitalAssetError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func ListDigitalAssetTags(c *gin.Context) {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	tags, err := model.ListDigitalAssetTags(userId)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, tags)
}

func DeleteDigitalAssetTag(c *gin.Context) {
	userId := common.GetContextKeyInt(c, constant.ContextKeyUserId)
	id, ok := parseDigitalAssetId(c)
	if !ok {
		return
	}
	if err := model.DeleteDigitalAssetTag(userId, id); err != nil {
		digitalAssetError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}

func parseDigitalAssetId(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "数字资产不存在")
		return 0, false
	}
	return id, true
}

func bindDigitalAssetWriteRequest(c *gin.Context) (*dto.DigitalAssetWriteRequest, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, dto.DigitalAssetMaxRequestBodyBytes)
	request := &dto.DigitalAssetWriteRequest{}
	if err := c.ShouldBindJSON(request); err != nil {
		common.ApiErrorMsg(c, "请求内容无效")
		return nil, false
	}
	request.AssetType = strings.TrimSpace(request.AssetType)
	request.Title = strings.TrimSpace(request.Title)
	if request.AssetType != model.DigitalAssetTypeText && request.AssetType != model.DigitalAssetTypeImage {
		common.ApiErrorMsg(c, "仅支持文本或图片数字资产")
		return nil, false
	}
	if request.Title == "" || utf8.RuneCountInString(request.Title) > dto.DigitalAssetMaxTitleLength {
		common.ApiErrorMsg(c, "标题长度必须为 1 到 100 个字符")
		return nil, false
	}
	if request.AssetType == model.DigitalAssetTypeText {
		if strings.TrimSpace(request.Content) == "" || utf8.RuneCountInString(request.Content) > dto.DigitalAssetMaxContentLength {
			common.ApiErrorMsg(c, "内容长度必须为 1 到 100000 个字符")
			return nil, false
		}
	} else {
		if utf8.RuneCountInString(request.Content) > dto.DigitalAssetMaxContentLength {
			common.ApiErrorMsg(c, "内容长度不能超过 100000 个字符")
			return nil, false
		}
	}

	if request.ImageId != nil && strings.TrimSpace(*request.ImageId) != "" {
		trimmedImageId := strings.TrimSpace(*request.ImageId)
		request.ImageId = &trimmedImageId
		_, err := model.GetImageById(*request.ImageId)
		if err != nil {
			if errors.Is(err, model.ErrImageNotFound) {
				common.ApiErrorMsg(c, "图片不存在")
				return nil, false
			}
			common.ApiError(c, err)
			return nil, false
		}
	} else if request.AssetType == model.DigitalAssetTypeImage {
		common.ApiErrorMsg(c, "图片资产必须指定图片")
		return nil, false
	} else {
		request.ImageId = nil
	}
	if len(request.Tags) > dto.DigitalAssetMaxTags {
		common.ApiErrorMsg(c, "每个资产最多可使用 20 个标签")
		return nil, false
	}

	tags := make([]string, 0, len(request.Tags))
	seen := make(map[string]struct{}, len(request.Tags))
	for _, name := range request.Tags {
		name = strings.TrimSpace(name)
		normalizedName := model.NormalizeDigitalAssetTagName(name)
		if name == "" || utf8.RuneCountInString(name) > dto.DigitalAssetMaxTagLength {
			common.ApiErrorMsg(c, "标签长度必须为 1 到 32 个字符")
			return nil, false
		}
		if _, exists := seen[normalizedName]; exists {
			continue
		}
		seen[normalizedName] = struct{}{}
		tags = append(tags, name)
	}
	request.Tags = tags
	return request, true
}

func digitalAssetError(c *gin.Context, err error) {
	if errors.Is(err, model.ErrDigitalAssetNotFound) {
		common.ApiErrorMsg(c, "数字资产不存在")
		return
	}
	common.ApiError(c, err)
}
