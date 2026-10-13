package controller

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
)

const (
	featuredPromptMaxBodyBytes    = 6 << 20
	featuredPromptMaxCoverBytes   = 5 << 20
	featuredPromptMaxTitleLength  = 100
	featuredPromptMaxPromptLength = 100000
)

var (
	featuredPromptStore   service.FeaturedPromptObjectStore
	featuredPromptStoreMu sync.Mutex
)

const featuredPromptsPerPage = 6

func ListFeaturedPrompts(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	hasPageSize := c.Query("page_size") != "" || c.Query("ps") != "" || c.Query("size") != ""
	if !hasPageSize {
		pageInfo.PageSize = featuredPromptsPerPage
	}
	keyword := strings.TrimSpace(c.Query("keyword"))
	if keyword == "" {
		keyword = strings.TrimSpace(c.Query("q"))
	}
	items, total, err := model.ListFeaturedPrompts(pageInfo, keyword)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(items)
	common.ApiSuccess(c, pageInfo)
}

func CreateFeaturedPrompt(c *gin.Context) {
	request, ok := bindFeaturedPromptWriteRequest(c, true)
	if !ok {
		return
	}
	store := getFeaturedPromptStore()
	key, publicURL, err := store.Upload(c.Request.Context(), request.cover, request.contentType)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	item, err := model.CreateFeaturedPrompt(request.title, request.prompt, publicURL, key)
	if err != nil {
		if cleanupErr := store.Delete(c.Request.Context(), key); cleanupErr != nil {
			common.SysError(fmt.Sprintf("清理未保存的精选词库封面失败，object_key=%q：%v", key, cleanupErr))
		}
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, item)
}

func UpdateFeaturedPrompt(c *gin.Context) {
	id, ok := parseFeaturedPromptID(c)
	if !ok {
		return
	}
	request, ok := bindFeaturedPromptWriteRequest(c, false)
	if !ok {
		return
	}
	store := getFeaturedPromptStore()
	var key, publicURL *string
	if len(request.cover) > 0 {
		uploadedKey, uploadedURL, err := store.Upload(c.Request.Context(), request.cover, request.contentType)
		if err != nil {
			common.ApiError(c, err)
			return
		}
		key, publicURL = &uploadedKey, &uploadedURL
	}
	item, oldCoverKey, err := model.UpdateFeaturedPrompt(id, request.title, request.prompt, publicURL, key)
	if err != nil {
		if key != nil {
			if cleanupErr := store.Delete(c.Request.Context(), *key); cleanupErr != nil {
				common.SysError(fmt.Sprintf("清理未保存的精选词库封面失败，object_key=%q：%v", *key, cleanupErr))
			}
		}
		featuredPromptError(c, err)
		return
	}
	if oldCoverKey != "" {
		if err := store.Delete(c.Request.Context(), oldCoverKey); err != nil {
			common.SysError(fmt.Sprintf("清理已替换的精选词库封面失败，object_key=%q：%v", oldCoverKey, err))
		}
	}
	common.ApiSuccess(c, item)
}

func DeleteFeaturedPrompt(c *gin.Context) {
	id, ok := parseFeaturedPromptID(c)
	if !ok {
		return
	}
	coverKey, err := model.DeleteFeaturedPrompt(id)
	if err != nil {
		featuredPromptError(c, err)
		return
	}
	if err := getFeaturedPromptStore().Delete(c.Request.Context(), coverKey); err != nil {
		common.SysError(fmt.Sprintf("清理已删除的精选词库封面失败，object_key=%q：%v", coverKey, err))
	}
	common.ApiSuccess(c, nil)
}

func MoveFeaturedPrompt(c *gin.Context) {
	id, ok := parseFeaturedPromptID(c)
	if !ok {
		return
	}
	request := struct {
		Direction string `json:"direction"`
	}{}
	if err := c.ShouldBindJSON(&request); err != nil || (request.Direction != "up" && request.Direction != "down") {
		common.ApiErrorMsg(c, "排序方向无效")
		return
	}
	item, err := model.MoveFeaturedPrompt(id, request.Direction)
	if err != nil {
		featuredPromptError(c, err)
		return
	}
	common.ApiSuccess(c, item)
}

type featuredPromptWriteRequest struct {
	title       string
	prompt      string
	cover       []byte
	contentType string
}

func bindFeaturedPromptWriteRequest(c *gin.Context, coverRequired bool) (*featuredPromptWriteRequest, bool) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, featuredPromptMaxBodyBytes)
	if err := c.Request.ParseMultipartForm(featuredPromptMaxBodyBytes); err != nil {
		common.ApiErrorMsg(c, "请求内容无效或封面文件过大")
		return nil, false
	}
	request := &featuredPromptWriteRequest{
		title:  strings.TrimSpace(c.PostForm("title")),
		prompt: strings.TrimSpace(c.PostForm("prompt")),
	}
	if request.title == "" || utf8.RuneCountInString(request.title) > featuredPromptMaxTitleLength {
		common.ApiErrorMsg(c, "标题长度必须为 1 到 100 个字符")
		return nil, false
	}
	if request.prompt == "" || utf8.RuneCountInString(request.prompt) > featuredPromptMaxPromptLength {
		common.ApiErrorMsg(c, "提示词长度必须为 1 到 100000 个字符")
		return nil, false
	}

	file, _, err := c.Request.FormFile("cover")
	if errors.Is(err, http.ErrMissingFile) {
		if coverRequired {
			common.ApiErrorMsg(c, "封面图片不能为空")
			return nil, false
		}
		return request, true
	}
	if err != nil {
		common.ApiErrorMsg(c, "封面图片无效")
		return nil, false
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, featuredPromptMaxCoverBytes+1))
	if err != nil || len(data) == 0 || len(data) > featuredPromptMaxCoverBytes {
		common.ApiErrorMsg(c, "封面图片必须小于 5 MB")
		return nil, false
	}
	contentType := http.DetectContentType(data)
	if contentType != "image/jpeg" && contentType != "image/png" && contentType != "image/webp" {
		common.ApiErrorMsg(c, "封面图片仅支持 JPEG、PNG 或 WebP")
		return nil, false
	}
	request.cover = data
	request.contentType = contentType
	return request, true
}

func parseFeaturedPromptID(c *gin.Context) (int, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		common.ApiErrorMsg(c, "精选提示词不存在")
		return 0, false
	}
	return id, true
}

func featuredPromptError(c *gin.Context, err error) {
	if errors.Is(err, model.ErrFeaturedPromptNotFound) {
		common.ApiErrorMsg(c, "精选提示词不存在")
		return
	}
	common.ApiError(c, err)
}

func getFeaturedPromptStore() service.FeaturedPromptObjectStore {
	featuredPromptStoreMu.Lock()
	defer featuredPromptStoreMu.Unlock()
	if featuredPromptStore == nil {
		featuredPromptStore = service.NewFeaturedPromptObjectStoreFromEnv()
	}
	return featuredPromptStore
}
