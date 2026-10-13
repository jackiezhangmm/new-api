package controller

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupCanvasImageTestEnv(t *testing.T, driver service.StorageDriver) *gin.Engine {
	t.Helper()
	require.NoError(t, i18n.Init())
	gin.SetMode(gin.TestMode)

	originalIsMasterNode := common.IsMasterNode
	originalRedisEnabled := common.RedisEnabled
	originalSQLitePath := common.SQLitePath
	originalMainDatabaseType := common.MainDatabaseType()
	originalLogDatabaseType := common.LogDatabaseType()
	originalSQLDSN, hadSQLDSN := os.LookupEnv("SQL_DSN")

	common.IsMasterNode = false
	common.RedisEnabled = false
	common.SQLitePath = fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	common.SetDatabaseTypes(common.DatabaseTypeSQLite, common.DatabaseTypeSQLite)
	require.NoError(t, os.Setenv("SQL_DSN", "local"))
	require.NoError(t, model.InitDB())
	model.LOG_DB = model.DB
	require.NoError(t, model.DB.AutoMigrate(
		&model.User{},
		&model.Token{},
		&model.Ability{},
		&model.Channel{},
		&model.Log{},
		&model.UserSubscription{},
		&model.UserSession{},
		&model.Image{},
	))

	restoreDriver := SetImageStorageDriverForTest(driver)

	t.Cleanup(func() {
		restoreDriver()
		if sqlDB, err := model.DB.DB(); err == nil {
			_ = sqlDB.Close()
		}
		common.IsMasterNode = originalIsMasterNode
		common.RedisEnabled = originalRedisEnabled
		common.SQLitePath = originalSQLitePath
		common.SetDatabaseTypes(originalMainDatabaseType, originalLogDatabaseType)
		if hadSQLDSN {
			require.NoError(t, os.Setenv("SQL_DSN", originalSQLDSN))
		} else {
			require.NoError(t, os.Unsetenv("SQL_DSN"))
		}
	})

	engine := gin.New()
	canvasRoute := engine.Group("/api/canvas")
	canvasRoute.Use(
		middleware.TokenOrUserAuth(),
		middleware.SetupSessionRelayContext(),
		middleware.RequireSessionAuth(),
		middleware.ModelRequestRateLimit(),
		middleware.Distribute(),
	)
	canvasRoute.POST("/images/generations", CanvasGenerateImages)
	canvasRoute.POST("/images/edits", CanvasEditImages)
	canvasRoute.POST("/images/gemini/models/*path", CanvasGenerateGeminiImages)

	return engine
}

func createCanvasSession(t *testing.T, username string, quota int) (*model.User, string) {
	t.Helper()
	userSetting, err := common.Marshal(dto.UserSetting{AcceptUnsetRatioModel: true})
	require.NoError(t, err)

	user := &model.User{
		Username:    username,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		Quota:       quota,
		Setting:     string(userSetting),
		AuthVersion: 1,
		AffCode:     "aff-" + username,
	}
	require.NoError(t, model.DB.Create(user).Error)

	now := time.Now().Unix()
	session := &model.UserSession{
		SID:             "canvas-session-" + username,
		UserID:          user.Id,
		Version:         1,
		UserAuthVersion: user.AuthVersion,
		Status:          model.UserSessionStatusActive,
		RefreshHash:     "refresh-hash-" + username,
		LoginMethod:     "password",
		LastActiveAt:    now,
		ExpiresAt:       now + 3600,
	}
	require.NoError(t, model.CreateUserSession(session))

	accessToken, _, err := service.IssueAccessToken(service.AuthIdentity{
		UserID:          user.Id,
		SessionID:       session.SID,
		UserAuthVersion: user.AuthVersion,
		SessionVersion:  session.Version,
	})
	require.NoError(t, err)
	return user, accessToken
}

