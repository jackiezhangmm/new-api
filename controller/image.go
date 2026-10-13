package controller

import (
	"bytes"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"
)

const (
	maxImageBytes = 10 << 20 // 10MB
)

var (
	imageStorageDriver   service.StorageDriver
	imageStorageDriverMu sync.Mutex
)

func SetImageStorageDriverForTest(d service.StorageDriver) func() {
	imageStorageDriverMu.Lock()
	old := imageStorageDriver
	imageStorageDriver = d
	imageStorageDriverMu.Unlock()
	return func() {
		imageStorageDriverMu.Lock()
		imageStorageDriver = old
		imageStorageDriverMu.Unlock()
	}
}

func getImageStorageDriver() service.StorageDriver {
	imageStorageDriverMu.Lock()
	defer imageStorageDriverMu.Unlock()
	if imageStorageDriver != nil {
		return imageStorageDriver
	}
	return service.NewS3DriverFromEnv()
}

type UploadImageResponse struct {
	Id       string `json:"id"`
	URL      string `json:"url"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	Bytes    int64  `json:"bytes"`
	MimeType string `json:"mime_type"`
}

func UploadImage(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录用户不能上传图片"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxImageBytes+1024)
	fileHeader, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "读取上传图片失败或文件超过 10MB 限制"})
		return
	}

	if fileHeader.Size > maxImageBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "图片文件不能超过 10MB"})
		return
	}

	file, err := fileHeader.Open()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无法打开上传文件"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxImageBytes+1))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "读取图片数据失败"})
		return
	}
	if int64(len(data)) > maxImageBytes {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "图片文件不能超过 10MB"})
		return
	}

	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效或损坏的图片文件，仅支持 JPEG/PNG/WebP 格式"})
		return
	}

	var mimeType string
	var ext string
	switch format {
	case "jpeg":
		mimeType = "image/jpeg"
		ext = ".jpg"
	case "png":
		mimeType = "image/png"
		ext = ".png"
	case "webp":
		mimeType = "image/webp"
		ext = ".webp"
	default:
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "不支持的图片格式，仅支持 JPEG/PNG/WebP"})
		return
	}

	driver := getImageStorageDriver()
	if !driver.IsConfigured() {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "对象存储未配置或不可用"})
		return
	}

	imageId := uuid.NewString()
	relKey := fmt.Sprintf("images/%d/%s%s", userId, imageId, ext)

	finalKey, publicURL, err := driver.Upload(c.Request.Context(), relKey, data, mimeType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "上传对象存储失败"})
		return
	}

	imgRecord := &model.Image{
		Id:       imageId,
		UserId:   userId,
		Key:      finalKey,
		URL:      publicURL,
		Width:    cfg.Width,
		Height:   cfg.Height,
		Bytes:    int64(len(data)),
		MimeType: mimeType,
	}

	if err := model.CreateImage(imgRecord); err != nil {
		if cleanupErr := driver.Delete(c.Request.Context(), finalKey); cleanupErr != nil {
			common.SysError(fmt.Sprintf("写入图片记录失败后清理 S3 对象失败，key=%q：%v", finalKey, cleanupErr))
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": "保存图片元数据失败"})
		return
	}

	common.ApiSuccess(c, UploadImageResponse{
		Id:       imgRecord.Id,
		URL:      imgRecord.URL,
		Width:    imgRecord.Width,
		Height:   imgRecord.Height,
		Bytes:    imgRecord.Bytes,
		MimeType: imgRecord.MimeType,
	})
}

func GetImage(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "图片 ID 不能为空"})
		return
	}

	img, err := model.GetImageById(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "图片不存在"})
		return
	}

	common.ApiSuccess(c, UploadImageResponse{
		Id:       img.Id,
		URL:      img.URL,
		Width:    img.Width,
		Height:   img.Height,
		Bytes:    img.Bytes,
		MimeType: img.MimeType,
	})
}
