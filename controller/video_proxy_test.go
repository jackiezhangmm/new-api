package controller

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupVideoProxyTestEnv(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)

	originalDB := model.DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	model.DB = db
	require.NoError(t, db.AutoMigrate(&model.Task{}))

	t.Cleanup(func() {
		model.DB = originalDB
	})

	r := gin.New()
	r.Use(middleware.OptionalTokenOrUserAuth())
	r.GET("/v1/videos/:task_id/content", VideoProxy)
	return r
}

func TestVideoProxyUnauthenticatedAccessWithTaskIdRedirectsS3(t *testing.T) {
	t.Setenv("S3_PUBLIC_URL", "https://s3.example.com")
	r := setupVideoProxyTestEnv(t)

	task := &model.Task{
		TaskID: "video-task-s3-123",
		UserId: 42,
		Status: model.TaskStatusSuccess,
		PrivateData: model.TaskPrivateData{
			ResultURL: "https://s3.example.com/videos/42/video-task-s3-123.mp4",
		},
	}
	require.NoError(t, model.DB.Create(task).Error)

	// 原生请求，不携带 Authorization 头
	req := httptest.NewRequest(http.MethodGet, "/v1/videos/video-task-s3-123/content", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusFound, w.Code)
	assert.Equal(t, "https://s3.example.com/videos/42/video-task-s3-123.mp4", w.Header().Get("Location"))
}

func TestVideoProxyNotFound(t *testing.T) {
	r := setupVideoProxyTestEnv(t)

	req := httptest.NewRequest(http.MethodGet, "/v1/videos/non-existent-task/content", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestVideoProxyNotCompleted(t *testing.T) {
	r := setupVideoProxyTestEnv(t)

	task := &model.Task{
		TaskID: "video-task-in-progress",
		UserId: 42,
		Status: model.TaskStatusInProgress,
	}
	require.NoError(t, model.DB.Create(task).Error)

	req := httptest.NewRequest(http.MethodGet, "/v1/videos/video-task-in-progress/content", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}
