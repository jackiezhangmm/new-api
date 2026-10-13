package router

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func createRelaySession(t *testing.T, username string) (*model.User, *model.UserSession, string) {
	t.Helper()
	user := &model.User{
		Username: username, Status: common.UserStatusEnabled, Group: "default", Quota: 100, AuthVersion: 1,
		AffCode: "aff-" + username,
	}
	require.NoError(t, model.DB.Create(user).Error)
	now := time.Now().Unix()
	session := &model.UserSession{
		SID: "relay-session-" + username, UserID: user.Id, Version: 1, UserAuthVersion: user.AuthVersion,
		Status: model.UserSessionStatusActive, RefreshHash: "refresh-hash-" + username, LoginMethod: "password",
		LastActiveAt: now, ExpiresAt: now + 3600,
	}
	require.NoError(t, model.CreateUserSession(session))
	accessToken, _, err := service.IssueAccessToken(service.AuthIdentity{
		UserID: user.Id, SessionID: session.SID, UserAuthVersion: user.AuthVersion, SessionVersion: session.Version,
	})
	require.NoError(t, err)
	return user, session, accessToken
}

func TestStandardHTTPRelayAcceptsSessionButRealtimeDoesNot(t *testing.T) {
	setupRelayRouterTestDB(t)
	_, _, accessToken := createRelaySession(t, "relay-session-user")
	engine := gin.New()
	SetRelayRouter(engine)

	chatRequest := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"missing-channel-model","messages":[]}`))
	chatRequest.Header.Set("Authorization", "Bearer "+accessToken)
	chatRequest.Header.Set("Content-Type", "application/json")
	chatResponse := httptest.NewRecorder()
	engine.ServeHTTP(chatResponse, chatRequest)
	assert.Equal(t, http.StatusServiceUnavailable, chatResponse.Code)
	assert.NotContains(t, chatResponse.Body.String(), "AUTH_")

	forbiddenGroupRequest := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"missing-channel-model","group":"not-a-user-group","messages":[]}`))
	forbiddenGroupRequest.Header.Set("Authorization", "Bearer "+accessToken)
	forbiddenGroupRequest.Header.Set("Content-Type", "application/json")
	forbiddenGroupResponse := httptest.NewRecorder()
	engine.ServeHTTP(forbiddenGroupResponse, forbiddenGroupRequest)
	assert.Equal(t, http.StatusForbidden, forbiddenGroupResponse.Code)

	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/v1/files"},
		{method: http.MethodDelete, path: "/v1/models/blocked-model"},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			request.Header.Set("Authorization", "Bearer "+accessToken)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			assert.Equal(t, http.StatusUnauthorized, response.Code)
		})
	}

	realtimeRequest := httptest.NewRequest(http.MethodGet, "/v1/realtime?model=missing-channel-model", nil)
	realtimeRequest.Header.Set("Authorization", "Bearer "+accessToken)
	realtimeResponse := httptest.NewRecorder()
	engine.ServeHTTP(realtimeResponse, realtimeRequest)
	assert.Equal(t, http.StatusUnauthorized, realtimeResponse.Code)
}