func TestCanvasGenerateImages_Unauthenticated(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/generations", strings.NewReader(`{"model":"dall-e-3","prompt":"a cat"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCanvasGenerateImages_TokenAuthRejected(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	user := &model.User{
		Username: "token-user",
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    10_000_000,
	}
	require.NoError(t, model.DB.Create(user).Error)
	token := &model.Token{
		UserId:         user.Id,
		Name:           "api-token",
		Key:            "testtoken123",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
	}
	require.NoError(t, model.DB.Create(token).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/generations", strings.NewReader(`{"model":"dall-e-3","prompt":"a cat"}`))
	req.Header.Set("Authorization", "Bearer sk-testtoken123")
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "仅允许已登录的画布有效会话访问")
}

func TestCanvasGenerateImages_StorageUnconfigured(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: false}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	_, accessToken := createCanvasSession(t, "canvas-user-unconf", 10_000_000)

	baseURL := "https://api.example.com"
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-unconf-channel",
		BaseURL: &baseURL,
		Models:  "dall-e-3",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "dall-e-3", ChannelId: channel.Id, Enabled: true,
	}).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/generations", strings.NewReader(`{"model":"dall-e-3","prompt":"a cat"}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Contains(t, w.Body.String(), "对象存储未配置或不可用")
}

func TestCanvasGenerateImages_Success_Single_Base64(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	pngBytes := generateValidPNG(t, 256, 256)
	b64Img := base64.StdEncoding.EncodeToString(pngBytes)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/images/generations", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(`{"created":123456789,"data":[{"b64_json":"%s"}]}`, b64Img)))
	}))
	defer upstream.Close()

	user, accessToken := createCanvasSession(t, "canvas-user-single", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-single-channel",
		BaseURL: &baseURL,
		Models:  "dall-e-3",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "dall-e-3", ChannelId: channel.Id, Enabled: true,
	}).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/generations", strings.NewReader(`{"model":"dall-e-3","prompt":"a nice cat"}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		Success bool                  `json:"success"`
		Data    []UploadImageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.Len(t, resp.Data, 1)

	imgItem := resp.Data[0]
	assert.NotEmpty(t, imgItem.Id)
	assert.Equal(t, 256, imgItem.Width)
	assert.Equal(t, 256, imgItem.Height)
	assert.Equal(t, int64(len(pngBytes)), imgItem.Bytes)
	assert.Equal(t, "image/png", imgItem.MimeType)
	assert.True(t, strings.HasPrefix(imgItem.URL, "https://cdn.example.com/images/"))

	// 验证 S3 Driver 接收到正确的 PutObject
	mockDriver.mu.Lock()
	uploadedData, exists := mockDriver.uploaded[fmt.Sprintf("images/%d/%s.png", user.Id, imgItem.Id)]
	mockDriver.mu.Unlock()
	require.True(t, exists, "S3 driver 必须包含上传的对象")
	assert.Equal(t, pngBytes, uploadedData)

	// 验证数据库 images 表成功落库记录
	dbImg, err := model.GetImageById(imgItem.Id)
	require.NoError(t, err)
	assert.Equal(t, user.Id, dbImg.UserId)
	assert.Equal(t, imgItem.URL, dbImg.URL)
	assert.Equal(t, 256, dbImg.Width)
	assert.Equal(t, 256, dbImg.Height)
	assert.Equal(t, "image/png", dbImg.MimeType)
}

