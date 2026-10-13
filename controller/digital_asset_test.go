package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type digitalAssetTestResponse[T any] struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

type digitalAssetTestPage struct {
	Page     int                   `json:"page"`
	PageSize int                   `json:"page_size"`
	Total    int                   `json:"total"`
	Items    []*model.DigitalAsset `json:"items"`
}

func TestDigitalAssetHTTPContractAndUserIsolation(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() { model.DB = originalDB })
	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.Image{},
		&model.DigitalAsset{},
		&model.DigitalAssetTag{},
		&model.DigitalAssetTagLink{},
	))
	for id := 1; id <= 2; id++ {
		require.NoError(t, db.Create(&model.User{
			Id:       id,
			Username: fmt.Sprintf("asset-user-%d", id),
			Password: "password123",
			Email:    fmt.Sprintf("asset-user-%d@example.com", id),
			AffCode:  fmt.Sprintf("asset-aff-%d", id),
		}).Error)
	}

	router := gin.New()
	router.Use(func(c *gin.Context) {
		userId := 1
		if c.GetHeader("X-Test-User") == "2" {
			userId = 2
		}
		common.SetContextKey(c, constant.ContextKeyUserId, userId)
		c.Next()
	})
	router.GET("/api/digital-assets/", ListDigitalAssets)
	router.GET("/api/digital-assets/tags", ListDigitalAssetTags)
	router.DELETE("/api/digital-assets/tags/:id", DeleteDigitalAssetTag)
	router.GET("/api/digital-assets/:id", GetDigitalAsset)
	router.POST("/api/digital-assets/", CreateDigitalAsset)
	router.PUT("/api/digital-assets/:id", UpdateDigitalAsset)
	router.PATCH("/api/digital-assets/:id/favorite", SetDigitalAssetFavorite)
	router.DELETE("/api/digital-assets/:id", DeleteDigitalAsset)

	created := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPost, "/api/digital-assets/", `{
		"asset_type":"text",
		"title":"角色提示词",
		"content":"  Create a detailed character portrait  ",
		"tags":[" 角色 ","角色","Scene","scene"]
	}`, "1")
	require.True(t, created.Success)
	assert.Equal(t, "  Create a detailed character portrait  ", created.Data.Content)
	require.Len(t, created.Data.Tags, 2)
	assert.Equal(t, "Scene", created.Data.Tags[0].Name)
	assert.Equal(t, "角色", created.Data.Tags[1].Name)

	second := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPost, "/api/digital-assets/", `{
		"asset_type":"text",
		"title":"场景提示词",
		"content":"A bright city scene",
		"tags":["Scene","物品"]
	}`, "1")
	require.True(t, second.Success)

	tags := performDigitalAssetRequest[[]model.DigitalAssetTag](t, router, http.MethodGet, "/api/digital-assets/tags", "", "1")
	require.True(t, tags.Success)
	require.Len(t, tags.Data, 3)

	page := performDigitalAssetRequest[digitalAssetTestPage](t, router, http.MethodGet, "/api/digital-assets/?p=1&page_size=1", "", "1")
	require.True(t, page.Success)
	assert.Equal(t, 2, page.Data.Total)
	require.Len(t, page.Data.Items, 1)
	assert.Equal(t, second.Data.Id, page.Data.Items[0].Id)

	require.NoError(t, db.Create(&model.Image{
		Id:       "img-test-1",
		UserId:   2,
		Key:      "keys/img1.png",
		URL:      "https://example.com/img1.png",
		Width:    800,
		Height:   600,
		Bytes:    1024,
		MimeType: "image/png",
	}).Error)

	imageAsset := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPost, "/api/digital-assets/", `{
		"asset_type":"image",
		"title":"画作资产",
		"content":"a painting prompt",
		"tags":["画作"],
		"image_id":"img-test-1"
	}`, "1")
	require.True(t, imageAsset.Success)
	assert.Equal(t, model.DigitalAssetTypeImage, imageAsset.Data.AssetType)
	require.NotNil(t, imageAsset.Data.ImageId)
	assert.Equal(t, "img-test-1", *imageAsset.Data.ImageId)
	require.NotNil(t, imageAsset.Data.Image)
	assert.Equal(t, "https://example.com/img1.png", imageAsset.Data.Image.URL)
	assert.Equal(t, 800, imageAsset.Data.Image.Width)

	textList := performDigitalAssetRequest[digitalAssetTestPage](t, router, http.MethodGet, "/api/digital-assets/?asset_type=text", "", "1")
	require.True(t, textList.Success)
	assert.Equal(t, 2, textList.Data.Total)
	for _, item := range textList.Data.Items {
		assert.Equal(t, model.DigitalAssetTypeText, item.AssetType)
	}

	imageList := performDigitalAssetRequest[digitalAssetTestPage](t, router, http.MethodGet, "/api/digital-assets/?asset_type=image", "", "1")
	require.True(t, imageList.Success)
	assert.Equal(t, 1, imageList.Data.Total)
	require.Len(t, imageList.Data.Items, 1)
	assert.Equal(t, imageAsset.Data.Id, imageList.Data.Items[0].Id)
	require.NotNil(t, imageList.Data.Items[0].Image)
	assert.Equal(t, "https://example.com/img1.png", imageList.Data.Items[0].Image.URL)

	oldUpdatedAt := int64(10)
	require.NoError(t, db.Model(&model.DigitalAsset{}).Where("id = ?", created.Data.Id).UpdateColumn("updated_at", oldUpdatedAt).Error)
	favorite := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPatch, fmt.Sprintf("/api/digital-assets/%d/favorite", created.Data.Id), `{"is_favorite":true}`, "1")
	require.True(t, favorite.Success)
	assert.True(t, favorite.Data.IsFavorite)
	assert.Equal(t, oldUpdatedAt, favorite.Data.UpdatedAt)

	favoritePage := performDigitalAssetRequest[digitalAssetTestPage](t, router, http.MethodGet, "/api/digital-assets/?favorite=true&p=1&page_size=6", "", "1")
	require.True(t, favoritePage.Success)
	require.Len(t, favoritePage.Data.Items, 1)
	assert.Equal(t, created.Data.Id, favoritePage.Data.Items[0].Id)

	foreignGet := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodGet, fmt.Sprintf("/api/digital-assets/%d", created.Data.Id), "", "2")
	foreignFavorite := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPatch, fmt.Sprintf("/api/digital-assets/%d/favorite", created.Data.Id), `{"is_favorite":false}`, "2")
	assert.False(t, foreignGet.Success)
	assert.False(t, foreignFavorite.Success)
	assert.Equal(t, foreignGet.Message, foreignFavorite.Message)

	updated := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPut, fmt.Sprintf("/api/digital-assets/%d", created.Data.Id), `{
		"asset_type":"text",
		"title":"更新后的提示词",
		"content":"Updated prompt content",
		"tags":["角色"]
	}`, "1")
	require.True(t, updated.Success)
	assert.Equal(t, "更新后的提示词", updated.Data.Title)
	assert.Greater(t, updated.Data.UpdatedAt, oldUpdatedAt)
	require.Len(t, updated.Data.Tags, 1)

	var sceneTagId int
	for _, tag := range tags.Data {
		if tag.Name == "Scene" {
			sceneTagId = tag.Id
		}
	}
	require.Positive(t, sceneTagId)
	foreignTagDelete := performDigitalAssetRequest[any](t, router, http.MethodDelete, fmt.Sprintf("/api/digital-assets/tags/%d", sceneTagId), "", "2")
	assert.False(t, foreignTagDelete.Success)
	tagDeleted := performDigitalAssetRequest[any](t, router, http.MethodDelete, fmt.Sprintf("/api/digital-assets/tags/%d", sceneTagId), "", "1")
	require.True(t, tagDeleted.Success)
	secondAfterTagDelete := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodGet, fmt.Sprintf("/api/digital-assets/%d", second.Data.Id), "", "1")
	require.True(t, secondAfterTagDelete.Success)
	assert.Equal(t, second.Data.UpdatedAt, secondAfterTagDelete.Data.UpdatedAt)
	require.Len(t, secondAfterTagDelete.Data.Tags, 1)
	assert.Equal(t, "物品", secondAfterTagDelete.Data.Tags[0].Name)

	deleted := performDigitalAssetRequest[any](t, router, http.MethodDelete, fmt.Sprintf("/api/digital-assets/%d", created.Data.Id), "", "1")
	require.True(t, deleted.Success)
	missing := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodGet, fmt.Sprintf("/api/digital-assets/%d", created.Data.Id), "", "1")
	assert.False(t, missing.Success)
	assert.Equal(t, foreignGet.Message, missing.Message)

	deletedImageAsset := performDigitalAssetRequest[any](t, router, http.MethodDelete, fmt.Sprintf("/api/digital-assets/%d", imageAsset.Data.Id), "", "1")
	require.True(t, deletedImageAsset.Success)
	imgStillExists, err := model.GetImageById("img-test-1")
	require.NoError(t, err)
	assert.NotNil(t, imgStillExists)

	emptyContentImageAsset := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPost, "/api/digital-assets/", `{
		"asset_type":"image",
		"title":"纯图片资产",
		"content":"",
		"tags":["纯图"],
		"image_id":"img-test-1"
	}`, "1")
	require.True(t, emptyContentImageAsset.Success)
	assert.Equal(t, "", emptyContentImageAsset.Data.Content)
	assert.Equal(t, "纯图片资产", emptyContentImageAsset.Data.Title)

	textWithImage := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPost, "/api/digital-assets/", `{
		"asset_type":"text",
		"title":"带参考图提示词",
		"content":"A cyberpunk cat portrait",
		"tags":["赛博"],
		"image_id":"img-test-1"
	}`, "1")
	require.True(t, textWithImage.Success)
	assert.Equal(t, model.DigitalAssetTypeText, textWithImage.Data.AssetType)
	require.NotNil(t, textWithImage.Data.ImageId)
	assert.Equal(t, "img-test-1", *textWithImage.Data.ImageId)
	require.NotNil(t, textWithImage.Data.Image)
	assert.Equal(t, "https://example.com/img1.png", textWithImage.Data.Image.URL)

	textUnbindImage := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPut, fmt.Sprintf("/api/digital-assets/%d", textWithImage.Data.Id), `{
		"asset_type":"text",
		"title":"解绑参考图后的提示词",
		"content":"A cyberpunk cat portrait without image",
		"tags":["赛博"]
	}`, "1")
	require.True(t, textUnbindImage.Success)
	assert.Nil(t, textUnbindImage.Data.ImageId)
	assert.Nil(t, textUnbindImage.Data.Image)

	textRebindImage := performDigitalAssetRequest[model.DigitalAsset](t, router, http.MethodPut, fmt.Sprintf("/api/digital-assets/%d", textWithImage.Data.Id), `{
		"asset_type":"text",
		"title":"重新绑定参考图",
		"content":"A cyberpunk cat portrait with rebind",
		"tags":["赛博"],
		"image_id":"img-test-1"
	}`, "1")
	require.True(t, textRebindImage.Success)
	require.NotNil(t, textRebindImage.Data.ImageId)
	assert.Equal(t, "img-test-1", *textRebindImage.Data.ImageId)
	require.NotNil(t, textRebindImage.Data.Image)
}

