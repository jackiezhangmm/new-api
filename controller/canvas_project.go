package controller

import (
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const maxCanvasProjectBytes = 5 << 20 // 5MB

type CreateCanvasProjectRequest struct {
	Id      string `json:"id"`
	Title   string `json:"title"`
	Content string `json:"content"`
}

type UpdateCanvasProjectRequest struct {
	Revision int     `json:"revision"`
	Title    *string `json:"title"`
	Content  *string `json:"content"`
}

func ListCanvasProjects(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录用户不能获取工程列表"})
		return
	}

	projects, err := model.ListCanvasProjects(userId)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": projects})
}

func CreateCanvasProject(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录用户不能创建工程"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxCanvasProjectBytes+1024)
	var req CreateCanvasProjectRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil && !errors.Is(err, io.EOF) {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"success": false, "message": "工程内容超过 5MB 限制"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的请求参数: " + err.Error()})
		return
	}

	id := strings.TrimSpace(req.Id)
	if id == "" {
		id = uuid.New().String()
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "未命名工程"
	}
	content := req.Content
	if content == "" {
		content = "{}"
	}

	project := &model.CanvasProject{
		Id:       id,
		UserId:   userId,
		Title:    title,
		Revision: 1,
		Content:  content,
	}

	if err := model.CreateCanvasProject(project); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": project})
}

func GetCanvasProject(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录用户不能获取工程"})
		return
	}

	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "工程 ID 不能为空"})
		return
	}

	project, err := model.GetCanvasProjectById(id, userId)
	if err != nil {
		if errors.Is(err, model.ErrCanvasProjectNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "工程不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": project})
}

func UpdateCanvasProject(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录用户不能更新工程"})
		return
	}

	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "工程 ID 不能为空"})
		return
	}

	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxCanvasProjectBytes+1024)
	var req UpdateCanvasProjectRequest
	if err := common.DecodeJson(c.Request.Body, &req); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			c.JSON(http.StatusRequestEntityTooLarge, gin.H{"success": false, "message": "工程内容超过 5MB 限制"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "无效的请求参数: " + err.Error()})
		return
	}

	if req.Revision <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "版本号 (revision) 必须大于 0"})
		return
	}

	project, err := model.UpdateCanvasProject(id, userId, req.Revision, req.Title, req.Content)
	if err != nil {
		if errors.Is(err, model.ErrCanvasProjectConflict) {
			current, getErr := model.GetCanvasProjectById(id, userId)
			if getErr == nil {
				c.JSON(http.StatusConflict, gin.H{"success": false, "message": "工程已被其他端更新，存在版本冲突", "data": gin.H{"revision": current.Revision}})
				return
			}
			c.JSON(http.StatusConflict, gin.H{"success": false, "message": "工程已被其他端更新，存在版本冲突"})
			return
		}
		if errors.Is(err, model.ErrCanvasProjectNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "工程不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "data": project})
}

func DeleteCanvasProject(c *gin.Context) {
	userId := c.GetInt("id")
	if userId <= 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"success": false, "message": "未登录用户不能删除工程"})
		return
	}

	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"success": false, "message": "工程 ID 不能为空"})
		return
	}

	if err := model.DeleteCanvasProject(id, userId); err != nil {
		if errors.Is(err, model.ErrCanvasProjectNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"success": false, "message": "工程不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"success": false, "message": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"success": true, "message": "工程已删除"})
}