func TestCanvasGenerateImages_Success_Multi_Concurrent(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	png1 := generateValidPNG(t, 100, 100)
	png2 := generateValidPNG(t, 120, 120)
	png3 := generateValidPNG(t, 140, 140)
	png4 := generateValidPNG(t, 160, 160)

	// HTTP 文件服务器，用于模拟 URL 下载
	fileServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/img2.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png2)
		case "/img4.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(png4)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer fileServer.Close()

	b64Png1 := base64.StdEncoding.EncodeToString(png1)
	b64Png3 := base64.StdEncoding.EncodeToString(png3)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/images/generations", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		respJSON := fmt.Sprintf(`{
			"created": 123456789,
			"data": [
				{"b64_json": "%s"},
				{"url": "%s/img2.png"},
				{"b64_json": "%s"},
				{"url": "%s/img4.png"}
			]
		}`, b64Png1, fileServer.URL, b64Png3, fileServer.URL)
		_, _ = w.Write([]byte(respJSON))
	}))
	defer upstream.Close()

	user, accessToken := createCanvasSession(t, "canvas-user-multi", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-multi-channel",
		BaseURL: &baseURL,
		Models:  "dall-e-3",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "dall-e-3", ChannelId: channel.Id, Enabled: true,
	}).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/generations", strings.NewReader(`{"model":"dall-e-3","prompt":"4 cats","n":4}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		Success bool                  `json:"success"`
		Data    []UploadImageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.Len(t, resp.Data, 4)

	expectedDimensions := [][2]int{
		{100, 100},
		{120, 120},
		{140, 140},
		{160, 160},
	}

	for i, imgItem := range resp.Data {
		assert.NotEmpty(t, imgItem.Id)
		assert.Equal(t, expectedDimensions[i][0], imgItem.Width)
		assert.Equal(t, expectedDimensions[i][1], imgItem.Height)
		assert.Equal(t, "image/png", imgItem.MimeType)

		// 验证数据库落地
		dbImg, err := model.GetImageById(imgItem.Id)
		require.NoError(t, err)
		assert.Equal(t, user.Id, dbImg.UserId)
		assert.Equal(t, imgItem.URL, dbImg.URL)
	}

	mockDriver.mu.Lock()
	assert.Len(t, mockDriver.uploaded, 4, "S3 驱动必须收到全部 4 张图片的上传")
	mockDriver.mu.Unlock()
}

func TestCanvasGenerateImages_InsufficientQuota(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":[]}`))
	}))
	defer upstream.Close()

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-quota-channel",
		BaseURL: &baseURL,
		Models:  "dall-e-3",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "dall-e-3", ChannelId: channel.Id, Enabled: true,
	}).Error)

	// 零额度用户
	_, accessToken := createCanvasSession(t, "canvas-user-zeroquota", 0)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/generations", strings.NewReader(`{"model":"dall-e-3","prompt":"a cat"}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestCanvasGenerateImages_UpstreamError(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"safety violation","type":"invalid_request_error"}}`))
	}))
	defer upstream.Close()

	_, accessToken := createCanvasSession(t, "canvas-user-upstream-err", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-err-channel",
		BaseURL: &baseURL,
		Models:  "dall-e-3",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "dall-e-3", ChannelId: channel.Id, Enabled: true,
	}).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/generations", strings.NewReader(`{"model":"dall-e-3","prompt":"bad prompt"}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "safety violation")
}

func createMultipartImageEditBody(t *testing.T, model string, prompt string, n int, size string, images ...[]byte) (*bytes.Buffer, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if model != "" {
		require.NoError(t, writer.WriteField("model", model))
	}
	if prompt != "" {
		require.NoError(t, writer.WriteField("prompt", prompt))
	}
	if n > 0 {
		require.NoError(t, writer.WriteField("n", fmt.Sprintf("%d", n)))
	}
	if size != "" {
		require.NoError(t, writer.WriteField("size", size))
	}
	for i, img := range images {
		fieldName := "image"
		if len(images) > 1 {
			fieldName = "image[]"
		}
		part, err := writer.CreateFormFile(fieldName, fmt.Sprintf("ref-%d.png", i))
		require.NoError(t, err)
		_, err = part.Write(img)
		require.NoError(t, err)
	}
	require.NoError(t, writer.Close())
	return &body, writer.FormDataContentType()
}

