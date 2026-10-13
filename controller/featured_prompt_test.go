package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type featuredPromptTestResponse[T any] struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    T      `json:"data"`
}

type featuredPromptTestPage struct {
	Page     int                     `json:"page"`
	PageSize int                     `json:"page_size"`
	Total    int                     `json:"total"`
	Items    []*model.FeaturedPrompt `json:"items"`
}

func setupFeaturedPromptHTTPTest(t *testing.T) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() { model.DB = originalDB })
	require.NoError(t, db.AutoMigrate(&model.FeaturedPrompt{}))

	router := gin.New()
	router.GET("/api/featured-prompts", ListFeaturedPrompts)
	return router, db
}

func TestFeaturedPromptHTTPListsPaginatedItemsInConfiguredOrder(t *testing.T) {
	router, db := setupFeaturedPromptHTTPTest(t)
	require.NoError(t, db.Create(&[]model.FeaturedPrompt{
		{Title: "第二条", Prompt: "Cyberpunk neon cat", CoverURL: "https://assets.test/2.webp", CoverKey: "featured/2.webp", SortOrder: 2},
		{Title: "第一条", Prompt: "prompt-1", CoverURL: "https://assets.test/1.webp", CoverKey: "featured/1.webp", SortOrder: 1},
		{Title: "水墨山水", Prompt: "Chinese landscape painting", CoverURL: "https://assets.test/3.webp", CoverKey: "featured/3.webp", SortOrder: 3},
		{Title: "第四条", Prompt: "prompt-4", CoverURL: "https://assets.test/4.webp", CoverKey: "featured/4.webp", SortOrder: 4},
		{Title: "第五条", Prompt: "prompt-5", CoverURL: "https://assets.test/5.webp", CoverKey: "featured/5.webp", SortOrder: 5},
		{Title: "第六条", Prompt: "prompt-6", CoverURL: "https://assets.test/6.webp", CoverKey: "featured/6.webp", SortOrder: 6},
		{Title: "第七条", Prompt: "prompt-7", CoverURL: "https://assets.test/7.webp", CoverKey: "featured/7.webp", SortOrder: 7},
	}).Error)

	// 1. 未传 page_size 时默认单页 6 条
	defaultPage := performFeaturedPromptJSON[featuredPromptTestPage](t, router, http.MethodGet, "/api/featured-prompts?p=1", "")
	require.True(t, defaultPage.Success)
	assert.Equal(t, 6, defaultPage.Data.PageSize)
	assert.Equal(t, 7, defaultPage.Data.Total)
	require.Len(t, defaultPage.Data.Items, 6)
	assert.Equal(t, "第一条", defaultPage.Data.Items[0].Title)
	assert.Equal(t, "https://assets.test/1.webp", defaultPage.Data.Items[0].CoverURL)

	secondPage := performFeaturedPromptJSON[featuredPromptTestPage](t, router, http.MethodGet, "/api/featured-prompts?p=2", "")
	require.True(t, secondPage.Success)
	require.Len(t, secondPage.Data.Items, 1)
	assert.Equal(t, "第七条", secondPage.Data.Items[0].Title)

	// 2. 显式指定 page_size 生效
	customPage := performFeaturedPromptJSON[featuredPromptTestPage](t, router, http.MethodGet, "/api/featured-prompts?p=1&page_size=3", "")
	require.True(t, customPage.Success)
	assert.Equal(t, 3, customPage.Data.PageSize)
	assert.Equal(t, 7, customPage.Data.Total)
	require.Len(t, customPage.Data.Items, 3)

	// 3. keyword 模糊匹配标题
	titleFilter := performFeaturedPromptJSON[featuredPromptTestPage](t, router, http.MethodGet, "/api/featured-prompts?keyword=山水", "")
	require.True(t, titleFilter.Success)
	assert.Equal(t, 1, titleFilter.Data.Total)
	require.Len(t, titleFilter.Data.Items, 1)
	assert.Equal(t, "水墨山水", titleFilter.Data.Items[0].Title)

	// 4. keyword 模糊匹配提示词（大小写不敏感）
	promptFilter := performFeaturedPromptJSON[featuredPromptTestPage](t, router, http.MethodGet, "/api/featured-prompts?keyword=cyberpunk", "")
	require.True(t, promptFilter.Success)
	assert.Equal(t, 1, promptFilter.Data.Total)
	require.Len(t, promptFilter.Data.Items, 1)
	assert.Equal(t, "第二条", promptFilter.Data.Items[0].Title)

	// 5. q 别名生效
	aliasFilter := performFeaturedPromptJSON[featuredPromptTestPage](t, router, http.MethodGet, "/api/featured-prompts?q=Chinese", "")
	require.True(t, aliasFilter.Success)
	assert.Equal(t, 1, aliasFilter.Data.Total)
	require.Len(t, aliasFilter.Data.Items, 1)
	assert.Equal(t, "水墨山水", aliasFilter.Data.Items[0].Title)

	// 6. 无命中时返回空列表
	emptyFilter := performFeaturedPromptJSON[featuredPromptTestPage](t, router, http.MethodGet, "/api/featured-prompts?keyword=notfound", "")
	require.True(t, emptyFilter.Success)
	assert.Equal(t, 0, emptyFilter.Data.Total)
	assert.Empty(t, emptyFilter.Data.Items)
}

