package controller

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupCanvasProjectTestEnv(t *testing.T) *gin.Engine {
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
		&model.UserSession{},
		&model.CanvasProject{},
	))

	t.Cleanup(func() {
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
	projectRoute := engine.Group("/api/canvas/projects")
	projectRoute.Use(middleware.UserAuth())
	{
		projectRoute.GET("", ListCanvasProjects)
		projectRoute.POST("", CreateCanvasProject)
		projectRoute.GET("/:id", GetCanvasProject)
		projectRoute.PUT("/:id", UpdateCanvasProject)
		projectRoute.DELETE("/:id", DeleteCanvasProject)
	}

	return engine
}

func createCanvasProjectUserSession(t *testing.T, username string) (*model.User, string) {
	t.Helper()
	user := &model.User{
		Username:    username,
		AffCode:     "aff-" + username,
		Status:      common.UserStatusEnabled,
		Group:       "default",
		Role:        common.RoleCommonUser,
		AuthVersion: 1,
	}
	require.NoError(t, model.DB.Create(user).Error)

	now := time.Now().Unix()
	session := &model.UserSession{
		SID:             "canvas-proj-sess-" + username,
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

	token, _, err := service.IssueAccessToken(service.AuthIdentity{
		UserID:          user.Id,
		SessionID:       session.SID,
		UserAuthVersion: user.AuthVersion,
		SessionVersion:  session.Version,
	})
	require.NoError(t, err)
	return user, token
}

func TestCanvasProject_Unauthorized(t *testing.T) {
	engine := setupCanvasProjectTestEnv(t)

	req := httptest.NewRequest(http.MethodGet, "/api/canvas/projects", nil)
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestCanvasProject_CRUD(t *testing.T) {
	engine := setupCanvasProjectTestEnv(t)
	_, token := createCanvasProjectUserSession(t, "alice")

	// 1. Create project
	createBody := `{"id":"proj-1","title":"我的第一个工程","content":"{\"nodes\":[{\"id\":\"n1\"}]}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/canvas/projects", strings.NewReader(createBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	var createResp struct {
		Success bool                `json:"success"`
		Data    model.CanvasProject `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w.Body.Bytes(), &createResp))
	assert.True(t, createResp.Success)
	assert.Equal(t, "proj-1", createResp.Data.Id)
	assert.Equal(t, "我的第一个工程", createResp.Data.Title)
	assert.Equal(t, 1, createResp.Data.Revision)
	assert.Contains(t, createResp.Data.Content, "n1")

	// 2. Get project by ID
	getReq := httptest.NewRequest(http.MethodGet, "/api/canvas/projects/proj-1", nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	wGet := httptest.NewRecorder()
	engine.ServeHTTP(wGet, getReq)

	require.Equal(t, http.StatusOK, wGet.Code)
	var getResp struct {
		Success bool                `json:"success"`
		Data    model.CanvasProject `json:"data"`
	}
	require.NoError(t, common.Unmarshal(wGet.Body.Bytes(), &getResp))
	assert.True(t, getResp.Success)
	assert.Equal(t, "proj-1", getResp.Data.Id)
	assert.Equal(t, 1, getResp.Data.Revision)

	// 3. List projects
	listReq := httptest.NewRequest(http.MethodGet, "/api/canvas/projects", nil)
	listReq.Header.Set("Authorization", "Bearer "+token)
	wList := httptest.NewRecorder()
	engine.ServeHTTP(wList, listReq)

	require.Equal(t, http.StatusOK, wList.Code)
	var listResp struct {
		Success bool                          `json:"success"`
		Data    []model.CanvasProjectMetadata `json:"data"`
	}
	require.NoError(t, common.Unmarshal(wList.Body.Bytes(), &listResp))
	assert.True(t, listResp.Success)
	require.Len(t, listResp.Data, 1)
	assert.Equal(t, "proj-1", listResp.Data[0].Id)
	assert.Equal(t, "我的第一个工程", listResp.Data[0].Title)

	// 4. Update project (Revision 1 -> 2)
	updateBody := `{"revision":1,"title":"修改后的工程","content":"{\"nodes\":[{\"id\":\"n1\"},{\"id\":\"n2\"}]}"}`
	putReq := httptest.NewRequest(http.MethodPut, "/api/canvas/projects/proj-1", strings.NewReader(updateBody))
	putReq.Header.Set("Authorization", "Bearer "+token)
	putReq.Header.Set("Content-Type", "application/json")
	wPut := httptest.NewRecorder()
	engine.ServeHTTP(wPut, putReq)

	require.Equal(t, http.StatusOK, wPut.Code)
	var putResp struct {
		Success bool                `json:"success"`
		Data    model.CanvasProject `json:"data"`
	}
	require.NoError(t, common.Unmarshal(wPut.Body.Bytes(), &putResp))
	assert.True(t, putResp.Success)
	assert.Equal(t, "修改后的工程", putResp.Data.Title)
	assert.Equal(t, 2, putResp.Data.Revision)
	assert.Contains(t, putResp.Data.Content, "n2")

	// 5. Delete project
	delReq := httptest.NewRequest(http.MethodDelete, "/api/canvas/projects/proj-1", nil)
	delReq.Header.Set("Authorization", "Bearer "+token)
	wDel := httptest.NewRecorder()
	engine.ServeHTTP(wDel, delReq)

	assert.Equal(t, http.StatusOK, wDel.Code)

	// 6. Get after delete -> 404
	wGetAfter := httptest.NewRecorder()
	engine.ServeHTTP(wGetAfter, getReq)
	assert.Equal(t, http.StatusNotFound, wGetAfter.Code)
}

func TestCanvasProject_CAS_Conflict(t *testing.T) {
	engine := setupCanvasProjectTestEnv(t)
	_, token := createCanvasProjectUserSession(t, "bob")

	// Create project
	createBody := `{"id":"proj-conflict","title":"冲突测试工程","content":"{}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/canvas/projects", strings.NewReader(createBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	// First update with revision=1 succeeds -> revision becomes 2
	updateBody1 := `{"revision":1,"title":"Client A 更新","content":"{\"nodes\":[{\"id\":\"a\"}]}"}`
	putReq1 := httptest.NewRequest(http.MethodPut, "/api/canvas/projects/proj-conflict", strings.NewReader(updateBody1))
	putReq1.Header.Set("Authorization", "Bearer "+token)
	putReq1.Header.Set("Content-Type", "application/json")
	w1 := httptest.NewRecorder()
	engine.ServeHTTP(w1, putReq1)
	require.Equal(t, http.StatusOK, w1.Code)

	// Second concurrent update with outdated revision=1 fails with 409 Conflict
	updateBody2 := `{"revision":1,"title":"Client B 冲突更新","content":"{\"nodes\":[{\"id\":\"b\"}]}"}`
	putReq2 := httptest.NewRequest(http.MethodPut, "/api/canvas/projects/proj-conflict", strings.NewReader(updateBody2))
	putReq2.Header.Set("Authorization", "Bearer "+token)
	putReq2.Header.Set("Content-Type", "application/json")
	w2 := httptest.NewRecorder()
	engine.ServeHTTP(w2, putReq2)

	assert.Equal(t, http.StatusConflict, w2.Code)
	var conflictResp struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			Revision int `json:"revision"`
		} `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w2.Body.Bytes(), &conflictResp))
	assert.False(t, conflictResp.Success)
	assert.Equal(t, 2, conflictResp.Data.Revision)

	// Third update with revision=2 succeeds -> revision becomes 3
	updateBody3 := `{"revision":2,"title":"Client B 使用最新 revision 更新","content":"{\"nodes\":[{\"id\":\"b\"}]}"}`
	putReq3 := httptest.NewRequest(http.MethodPut, "/api/canvas/projects/proj-conflict", strings.NewReader(updateBody3))
	putReq3.Header.Set("Authorization", "Bearer "+token)
	putReq3.Header.Set("Content-Type", "application/json")
	w3 := httptest.NewRecorder()
	engine.ServeHTTP(w3, putReq3)

	require.Equal(t, http.StatusOK, w3.Code)
	var put3Resp struct {
		Data model.CanvasProject `json:"data"`
	}
	require.NoError(t, common.Unmarshal(w3.Body.Bytes(), &put3Resp))
	assert.Equal(t, 3, put3Resp.Data.Revision)
}