func TestCanvasEditImages_Unauthenticated(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	pngBytes := generateValidPNG(t, 64, 64)
	body, contentType := createMultipartImageEditBody(t, "gpt-image-2", "edit prompt", 1, "auto 1k", pngBytes)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/edits", body)
	req.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCanvasEditImages_TokenAuthRejected(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	user := &model.User{
		Username: "token-user-edit",
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    10_000_000,
	}
	require.NoError(t, model.DB.Create(user).Error)
	token := &model.Token{
		UserId:         user.Id,
		Name:           "api-token-edit",
		Key:            "testtokenedit123",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
	}
	require.NoError(t, model.DB.Create(token).Error)

	pngBytes := generateValidPNG(t, 64, 64)
	body, contentType := createMultipartImageEditBody(t, "gpt-image-2", "edit prompt", 1, "auto 1k", pngBytes)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/edits", body)
	req.Header.Set("Authorization", "Bearer sk-testtokenedit123")
	req.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "仅允许已登录的画布有效会话访问")
}

func TestCanvasEditImages_StorageUnconfigured(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: false}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	_, accessToken := createCanvasSession(t, "canvas-user-edit-unconf", 10_000_000)

	baseURL := "https://api.example.com"
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-edit-unconf-channel",
		BaseURL: &baseURL,
		Models:  "gpt-image-2",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "gpt-image-2", ChannelId: channel.Id, Enabled: true,
	}).Error)

	pngBytes := generateValidPNG(t, 64, 64)
	body, contentType := createMultipartImageEditBody(t, "gpt-image-2", "edit prompt", 1, "auto 1k", pngBytes)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/edits", body)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Contains(t, w.Body.String(), "对象存储未配置或不可用")
}

func TestCanvasEditImages_Success_Single_Multipart(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	outPNG := generateValidPNG(t, 256, 256)
	b64Out := base64.StdEncoding.EncodeToString(outPNG)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/images/edits", r.URL.Path)
		assert.Contains(t, r.Header.Get("Content-Type"), "multipart/form-data")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(`{"created":123456789,"data":[{"b64_json":"%s"}]}`, b64Out)))
	}))
	defer upstream.Close()

	user, accessToken := createCanvasSession(t, "canvas-user-edit-single", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-edit-single-channel",
		BaseURL: &baseURL,
		Models:  "gpt-image-2",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "gpt-image-2", ChannelId: channel.Id, Enabled: true,
	}).Error)

	refPNG := generateValidPNG(t, 128, 128)
	body, contentType := createMultipartImageEditBody(t, "gpt-image-2", "make it vintage", 1, "auto 1k", refPNG)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/edits", body)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		Success bool                  `json:"success"`
		Data    []UploadImageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.Len(t, resp.Data, 1)

	imgItem := resp.Data[0]
	assert.NotEmpty(t, imgItem.Id)
	assert.Equal(t, 256, imgItem.Width)
	assert.Equal(t, 256, imgItem.Height)
	assert.Equal(t, int64(len(outPNG)), imgItem.Bytes)
	assert.Equal(t, "image/png", imgItem.MimeType)
	assert.True(t, strings.HasPrefix(imgItem.URL, "https://cdn.example.com/images/"))

	// 验证 S3 Driver 接收到正确的对象
	mockDriver.mu.Lock()
	uploadedData, exists := mockDriver.uploaded[fmt.Sprintf("images/%d/%s.png", user.Id, imgItem.Id)]
	mockDriver.mu.Unlock()
	require.True(t, exists, "S3 driver 必须包含上传的对象")
	assert.Equal(t, outPNG, uploadedData)

	// 验证数据库 images 表成功落库记录
	dbImg, err := model.GetImageById(imgItem.Id)
	require.NoError(t, err)
	assert.Equal(t, user.Id, dbImg.UserId)
	assert.Equal(t, imgItem.URL, dbImg.URL)
	assert.Equal(t, 256, dbImg.Width)
	assert.Equal(t, 256, dbImg.Height)
	assert.Equal(t, "image/png", dbImg.MimeType)
}