func TestSessionGeminiRelayUsesStandardRelayContext(t *testing.T) {
	setupRelayRouterTestDB(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1beta/models/gemini-test:generateContent", r.URL.Path)
		assert.Equal(t, "upstream-key", r.Header.Get("x-goog-api-key"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"candidates":[{"content":{"parts":[{"text":"ok"}]}}]}`))
	}))
	defer upstream.Close()

	user, _, accessToken := createRelaySession(t, "gemini-session-user")
	setting, err := common.Marshal(dto.UserSetting{AcceptUnsetRatioModel: true})
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Updates(map[string]any{
		"setting": string(setting),
		"quota":   10_000_000,
	}).Error)
	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeGemini,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "gemini-session-test-channel",
		BaseURL: &baseURL,
		Models:  "gemini-test",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "gemini-test", ChannelId: channel.Id, Enabled: true,
	}).Error)

	engine := gin.New()
	SetRelayRouter(engine)
	request := httptest.NewRequest(http.MethodPost, "/v1beta/models/gemini-test:generateContent", strings.NewReader(`{"contents":[{"parts":[{"text":"hello"}]}]}`))
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	assert.Contains(t, response.Body.String(), `"candidates"`)
	var consumeLog model.Log
	require.NoError(t, model.DB.Where("user_id = ? AND type = ?", user.Id, model.LogTypeConsume).Order("id DESC").First(&consumeLog).Error)
	assert.Equal(t, "playground-default", consumeLog.TokenName)
}

func TestCanonicalMidjourneyImagineAcceptsSessionAndAPIToken(t *testing.T) {
	setupRelayRouterTestDB(t)
	originalUsableGroups := setting.UserUsableGroups2JSONString()
	originalGroupRatios := ratio_setting.GroupRatio2JSONString()
	require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(`{"default":"Default","vip":"VIP"}`))
	require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(`{"default":1,"vip":1}`))
	t.Cleanup(func() {
		require.NoError(t, setting.UpdateUserUsableGroupsByJSONString(originalUsableGroups))
		require.NoError(t, ratio_setting.UpdateGroupRatioByJSONString(originalGroupRatios))
	})
	const initialUserQuota = 100_000
	const initialTokenQuota = 80_000
	const taskID = "session-mj-task"

	var upstreamAuthorization string
	upstreamCalls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls++
		upstreamAuthorization = r.Header.Get("Authorization")
		assert.Equal(t, "/v1/midjourney/generations", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"code":200,"data":{"task_id":"%s-%d"}}`, taskID, upstreamCalls)
	}))
	defer upstream.Close()

	user, _, accessToken := createRelaySession(t, "midjourney-submit-session-user")
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", initialUserQuota).Error)
	realToken := &model.Token{
		UserId: user.Id, Name: "api-token", Key: "mjcanonicaltoken", Group: "vip", Status: common.TokenStatusEnabled,
		ExpiredTime: -1, RemainQuota: initialTokenQuota,
	}
	require.NoError(t, model.DB.Create(realToken).Error)
	baseURL := upstream.URL
	channel := &model.Channel{
		Type: constant.ChannelTypeAPIMart, Key: "upstream-channel-key", Status: common.ChannelStatusEnabled,
		Name: "session-midjourney-channel", BaseURL: &baseURL, Models: "mj_imagine", Group: "vip",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "vip", Model: "mj_imagine", ChannelId: channel.Id, Enabled: true,
	}).Error)

	engine := gin.New()
	SetRelayRouter(engine)
	request := httptest.NewRequest(http.MethodPost, "/mj/submit/imagine", strings.NewReader(`{"prompt":"draw a lighthouse","group":"vip"}`))
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	engine.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	assert.Equal(t, "Bearer upstream-channel-key", upstreamAuthorization)
	assert.NotContains(t, upstreamAuthorization, accessToken)
	var task model.Midjourney
	require.NoError(t, model.DB.Where("user_id = ? AND mj_id = ?", user.Id, taskID+"-1").First(&task).Error)
	assert.Equal(t, 50_000, task.Quota)
	var updatedUser model.User
	require.NoError(t, model.DB.First(&updatedUser, user.Id).Error)
	assert.Equal(t, initialUserQuota-task.Quota, updatedUser.Quota)
	updatedToken, err := model.GetTokenById(realToken.Id)
	require.NoError(t, err)
	assert.Equal(t, initialTokenQuota, updatedToken.RemainQuota)
	var consumeLog model.Log
	require.NoError(t, model.DB.Where("user_id = ? AND type = ?", user.Id, model.LogTypeConsume).First(&consumeLog).Error)
	assert.Equal(t, "playground-vip", consumeLog.TokenName)
	assert.Zero(t, consumeLog.TokenId)

	apiTokenRequest := httptest.NewRequest(http.MethodPost, "/mj/submit/imagine", strings.NewReader(`{"prompt":"draw a harbor"}`))
	apiTokenRequest.Header.Set("Authorization", "Bearer mjcanonicaltoken")
	apiTokenRequest.Header.Set("Content-Type", "application/json")
	apiTokenResponse := httptest.NewRecorder()
	engine.ServeHTTP(apiTokenResponse, apiTokenRequest)

	require.Equal(t, http.StatusOK, apiTokenResponse.Code, apiTokenResponse.Body.String())
	var apiTokenTask model.Midjourney
	require.NoError(t, model.DB.Where("user_id = ? AND mj_id = ?", user.Id, taskID+"-2").First(&apiTokenTask).Error)
	updatedToken, err = model.GetTokenById(realToken.Id)
	require.NoError(t, err)
	assert.Equal(t, initialTokenQuota-apiTokenTask.Quota, updatedToken.RemainQuota)
}