type featuredPromptTestStore struct {
	uploaded  []string
	deleted   []string
	uploadErr error
}

func (s *featuredPromptTestStore) Upload(_ context.Context, _ []byte, contentType string) (string, string, error) {
	if s.uploadErr != nil {
		return "", "", s.uploadErr
	}
	key := fmt.Sprintf("featured/%d.webp", len(s.uploaded)+1)
	s.uploaded = append(s.uploaded, contentType)
	return key, "https://assets.test/" + key, nil
}

func (s *featuredPromptTestStore) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	return nil
}

func TestFeaturedPromptAdminHTTPManagesContentAndOrder(t *testing.T) {
	router, _ := setupFeaturedPromptHTTPTest(t)
	store := &featuredPromptTestStore{}
	originalStore := featuredPromptStore
	featuredPromptStore = store
	t.Cleanup(func() { featuredPromptStore = originalStore })
	router.POST("/api/featured-prompts", CreateFeaturedPrompt)
	router.PUT("/api/featured-prompts/:id", UpdateFeaturedPrompt)
	router.POST("/api/featured-prompts/:id/move", MoveFeaturedPrompt)
	router.DELETE("/api/featured-prompts/:id", DeleteFeaturedPrompt)

	first := performFeaturedPromptMultipart(t, router, http.MethodPost, "/api/featured-prompts", map[string]string{
		"title": "第一条", "prompt": "first prompt",
	}, true)
	require.True(t, first.Success, first.Message)
	second := performFeaturedPromptMultipart(t, router, http.MethodPost, "/api/featured-prompts", map[string]string{
		"title": "第二条", "prompt": "second prompt",
	}, true)
	require.True(t, second.Success, second.Message)
	assert.Equal(t, 1, second.Data.SortOrder)

	page := performFeaturedPromptJSON[featuredPromptTestPage](t, router, http.MethodGet, "/api/featured-prompts?p=1&page_size=6", "")
	require.True(t, page.Success)
	require.Len(t, page.Data.Items, 2)
	assert.Equal(t, second.Data.Id, page.Data.Items[0].Id)

	moved := performFeaturedPromptJSON[model.FeaturedPrompt](t, router, http.MethodPost, fmt.Sprintf("/api/featured-prompts/%d/move", first.Data.Id), `{"direction":"up"}`)
	require.True(t, moved.Success, moved.Message)
	assert.Equal(t, 1, moved.Data.SortOrder)
	boundaryMove := performFeaturedPromptJSON[model.FeaturedPrompt](t, router, http.MethodPost, fmt.Sprintf("/api/featured-prompts/%d/move", first.Data.Id), `{"direction":"up"}`)
	require.True(t, boundaryMove.Success, boundaryMove.Message)
	assert.Equal(t, 1, boundaryMove.Data.SortOrder)

	updated := performFeaturedPromptMultipart(t, router, http.MethodPut, fmt.Sprintf("/api/featured-prompts/%d", first.Data.Id), map[string]string{
		"title": "更新标题", "prompt": "updated prompt",
	}, true)
	require.True(t, updated.Success, updated.Message)
	assert.Equal(t, "更新标题", updated.Data.Title)
	assert.Equal(t, "https://assets.test/featured/3.webp", updated.Data.CoverURL)
	assert.Equal(t, []string{"featured/1.webp"}, store.deleted)

	deleted := performFeaturedPromptJSON[any](t, router, http.MethodDelete, fmt.Sprintf("/api/featured-prompts/%d", second.Data.Id), "")
	require.True(t, deleted.Success, deleted.Message)
	assert.Equal(t, []string{"featured/1.webp", "featured/2.webp"}, store.deleted)
}