func TestDigitalAssetHTTPRejectsUnsupportedAndOversizedInput(t *testing.T) {
	gin.SetMode(gin.TestMode)
	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() { model.DB = originalDB })
	require.NoError(t, db.AutoMigrate(
		&model.User{},
		&model.Image{},
		&model.DigitalAsset{},
	))

	router := gin.New()
	router.Use(func(c *gin.Context) {
		common.SetContextKey(c, constant.ContextKeyUserId, 1)
		c.Next()
	})
	router.GET("/api/digital-assets/", ListDigitalAssets)
	router.POST("/api/digital-assets/", CreateDigitalAsset)

	unsupported := performDigitalAssetRequest[any](t, router, http.MethodPost, "/api/digital-assets/", `{"asset_type":"audio","title":"x","content":"x"}`, "1")
	assert.False(t, unsupported.Success)
	assert.Contains(t, unsupported.Message, "仅支持文本或图片")

	missingImageId := performDigitalAssetRequest[any](t, router, http.MethodPost, "/api/digital-assets/", `{"asset_type":"image","title":"x","content":"x"}`, "1")
	assert.False(t, missingImageId.Success)
	assert.Contains(t, missingImageId.Message, "必须指定图片")

	nonexistentImage := performDigitalAssetRequest[any](t, router, http.MethodPost, "/api/digital-assets/", `{"asset_type":"image","title":"x","image_id":"no-such-image"}`, "1")
	assert.False(t, nonexistentImage.Success)
	assert.Contains(t, nonexistentImage.Message, "图片不存在")

	textNonexistentImage := performDigitalAssetRequest[any](t, router, http.MethodPost, "/api/digital-assets/", `{"asset_type":"text","title":"带不存在图片的提示词","content":"valid content","image_id":"no-such-image"}`, "1")
	assert.False(t, textNonexistentImage.Success)
	assert.Contains(t, textNonexistentImage.Message, "图片不存在")

	invalidTypeFilter := performDigitalAssetRequest[any](t, router, http.MethodGet, "/api/digital-assets/?asset_type=unknown", "", "1")
	assert.False(t, invalidTypeFilter.Success)
	assert.Contains(t, invalidTypeFilter.Message, "资产类型无效")

	oversizedTitle := strings.Repeat("a", 101)
	invalid := performDigitalAssetRequest[any](t, router, http.MethodPost, "/api/digital-assets/", fmt.Sprintf(`{"asset_type":"text","title":"%s","content":"x"}`, oversizedTitle), "1")
	assert.False(t, invalid.Success)
	assert.Contains(t, invalid.Message, "标题长度")
}

func performDigitalAssetRequest[T any](t *testing.T, router http.Handler, method string, path string, body string, user string) digitalAssetTestResponse[T] {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Test-User", user)
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)
	response := digitalAssetTestResponse[T]{}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}