func TestCanonicalMidjourneyTaskFetchAcceptsSessionAndAPIToken(t *testing.T) {
	setupRelayRouterTestDB(t)
	user, _, accessToken := createRelaySession(t, "midjourney-fetch-session-user")
	require.NoError(t, model.DB.Create(&model.Midjourney{
		UserId: user.Id, MjId: "owned-task", Action: "IMAGINE", Status: "SUCCESS", Progress: "100%",
	}).Error)
	require.NoError(t, model.DB.Create(&model.Midjourney{
		UserId: user.Id + 1, MjId: "other-task", Action: "IMAGINE", Status: "SUCCESS", Progress: "100%",
	}).Error)
	require.NoError(t, model.DB.Create(&model.Token{
		UserId: user.Id, Name: "mj-api-token", Key: "mjapitoken", Status: common.TokenStatusEnabled,
		ExpiredTime: -1, UnlimitedQuota: true,
	}).Error)

	engine := gin.New()
	SetRelayRouter(engine)
	for _, credential := range []string{accessToken, "mjapitoken"} {
		singleRequest := httptest.NewRequest(http.MethodGet, "/mj/task/owned-task/fetch", nil)
		singleRequest.Header.Set("Authorization", "Bearer "+credential)
		singleResponse := httptest.NewRecorder()
		engine.ServeHTTP(singleResponse, singleRequest)
		require.Equal(t, http.StatusOK, singleResponse.Code)
		assert.Contains(t, singleResponse.Body.String(), `"id":"owned-task"`)

		batchRequest := httptest.NewRequest(http.MethodPost, "/mj/task/list-by-condition", strings.NewReader(`{"ids":["owned-task","other-task"]}`))
		batchRequest.Header.Set("Authorization", "Bearer "+credential)
		batchRequest.Header.Set("Content-Type", "application/json")
		batchResponse := httptest.NewRecorder()
		engine.ServeHTTP(batchResponse, batchRequest)
		require.Equal(t, http.StatusOK, batchResponse.Code)
		assert.Contains(t, batchResponse.Body.String(), `"id":"owned-task"`)
		assert.NotContains(t, batchResponse.Body.String(), "other-task")
	}

	otherTaskRequest := httptest.NewRequest(http.MethodGet, "/mj/task/other-task/fetch", nil)
	otherTaskRequest.Header.Set("Authorization", "Bearer "+accessToken)
	otherTaskResponse := httptest.NewRecorder()
	engine.ServeHTTP(otherTaskResponse, otherTaskRequest)
	assert.Equal(t, http.StatusBadRequest, otherTaskResponse.Code)
	assert.Contains(t, otherTaskResponse.Body.String(), "task_no_found")
}

func TestSessionMidjourneyImagineRejectsUnavailableGroup(t *testing.T) {
	setupRelayRouterTestDB(t)
	_, _, accessToken := createRelaySession(t, "midjourney-group-session-user")
	engine := gin.New()
	SetRelayRouter(engine)
	request := httptest.NewRequest(http.MethodPost, "/mj/submit/imagine", strings.NewReader(`{"prompt":"draw a lighthouse","group":"forbidden"}`))
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()

	engine.ServeHTTP(response, request)

	assert.Equal(t, http.StatusForbidden, response.Code)
}