func TestCanvasEditImages_Success_MultiReference_MultiOutput(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	png1 := generateValidPNG(t, 100, 100)
	png2 := generateValidPNG(t, 120, 120)
	png3 := generateValidPNG(t, 140, 140)
	png4 := generateValidPNG(t, 160, 160)

	b64_1 := base64.StdEncoding.EncodeToString(png1)
	b64_2 := base64.StdEncoding.EncodeToString(png2)
	b64_3 := base64.StdEncoding.EncodeToString(png3)
	b64_4 := base64.StdEncoding.EncodeToString(png4)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/images/edits", r.URL.Path)
		assert.Contains(t, r.Header.Get("Content-Type"), "multipart/form-data")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(`{"created":123456789,"data":[{"b64_json":"%s"},{"b64_json":"%s"},{"b64_json":"%s"},{"b64_json":"%s"}]}`, b64_1, b64_2, b64_3, b64_4)))
	}))
	defer upstream.Close()

	user, accessToken := createCanvasSession(t, "canvas-user-edit-multi", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-edit-multi-channel",
		BaseURL: &baseURL,
		Models:  "gpt-image-2",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "gpt-image-2", ChannelId: channel.Id, Enabled: true,
	}).Error)

	ref1 := generateValidPNG(t, 80, 80)
	ref2 := generateValidPNG(t, 90, 90)
	ref3 := generateValidPNG(t, 100, 100)
	body, contentType := createMultipartImageEditBody(t, "gpt-image-2", "fuse 3 reference images", 4, "auto 1k", ref1, ref2, ref3)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/edits", body)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		Success bool                  `json:"success"`
		Data    []UploadImageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.Len(t, resp.Data, 4)

	expectedSizes := [][2]int{{100, 100}, {120, 120}, {140, 140}, {160, 160}}
	for i, item := range resp.Data {
		assert.NotEmpty(t, item.Id)
		assert.Equal(t, expectedSizes[i][0], item.Width)
		assert.Equal(t, expectedSizes[i][1], item.Height)

		mockDriver.mu.Lock()
		_, exists := mockDriver.uploaded[fmt.Sprintf("images/%d/%s.png", user.Id, item.Id)]
		mockDriver.mu.Unlock()
		assert.True(t, exists)

		dbImg, err := model.GetImageById(item.Id)
		require.NoError(t, err)
		assert.Equal(t, user.Id, dbImg.UserId)
	}
}

func TestCanvasEditImages_UpstreamError(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"message":"edit prompt policy violation","type":"invalid_request_error"}}`))
	}))
	defer upstream.Close()

	_, accessToken := createCanvasSession(t, "canvas-user-edit-err", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "openai-image-edit-err-channel",
		BaseURL: &baseURL,
		Models:  "gpt-image-2",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "gpt-image-2", ChannelId: channel.Id, Enabled: true,
	}).Error)

	refPNG := generateValidPNG(t, 64, 64)
	body, contentType := createMultipartImageEditBody(t, "gpt-image-2", "unsafe prompt", 1, "auto 1k", refPNG)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/edits", body)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", contentType)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "edit prompt policy violation")
}

func TestCanvasGenerateGeminiImages_Unauthenticated(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/gemini/models/nano-banana-2:generateContent", strings.NewReader(`{"contents":[{"parts":[{"text":"a sunset"}]}]}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCanvasGenerateGeminiImages_StorageUnconfigured(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: false}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	_, accessToken := createCanvasSession(t, "canvas-user-gemini-unconf", 10_000_000)

	baseURL := "https://api.example.com"
	channel := &model.Channel{
		Type:    constant.ChannelTypeGemini,
		Key:     "upstream-gemini-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "gemini-unconf-channel",
		BaseURL: &baseURL,
		Models:  "nano-banana-2",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "nano-banana-2", ChannelId: channel.Id, Enabled: true,
	}).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/gemini/models/nano-banana-2:generateContent", strings.NewReader(`{"contents":[{"parts":[{"text":"a sunset"}]}]}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusInternalServerError, w.Code)
	assert.Contains(t, w.Body.String(), "对象存储未配置或不可用")
}

