package controller

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupMediaTestEnv(t *testing.T, driver *mockStorageDriver) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.Media{}))

	restoreDriver := SetImageStorageDriverForTest(driver)
	t.Cleanup(func() {
		model.DB = originalDB
		restoreDriver()
	})

	r := gin.New()
	r.Use(func(c *gin.Context) {
		c.Set("id", 100)
		c.Next()
	})
	r.POST("/api/media", UploadMedia)
	r.GET("/api/media/:id", GetMedia)
	return r
}

func createMultipartMediaRequest(t *testing.T, fieldName, filename, contentType string, content []byte) (*http.Request, string) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	h := make(map[string][]string)
	if contentType != "" {
		h["Content-Type"] = []string{contentType}
	}
	part, err := writer.CreatePart(map[string][]string{
		"Content-Disposition": {`form-data; name="` + fieldName + `"; filename="` + filename + `"`},
		"Content-Type":        {contentType},
	})
	require.NoError(t, err)
	_, err = part.Write(content)
	require.NoError(t, err)
	require.NoError(t, writer.Close())

	req := httptest.NewRequest(http.MethodPost, "/api/media", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	return req, writer.FormDataContentType()
}

func TestUploadMediaSuccessAndGetById(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	r := setupMediaTestEnv(t, mockDriver)

	fakeVideo := []byte("fake-mp4-video-content-stream")
	req, _ := createMultipartMediaRequest(t, "file", "test_video.mp4", "video/mp4", fakeVideo)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var resp struct {
		Success bool                `json:"success"`
		Data    UploadMediaResponse `json:"data"`
	}
	err := common.Unmarshal(w.Body.Bytes(), &resp)
	require.NoError(t, err)
	assert.True(t, resp.Success)
	assert.NotEmpty(t, resp.Data.Id)
	assert.Equal(t, "video/mp4", resp.Data.MimeType)
	assert.Equal(t, int64(len(fakeVideo)), resp.Data.Bytes)
	assert.True(t, strings.HasPrefix(resp.Data.URL, "https://cdn.example.com/media/100/"))

	// 测试 GET 获取详情
	getReq := httptest.NewRequest(http.MethodGet, "/api/media/"+resp.Data.Id, nil)
	getW := httptest.NewRecorder()
	r.ServeHTTP(getW, getReq)

	require.Equal(t, http.StatusOK, getW.Code)
	var getResp struct {
		Success bool                `json:"success"`
		Data    UploadMediaResponse `json:"data"`
	}
	require.NoError(t, common.Unmarshal(getW.Body.Bytes(), &getResp))
	assert.True(t, getResp.Success)
	assert.Equal(t, resp.Data.Id, getResp.Data.Id)
	assert.Equal(t, resp.Data.URL, getResp.Data.URL)
}

func TestUploadMediaRejectsUnsupportedType(t *testing.T) {
	mockDriver := &mockStorageDriver{configured: true}
	r := setupMediaTestEnv(t, mockDriver)

	req, _ := createMultipartMediaRequest(t, "file", "malicious.exe", "application/x-msdownload", []byte("MZ..."))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}
