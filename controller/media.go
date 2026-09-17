package controller

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	maxMediaBytes = 100 << 20 // 100MB
)

type UploadMediaResponse struct {
	Id       string `json:"id"`
	URL      string `json:"url"`
	Bytes    int64  `json:"bytes"`
	MimeType string `json:"mime_type"`
}

var supportedMediaExtensions = map[string]string{
	".mp4":  "video/mp4",
	".webm": "video/webm",
	".mov":  "video/quicktime",
	".m4v":  "video/x-m4v",
	".mp3":  "audio/mpeg",
	".wav":  "audio/wav",
	".aac":  "audio/aac",
	".ogg":  "audio/ogg",
	".m4a":  "audio/mp4",
	".flac": "audio/flac",
}

func resolveMediaMimeAndExt(filename, headerContentType string) (string, string, bool) {
	ext := strings.ToLower(filepath.Ext(filename))
	if mimeType, ok := supportedMediaExtensions[ext]; ok {
		return mimeType, ext, true
	}

	headerContentType = strings.ToLower(strings.TrimSpace(headerContentType))
	if idx := strings.Index(headerContentType, ";"); idx != -1 {
		headerContentType = strings.TrimSpace(headerContentType[:idx])
	}

	for e, m := range supportedMediaExtensions {
		if m == headerContentType {
			return m, e, true
		}
	}

	if strings.HasPrefix(headerContentType, "video/") || strings.HasPrefix(headerContentType, "audio/") {
		exts, err := mime.ExtensionsByType(headerContentType)
		if err == nil && len(exts) > 0 {
			return headerContentType, exts[0], true
		}
		if strings.HasPrefix(headerContentType, "video/") {
			return headerContentType, ".mp4", true
		}
		return headerContentType, ".mp3", true
	}

	return "", "", false
}

func UploadMedia(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录用户不能上传媒体文件"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxMediaBytes+1024)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "读取上传媒体文件失败或文件超过限制"})
		return
	}

	if fileHeader.Size > maxMediaBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "媒体文件不能超过 100MB"})
		return
	}

	mimeType, ext, ok := resolveMediaMimeAndExt(fileHeader.Filename, fileHeader.Header.Get("Content-Type"))
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "不支持的媒体格式，仅支持常见视频和音频文件"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无法打开上传文件"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxMediaBytes+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "读取媒体数据失败"})
		return
	}
	if int64(len(data)) > maxMediaBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "媒体文件不能超过 100MB"})
		return
	}

	driver := getImageStorageDriver()
	if !driver.IsConfigured() {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "对象存储未配置或不可用"})
		return
	}

	mediaId := uuid.NewString()
	relKey := fmt.Sprintf("media/%d/%s%s", userId, mediaId, ext)

	finalKey, publicURL, err := driver.Upload(c.Request.Context(), relKey, data, mimeType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "上传对象存储失败"})
		return
	}

	mediaRecord := &model.Media{
		Id:       mediaId,
		UserId:   userId,
		Key:      finalKey,
		URL:      publicURL,
		Bytes:    int64(len(data)),
		MimeType: mimeType,
	}

	if err := model.CreateMedia(mediaRecord); err != nil {
		if cleanupErr := driver.Delete(c.Request.Context(), finalKey); cleanupErr != nil {
			common.SysError(fmt.Sprintf("写入媒体记录失败后清理 S3 对象失败，key=%q：%v", finalKey, cleanupErr))
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存媒体信息失败"})
		return
	}

	common.ApiSuccess(c, UploadMediaResponse{
		Id:       mediaRecord.Id,
		URL:      mediaRecord.URL,
		Bytes:    mediaRecord.Bytes,
		MimeType: mediaRecord.MimeType,
	})
}

func GetMedia(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "媒体 ID 不能为空"})
		return
	}

	m, err := model.GetMediaById(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "媒体不存在"})
		return
	}

	common.ApiSuccess(c, UploadMediaResponse{
		Id:       m.Id,
		URL:      m.URL,
		Bytes:    m.Bytes,
		MimeType: m.MimeType,
	})
}