func TestFeaturedPromptAdminHTTPRequiresCoverAndRejectsInvalidImage(t *testing.T) {
	router, _ := setupFeaturedPromptHTTPTest(t)
	router.POST("/api/featured-prompts", CreateFeaturedPrompt)

	response := performFeaturedPromptMultipart(t, router, http.MethodPost, "/api/featured-prompts", map[string]string{
		"title": "缺少封面", "description": "描述", "prompt": "prompt",
	}, false)
	assert.False(t, response.Success)
	assert.Contains(t, response.Message, "封面")

	invalid := performFeaturedPromptMultipartWithCoverData(t, router, http.MethodPost, "/api/featured-prompts", map[string]string{
		"title": "无效封面", "description": "描述", "prompt": "prompt",
	}, []byte("not-an-image"))
	assert.False(t, invalid.Success)
	assert.Contains(t, invalid.Message, "JPEG")

	oversized := performFeaturedPromptMultipartWithCoverData(t, router, http.MethodPost, "/api/featured-prompts", map[string]string{
		"title": "过大封面", "description": "描述", "prompt": "prompt",
	}, make([]byte, featuredPromptMaxCoverBytes+1))
	assert.False(t, oversized.Success)
	assert.Contains(t, oversized.Message, "5 MB")
}

func TestFeaturedPromptAdminHTTPRejectsNonAdminAndDoesNotSaveAfterUploadFailure(t *testing.T) {
	router, db := setupFeaturedPromptHTTPTest(t)
	router.POST("/api/admin-only-featured-prompts", middleware.AdminAuth(), CreateFeaturedPrompt)
	unauthorizedBody := &bytes.Buffer{}
	unauthorizedWriter := multipart.NewWriter(unauthorizedBody)
	require.NoError(t, unauthorizedWriter.WriteField("title", "越权内容"))
	require.NoError(t, unauthorizedWriter.Close())
	unauthorizedRequest := httptest.NewRequest(http.MethodPost, "/api/admin-only-featured-prompts", unauthorizedBody)
	unauthorizedRequest.Header.Set("Content-Type", unauthorizedWriter.FormDataContentType())
	unauthorizedRecorder := httptest.NewRecorder()
	router.ServeHTTP(unauthorizedRecorder, unauthorizedRequest)
	assert.Equal(t, http.StatusUnauthorized, unauthorizedRecorder.Code)

	store := &featuredPromptTestStore{uploadErr: errors.New("storage unavailable")}
	originalStore := featuredPromptStore
	featuredPromptStore = store
	t.Cleanup(func() { featuredPromptStore = originalStore })
	router.POST("/api/featured-prompts", CreateFeaturedPrompt)
	failed := performFeaturedPromptMultipart(t, router, http.MethodPost, "/api/featured-prompts", map[string]string{
		"title": "上传失败", "description": "描述", "prompt": "prompt",
	}, true)
	assert.False(t, failed.Success)
	var count int64
	require.NoError(t, db.Model(&model.FeaturedPrompt{}).Count(&count).Error)
	assert.Zero(t, count)
}

func TestFeaturedPromptAdminHTTPCleansUploadedCoverAfterDatabaseFailure(t *testing.T) {
	router, db := setupFeaturedPromptHTTPTest(t)
	store := &featuredPromptTestStore{}
	originalStore := featuredPromptStore
	featuredPromptStore = store
	t.Cleanup(func() { featuredPromptStore = originalStore })
	router.POST("/api/featured-prompts", CreateFeaturedPrompt)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	require.NoError(t, sqlDB.Close())

	failed := performFeaturedPromptMultipart(t, router, http.MethodPost, "/api/featured-prompts", map[string]string{
		"title": "数据库失败", "description": "描述", "prompt": "prompt",
	}, true)
	assert.False(t, failed.Success)
	assert.Equal(t, []string{"featured/1.webp"}, store.deleted)
}

func performFeaturedPromptMultipart(t *testing.T, router http.Handler, method string, path string, fields map[string]string, withCover bool) featuredPromptTestResponse[model.FeaturedPrompt] {
	t.Helper()
	var coverData []byte
	if withCover {
		coverData = []byte("RIFF\x0c\x00\x00\x00WEBPVP8 ")
	}
	return performFeaturedPromptMultipartWithCoverData(t, router, method, path, fields, coverData)
}

func performFeaturedPromptMultipartWithCoverData(t *testing.T, router http.Handler, method string, path string, fields map[string]string, coverData []byte) featuredPromptTestResponse[model.FeaturedPrompt] {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	for key, value := range fields {
		require.NoError(t, writer.WriteField(key, value))
	}
	if coverData != nil {
		part, err := writer.CreateFormFile("cover", "cover.webp")
		require.NoError(t, err)
		_, err = part.Write(coverData)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	request := httptest.NewRequest(method, path, body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)
	response := featuredPromptTestResponse[model.FeaturedPrompt]{}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}

func performFeaturedPromptJSON[T any](t *testing.T, router http.Handler, method string, path string, body string) featuredPromptTestResponse[T] {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code)
	response := featuredPromptTestResponse[T]{}
	require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &response))
	return response
}