func TestCanvasProject_Delete_CannotResurrect(t *testing.T) {
	engine := setupCanvasProjectTestEnv(t)
	_, token := createCanvasProjectUserSession(t, "charlie")

	// Create project
	createBody := `{"id":"proj-del-test","title":"即将被删除的工程","content":"{}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/canvas/projects", strings.NewReader(createBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	// Delete project
	delReq := httptest.NewRequest(http.MethodDelete, "/api/canvas/projects/proj-del-test", nil)
	delReq.Header.Set("Authorization", "Bearer "+token)
	wDel := httptest.NewRecorder()
	engine.ServeHTTP(wDel, delReq)
	require.Equal(t, http.StatusOK, wDel.Code)

	// An old tab attempts to save/resurrect the deleted project with revision=1 -> returns 404
	putBody := `{"revision":1,"title":"试图复活","content":"{\"nodes\":[]}"}`
	putReq := httptest.NewRequest(http.MethodPut, "/api/canvas/projects/proj-del-test", strings.NewReader(putBody))
	putReq.Header.Set("Authorization", "Bearer "+token)
	putReq.Header.Set("Content-Type", "application/json")
	wPut := httptest.NewRecorder()
	engine.ServeHTTP(wPut, putReq)

	assert.Equal(t, http.StatusNotFound, wPut.Code)
}

func TestCanvasProject_TenantIsolation(t *testing.T) {
	engine := setupCanvasProjectTestEnv(t)
	_, tokenUserA := createCanvasProjectUserSession(t, "user_a")
	_, tokenUserB := createCanvasProjectUserSession(t, "user_b")

	// User A creates project
	createBody := `{"id":"proj-user-a","title":"用户 A 的私密工程","content":"{}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/canvas/projects", strings.NewReader(createBody))
	req.Header.Set("Authorization", "Bearer "+tokenUserA)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	// User B calls GET list -> does not see User A's project
	listReq := httptest.NewRequest(http.MethodGet, "/api/canvas/projects", nil)
	listReq.Header.Set("Authorization", "Bearer "+tokenUserB)
	wList := httptest.NewRecorder()
	engine.ServeHTTP(wList, listReq)

	require.Equal(t, http.StatusOK, wList.Code)
	var listResp struct {
		Data []model.CanvasProjectMetadata `json:"data"`
	}
	require.NoError(t, common.Unmarshal(wList.Body.Bytes(), &listResp))
	assert.Empty(t, listResp.Data)

	// User B calls GET on User A's project -> 404
	getReq := httptest.NewRequest(http.MethodGet, "/api/canvas/projects/proj-user-a", nil)
	getReq.Header.Set("Authorization", "Bearer "+tokenUserB)
	wGet := httptest.NewRecorder()
	engine.ServeHTTP(wGet, getReq)
	assert.Equal(t, http.StatusNotFound, wGet.Code)

	// User B calls PUT on User A's project -> 404
	putReq := httptest.NewRequest(http.MethodPut, "/api/canvas/projects/proj-user-a", strings.NewReader(`{"revision":1,"title":"篡改标题"}`))
	putReq.Header.Set("Authorization", "Bearer "+tokenUserB)
	putReq.Header.Set("Content-Type", "application/json")
	wPut := httptest.NewRecorder()
	engine.ServeHTTP(wPut, putReq)
	assert.Equal(t, http.StatusNotFound, wPut.Code)

	// User B calls DELETE on User A's project -> 404
	delReq := httptest.NewRequest(http.MethodDelete, "/api/canvas/projects/proj-user-a", nil)
	delReq.Header.Set("Authorization", "Bearer "+tokenUserB)
	wDel := httptest.NewRecorder()
	engine.ServeHTTP(wDel, delReq)
	assert.Equal(t, http.StatusNotFound, wDel.Code)
}

func TestCanvasProject_PayloadLimit(t *testing.T) {
	engine := setupCanvasProjectTestEnv(t)
	_, token := createCanvasProjectUserSession(t, "oversized")

	// Create project
	createBody := `{"id":"proj-size","title":"大包体工程","content":"{}"}`
	req := httptest.NewRequest(http.MethodPost, "/api/canvas/projects", strings.NewReader(createBody))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	engine.ServeHTTP(w, req)
	require.Equal(t, http.StatusOK, w.Code)

	// Submit update with body exceeding 5MB
	oversizedContent := strings.Repeat("x", 6<<20) // 6MB
	largeBody := fmt.Sprintf(`{"revision":1,"content":"%s"}`, oversizedContent)
	putReq := httptest.NewRequest(http.MethodPut, "/api/canvas/projects/proj-size", strings.NewReader(largeBody))
	putReq.Header.Set("Authorization", "Bearer "+token)
	putReq.Header.Set("Content-Type", "application/json")
	wPut := httptest.NewRecorder()
	engine.ServeHTTP(wPut, putReq)

	assert.Equal(t, http.StatusRequestEntityTooLarge, wPut.Code)
}