func TestSessionMidjourneyCannotAccessTokenOnlyRoutes(t *testing.T) {
	setupRelayRouterTestDB(t)
	_, _, accessToken := createRelaySession(t, "midjourney-token-only-session-user")
	engine := gin.New()
	SetRelayRouter(engine)

	for _, endpoint := range []string{"/mj/submit/action", "/v1/mj/submit/imagine"} {
		request := httptest.NewRequest(http.MethodPost, endpoint, strings.NewReader(`{"prompt":"draw a lighthouse"}`))
		request.Header.Set("Authorization", "Bearer "+accessToken)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()

		engine.ServeHTTP(response, request)

		assert.Equal(t, http.StatusUnauthorized, response.Code)
	}
}

func TestLegacyPlaygroundEndpointIsDisabled(t *testing.T) {
	setupRelayRouterTestDB(t)
	_, _, accessToken := createRelaySession(t, "legacy-playground-user")
	engine := gin.New()
	SetRelayRouter(engine)

	request := httptest.NewRequest(http.MethodPost, "/pg/chat/completions", strings.NewReader(`{"model":"gpt-test","messages":[]}`))
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	require.Equal(t, http.StatusGone, response.Code)
	assert.Contains(t, response.Body.String(), "playground_endpoint_disabled")
}

