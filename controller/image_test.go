package controller

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

type mockStorageDriver struct {
	mu         sync.Mutex
	configured bool
	uploaded   map[string][]byte
	deleted    []string
	uploadErr  error
	deleteErr  error
}

func (m *mockStorageDriver) IsConfigured() bool {
	return m.configured
}

func (m *mockStorageDriver) Upload(ctx context.Context, relKey string, data []byte, contentType string) (string, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.uploadErr != nil {
		return "", "", m.uploadErr
	}
	if m.uploaded == nil {
		m.uploaded = make(map[string][]byte)
	}
	m.uploaded[relKey] = data
	return relKey, "https://cdn.example.com/" + relKey, nil
}

func (m *mockStorageDriver) Delete(ctx context.Context, finalKey string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.deleteErr != nil {
		return m.deleteErr
	}
	m.deleted = append(m.deleted, finalKey)
	delete(m.uploaded, finalKey)
	return nil
}

func generateValidPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.Set(x, y, color.RGBA{R: 255, A: 255})
		}
	}
	var buf bytes.Buffer
	require.NoError(t, png.Encode(&buf, img))
	return buf.Bytes()
}

func setupImageHTTPTest(t *testing.T, driver service.StorageDriver) (*gin.Engine, *gorm.DB) {
	t.Helper()
	gin.SetMode(gin.TestMode)
	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	t.Cleanup(func() { model.DB = originalDB })
	require.NoError(t, db.AutoMigrate(&model.Image{}))

	restoreDriver := SetImageStorageDriverForTest(driver)
	t.Cleanup(restoreDriver)

	router := gin.New()
	router.Use(func(c *gin.Context) {
		userId := c.GetHeader("X-Test-User-Id")
		if userId == "" {
			c.Set("id", 100) // 默认测试用户 ID
		} else if userId != "anonymous" {
			c.Set("id", 200)
		}
		c.Next()
	})
	router.POST("/api/images", UploadImage)
	router.GET("/api/images/:id", GetImage)
	return router, db
}

func performMultipartUpload(t *testing.T, router *gin.Engine, fieldName, filename string, content []byte) *httptest.ResponseRecorder {
	t.Helper()
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile(fieldName, filename)
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/images", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	return w
}

func TestUploadImageSuccessAndGetById(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	router, db := setupImageHTTPTest(t, mockDriver)

	pngData := generateValidPNG(t, 640, 480)
	w := performMultipartUpload(t, router, "file", "test.png", pngData)

	assert.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Success bool                `json:"success"`
		Data    UploadImageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &resp))
	require.True(t, resp.Success)
	assert.NotEmpty(t, resp.Data.Id)
	assert.Equal(t, 640, resp.Data.Width)
	assert.Equal(t, 480, resp.Data.Height)
	assert.Equal(t, int64(len(pngData)), resp.Data.Bytes)
	assert.Equal(t, "image/png", resp.Data.MimeType)
	assert.True(t, strings.HasPrefix(resp.Data.URL, "https://cdn.example.com/images/100/"))

	// 检查数据库记录
	var dbImg model.Image
	require.NoError(t, db.Where("id = ?", resp.Data.Id).First(&dbImg).Error)
	assert.Equal(t, 100, dbImg.UserId)
	assert.Equal(t, 640, dbImg.Width)
	assert.Equal(t, 480, dbImg.Height)
	assert.Equal(t, int64(len(pngData)), dbImg.Bytes)

	// GET 检查
	getReq := httptest.NewRequest(http.MethodGet, "/api/images/"+resp.Data.Id, nil)
	getW := httptest.NewRecorder()
	router.ServeHTTP(getW, getReq)
	assert.Equal(t, http.StatusOK, getW.Code)
	var getResp struct {
		Success bool                `json:"success"`
		Data    UploadImageResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(getW.Body.Bytes(), &getResp))
	assert.Equal(t, resp.Data.Id, getResp.Data.Id)
	assert.Equal(t, resp.Data.URL, getResp.Data.URL)
}

func TestUploadImageRejectsInvalidOrCorruptedFiles(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	router, db := setupImageHTTPTest(t, mockDriver)

	// 1. 文本伪装成图片
	fakePng := []byte("hello world this is not a png")
	w := performMultipartUpload(t, router, "file", "fake.png", fakePng)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	// 2. 空字节
	wEmpty := performMultipartUpload(t, router, "file", "empty.png", []byte{})
	assert.Equal(t, http.StatusBadRequest, wEmpty.Code)

	// 3. 字段名错误
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("wrong_field", "test.png")
	require.NoError(t, err)
	_, err = part.Write(generateValidPNG(t, 10, 10))
	require.NoError(t, err)
	require.NoError(t, writer.Close())
	req := httptest.NewRequest(http.MethodPost, "/api/images", body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	wWrong := httptest.NewRecorder()
	router.ServeHTTP(wWrong, req)
	assert.Equal(t, http.StatusBadRequest, wWrong.Code)

	// 数据库应零脏数据
	var count int64
	require.NoError(t, db.Model(&model.Image{}).Count(&count).Error)
	assert.Equal(t, int64(0), count)
	assert.Empty(t, mockDriver.uploaded)
}

func TestUploadImageStorageUnconfiguredOrFailed(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: false}
	router, db := setupImageHTTPTest(t, mockDriver)

	pngData := generateValidPNG(t, 100, 100)
	w := performMultipartUpload(t, router, "file", "test.png", pngData)
	assert.Equal(t, http.StatusInternalServerError, w.Code)

	// 模拟驱动报错
	mockDriver.configured = true
	mockDriver.uploadErr = errors.New("s3 connection timeout")
	wFail := performMultipartUpload(t, router, "file", "test.png", pngData)
	assert.Equal(t, http.StatusInternalServerError, wFail.Code)

	var count int64
	require.NoError(t, db.Model(&model.Image{}).Count(&count).Error)
	assert.Equal(t, int64(0), count)
}