func TestCanvasGenerateGeminiImages_Success_Single_Base64(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	pngBytes := generateValidPNG(t, 256, 256)
	b64Img := base64.StdEncoding.EncodeToString(pngBytes)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Contains(t, r.URL.Path, "/v1beta/models/nano-banana-2:generateContent")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(fmt.Sprintf(`{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"%s"}}]}}]}`, b64Img)))
	}))
	defer upstream.Close()

	user, accessToken := createCanvasSession(t, "canvas-user-gemini-single", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeGemini,
		Key:     "upstream-gemini-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "gemini-single-channel",
		BaseURL: &baseURL,
		Models:  "nano-banana-2",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "nano-banana-2", ChannelId: channel.Id, Enabled: true,
	}).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/gemini/models/nano-banana-2:generateContent", strings.NewReader(`{"contents":[{"parts":[{"text":"a banana sunset"}]}]}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())

	var resp struct {
		Success bool                  `json:"success"`
		Data    []UploadImageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	require.Len(t, resp.Data, 1)

	imgItem := resp.Data[0]
	assert.NotEmpty(t, imgItem.Id)
	assert.Equal(t, 256, imgItem.Width)
	assert.Equal(t, 256, imgItem.Height)
	assert.Equal(t, int64(len(pngBytes)), imgItem.Bytes)
	assert.Equal(t, "image/png", imgItem.MimeType)
	assert.True(t, strings.HasPrefix(imgItem.URL, "https://cdn.example.com/images/"))

	// 验证 S3 Driver 接收到正确的 PutObject
	mockDriver.mu.Lock()
	uploadedData, exists := mockDriver.uploaded[fmt.Sprintf("images/%d/%s.png", user.Id, imgItem.Id)]
	mockDriver.mu.Unlock()
	require.True(t, exists, "S3 driver 必须包含上传的对象")
	assert.Equal(t, pngBytes, uploadedData)

	// 验证数据库 images 表成功落库记录
	dbImg, err := model.GetImageById(imgItem.Id)
	require.NoError(t, err)
	assert.Equal(t, user.Id, dbImg.UserId)
	assert.Equal(t, 256, dbImg.Width)
	assert.Equal(t, 256, dbImg.Height)
	assert.Equal(t, int64(len(pngBytes)), dbImg.Bytes)
	assert.Equal(t, "image/png", dbImg.MimeType)
}

func TestCanvasGenerateGeminiImages_UpstreamError_400(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"code":400,"message":"prompt violates policy","status":"INVALID_ARGUMENT"}}`))
	}))
	defer upstream.Close()

	_, accessToken := createCanvasSession(t, "canvas-user-gemini-err", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeGemini,
		Key:     "upstream-gemini-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "gemini-err-channel",
		BaseURL: &baseURL,
		Models:  "nano-banana-2",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "nano-banana-2", ChannelId: channel.Id, Enabled: true,
	}).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/gemini/models/nano-banana-2:generateContent", strings.NewReader(`{"contents":[{"parts":[{"text":"bad prompt"}]}]}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "prompt violates policy")
}

func TestCanvasGenerateGeminiImages_UpstreamSafetyBlocked_200(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	engine := setupCanvasImageTestEnv(t, mockDriver)

	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"finishReason":"SAFETY","index":0}],"promptFeedback":{"blockReason":"SAFETY"}}`))
	}))
	defer upstream.Close()

	_, accessToken := createCanvasSession(t, "canvas-user-gemini-safety", 10_000_000)

	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeGemini,
		Key:     "upstream-gemini-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "gemini-safety-channel",
		BaseURL: &baseURL,
		Models:  "nano-banana-2",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "nano-banana-2", ChannelId: channel.Id, Enabled: true,
	}).Error)

	req := httptest.NewRequest(http.MethodPost, "/api/canvas/images/gemini/models/nano-banana-2:generateContent", strings.NewReader(`{"contents":[{"parts":[{"text":"sensitive prompt"}]}]}`))
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), `"blockReason":"SAFETY"`)
}