func TestSessionChatUsesStandardRelayResponse(t *testing.T) {
	setupRelayRouterTestDB(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/chat/completions", r.URL.Path)
		assert.Equal(t, "Bearer upstream-key", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-test","object":"chat.completion","created":1,"model":"gpt-4o","choices":[{"index":0,"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}`))
	}))
	defer upstream.Close()

	user, _, accessToken := createRelaySession(t, "upstream-session-user")
	setting, err := common.Marshal(dto.UserSetting{AcceptUnsetRatioModel: true})
	require.NoError(t, err)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("setting", string(setting)).Error)
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", 10_000_000).Error)
	realToken := &model.Token{
		UserId: user.Id, Key: "real-api-token", Status: common.TokenStatusEnabled,
		ExpiredTime: -1, RemainQuota: 123_456,
	}
	require.NoError(t, model.DB.Create(realToken).Error)
	baseURL := upstream.URL
	channel := &model.Channel{
		Type:    constant.ChannelTypeOpenAI,
		Key:     "upstream-key",
		Status:  common.ChannelStatusEnabled,
		Name:    "session-test-channel",
		BaseURL: &baseURL,
		Models:  "gpt-4o",
		Group:   "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "gpt-4o", ChannelId: channel.Id, Enabled: true,
	}).Error)

	engine := gin.New()
	SetRelayRouter(engine)
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(`{"model":"gpt-4o","messages":[{"role":"user","content":"hello"}]}`))
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	var payload struct {
		Object  string `json:"object"`
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	require.NoError(t, common.Unmarshal(response.Body.Bytes(), &payload))
	require.Equal(t, "chat.completion", payload.Object)
	require.Len(t, payload.Choices, 1)
	assert.Equal(t, "ok", payload.Choices[0].Message.Content)

	var consumeLog model.Log
	require.NoError(t, model.DB.Where("user_id = ? AND type = ?", user.Id, model.LogTypeConsume).Order("id DESC").First(&consumeLog).Error)
	assert.Equal(t, "playground-default", consumeLog.TokenName)

	token, err := model.GetTokenById(realToken.Id)
	require.NoError(t, err)
	assert.Equal(t, 123_456, token.RemainQuota)
}

func TestSessionRelayRejectsInvalidSessions(t *testing.T) {
	setupRelayRouterTestDB(t)
	engine := gin.New()
	SetRelayRouter(engine)

	tests := []struct {
		name   string
		mutate func(t *testing.T, user *model.User, session *model.UserSession)
	}{
		{
			name: "expired session",
			mutate: func(t *testing.T, _ *model.User, session *model.UserSession) {
				require.NoError(t, model.DB.Model(&model.UserSession{}).Where("sid = ?", session.SID).Update("expires_at", time.Now().Unix()-1).Error)
			},
		},
		{
			name: "revoked session",
			mutate: func(t *testing.T, user *model.User, session *model.UserSession) {
				_, err := model.RevokeUserSession(user.Id, session.SID, "test revoke")
				require.NoError(t, err)
			},
		},
		{
			name: "disabled user",
			mutate: func(t *testing.T, user *model.User, _ *model.UserSession) {
				require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("status", common.UserStatusDisabled).Error)
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			user, session, accessToken := createRelaySession(t, "invalid-"+strings.ReplaceAll(test.name, " ", "-"))
			test.mutate(t, user, session)

			for _, endpoint := range []struct {
				name string
				path string
				body string
			}{
				{name: "standard relay", path: "/v1/chat/completions", body: `{"model":"gpt-test","messages":[]}`},
				{name: "midjourney imagine", path: "/mj/submit/imagine", body: `{"prompt":"draw a lighthouse"}`},
			} {
				t.Run(endpoint.name, func(t *testing.T) {
					request := httptest.NewRequest(http.MethodPost, endpoint.path, strings.NewReader(endpoint.body))
					request.Header.Set("Authorization", "Bearer "+accessToken)
					request.Header.Set("Content-Type", "application/json")
					response := httptest.NewRecorder()
					engine.ServeHTTP(response, request)

					assert.Equal(t, http.StatusUnauthorized, response.Code)
					assert.Contains(t, response.Body.String(), "AUTH_SESSION_REVOKED")
				})
			}
		})
	}
}

func TestSessionRelayRejectsAsyncRoutes(t *testing.T) {
	setupRelayRouterTestDB(t)
	_, _, accessToken := createRelaySession(t, "async-session-user")
	engine := gin.New()
	SetRelayRouter(engine)
	SetVideoRouter(engine)

	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/v1/video/generations"},
		{method: http.MethodGet, path: "/v1/video/generations/task-1"},
		{method: http.MethodPost, path: "/suno/fetch"},
	}
	for _, test := range tests {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, nil)
			request.Header.Set("Authorization", "Bearer "+accessToken)
			response := httptest.NewRecorder()
			engine.ServeHTTP(response, request)
			assert.Equal(t, http.StatusUnauthorized, response.Code)
		})
	}
}

func TestVideosRouterAcceptsSessionAndAPIToken(t *testing.T) {
	setupRelayRouterTestDB(t)
	originalModelPrices := ratio_setting.ModelPrice2JSONString()
	require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(`{"minimax_h3_zm_u24":0.1}`))
	t.Cleanup(func() {
		require.NoError(t, ratio_setting.UpdateModelPriceByJSONString(originalModelPrices))
	})
	user, _, accessToken := createRelaySession(t, "videos-router-user")
	const initialUserQuota = 1_000_000
	const initialTokenQuota = 800_000
	require.NoError(t, model.DB.Model(&model.User{}).Where("id = ?", user.Id).Update("quota", initialUserQuota).Error)

	realToken := &model.Token{
		UserId: user.Id, Name: "video-api-token", Key: "videoapitoken", Group: "default", Status: common.TokenStatusEnabled,
		ExpiredTime: -1, RemainQuota: initialTokenQuota,
	}
	require.NoError(t, model.DB.Create(realToken).Error)

	var upstreamAuthorization string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamAuthorization = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = fmt.Fprintf(w, `{"code":"success","data":{"task_id":"autodl-task-1"}}`)
	}))
	defer upstream.Close()

	baseURL := upstream.URL
	channel := &model.Channel{
		Type: constant.ChannelTypeAutoDL, Key: "upstream-autodl-key", Status: common.ChannelStatusEnabled,
		Name: "session-autodl-channel", BaseURL: &baseURL, Models: "minimax_h3_zm_u24", Group: "default",
		AutoBan: common.GetPointer(0),
	}
	require.NoError(t, model.DB.Create(channel).Error)
	require.NoError(t, model.DB.Create(&model.Ability{
		Group: "default", Model: "minimax_h3_zm_u24", ChannelId: channel.Id, Enabled: true,
	}).Error)

	require.NoError(t, model.DB.Create(&model.Task{
		UserId: user.Id, TaskID: "owned-video-task", Platform: constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeAutoDL)), Action: constant.TaskActionGenerate, Status: model.TaskStatusSuccess,
		Data: []byte(`{"data":{"status":"SUCCESS","results":["https://example.com/video.mp4"]}}`),
	}).Error)
	require.NoError(t, model.DB.Create(&model.Task{
		UserId: user.Id + 1, TaskID: "other-video-task", Platform: constant.TaskPlatform(strconv.Itoa(constant.ChannelTypeAutoDL)), Action: constant.TaskActionGenerate, Status: model.TaskStatusSuccess,
	}).Error)

	engine := gin.New()
	SetVideoRouter(engine)

	// 1. Unauthorized requests rejected with 401
	unauthPost := httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"minimax_h3_zm_u24","prompt":"test","image":"https://example.com/a.png"}`))
	unauthPost.Header.Set("Content-Type", "application/json")
	unauthPostResp := httptest.NewRecorder()
	engine.ServeHTTP(unauthPostResp, unauthPost)
	assert.Equal(t, http.StatusUnauthorized, unauthPostResp.Code)

	unauthGet := httptest.NewRequest(http.MethodGet, "/v1/videos/owned-video-task", nil)
	unauthGetResp := httptest.NewRecorder()
	engine.ServeHTTP(unauthGetResp, unauthGet)
	assert.Equal(t, http.StatusUnauthorized, unauthGetResp.Code)

	// 2. Fetch owned task with session accessToken and api token
	for _, credential := range []string{accessToken, "videoapitoken"} {
		fetchReq := httptest.NewRequest(http.MethodGet, "/v1/videos/owned-video-task", nil)
		fetchReq.Header.Set("Authorization", "Bearer "+credential)
		fetchResp := httptest.NewRecorder()
		engine.ServeHTTP(fetchResp, fetchReq)
		require.Equal(t, http.StatusOK, fetchResp.Code)
		assert.Contains(t, fetchResp.Body.String(), `"id":"owned-video-task"`)
	}

	// 3. Other user's task not accessible
	otherReq := httptest.NewRequest(http.MethodGet, "/v1/videos/other-video-task", nil)
	otherReq.Header.Set("Authorization", "Bearer "+accessToken)
	otherResp := httptest.NewRecorder()
	engine.ServeHTTP(otherResp, otherReq)
	assert.Equal(t, http.StatusBadRequest, otherResp.Code)
	assert.Contains(t, otherResp.Body.String(), "task_not_exist")

	// 4. Submit video with session accessToken
	submitReq := httptest.NewRequest(http.MethodPost, "/v1/videos", strings.NewReader(`{"model":"minimax_h3_zm_u24","prompt":"make a video","image":"https://example.com/a.png","duration":5}`))
	submitReq.Header.Set("Authorization", "Bearer "+accessToken)
	submitReq.Header.Set("Content-Type", "application/json")
	submitResp := httptest.NewRecorder()
	engine.ServeHTTP(submitResp, submitReq)
	require.Equal(t, http.StatusOK, submitResp.Code, submitResp.Body.String())
	assert.Equal(t, "upstream-autodl-key", upstreamAuthorization)
	assert.NotContains(t, upstreamAuthorization, accessToken)

	// User wallet deducted, real token unaffected
	var updatedUser model.User
	require.NoError(t, model.DB.First(&updatedUser, user.Id).Error)
	assert.Less(t, updatedUser.Quota, initialUserQuota)
	updatedToken, err := model.GetTokenById(realToken.Id)
	require.NoError(t, err)
	assert.Equal(t, initialTokenQuota, updatedToken.RemainQuota)

	// 5. Test /v1/videos/generations route aliases
	fetchAliasReq := httptest.NewRequest(http.MethodGet, "/v1/videos/generations/owned-video-task", nil)
	fetchAliasReq.Header.Set("Authorization", "Bearer "+accessToken)
	fetchAliasResp := httptest.NewRecorder()
	engine.ServeHTTP(fetchAliasResp, fetchAliasReq)
	require.Equal(t, http.StatusOK, fetchAliasResp.Code)
	assert.Contains(t, fetchAliasResp.Body.String(), `"id":"owned-video-task"`)

	submitAliasReq := httptest.NewRequest(http.MethodPost, "/v1/videos/generations", strings.NewReader(`{"model":"minimax_h3_zm_u24","prompt":"make another video","image":"https://example.com/a.png","duration":5}`))
	submitAliasReq.Header.Set("Authorization", "Bearer "+accessToken)
	submitAliasReq.Header.Set("Content-Type", "application/json")
	submitAliasResp := httptest.NewRecorder()
	engine.ServeHTTP(submitAliasResp, submitAliasReq)
	require.Equal(t, http.StatusOK, submitAliasResp.Code, submitAliasResp.Body.String())
}

func TestListModelsSupportsOpenAIAndGeminiAuthentication(t *testing.T) {
	setupRelayRouterTestDB(t)

	user := model.User{
		Username: "models-user",
		Status:   common.UserStatusEnabled,
		Group:    "default",
		Quota:    100,
	}
	require.NoError(t, model.DB.Create(&user).Error)
	require.NoError(t, model.DB.Create(&model.Token{
		UserId:         user.Id,
		Key:            "modelstestkey",
		Status:         common.TokenStatusEnabled,
		ExpiredTime:    -1,
		UnlimitedQuota: true,
	}).Error)

	engine := gin.New()
	SetRelayRouter(engine)

	tests := []struct {
		name           string
		path           string
		headerName     string
		expectedObject string
		expectedField  string
	}{
		{
			name:           "OpenAI bearer token",
			path:           "/v1/models",
			headerName:     "Authorization",
			expectedObject: "list",
			expectedField:  "data",
		},
		{
			name:          "Gemini API key header",
			path:          "/v1/models",
			headerName:    "x-goog-api-key",
			expectedField: "models",
		},
		{
			name:          "Gemini API key query",
			path:          "/v1/models?key=modelstestkey",
			expectedField: "models",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			if test.headerName != "" {
				value := "modelstestkey"
				if test.headerName == "Authorization" {
					value = "Bearer " + value
				}
				request.Header.Set(test.headerName, value)
			}

			engine.ServeHTTP(recorder, request)

			require.Equal(t, http.StatusOK, recorder.Code)
			var payload map[string]any
			require.NoError(t, common.Unmarshal(recorder.Body.Bytes(), &payload))
			assert.Contains(t, payload, test.expectedField)
			assert.NotContains(t, payload, "error")
			if test.expectedObject != "" {
				assert.Equal(t, test.expectedObject, payload["object"])
			}
		})
	}
}

func TestApiRouterCanvasImagesGenerationsWired(t *testing.T) {
	setupRelayRouterTestDB(t)
	engine := gin.New()
	SetApiRouter(engine)

	// Unauthenticated request should hit the middleware and return 401
	request := httptest.NewRequest(http.MethodPost, "/api/canvas/images/generations", strings.NewReader(`{"model":"dall-e-3","prompt":"cat"}`))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	assert.Equal(t, http.StatusUnauthorized, recorder.Code)
}

func setupRelayRouterTestDB(t *testing.T) {
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
	require.NoError(t, model.DB.AutoMigrate(&model.User{}, &model.Token{}, &model.Ability{}, &model.Channel{}, &model.Log{}, &model.Midjourney{}, &model.Task{}, &model.UserSubscription{}, &model.UserSession{}))

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
}
