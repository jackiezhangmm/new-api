package model

import (
	"errors"

	"gorm.io/gorm"
)

var (
	ErrCanvasProjectNotFound = errors.New("工程不存在")
	ErrCanvasProjectConflict = errors.New("工程版本冲突")
)

type CanvasProject struct {
	Id        string `json:"id" gorm:"primaryKey;type:varchar(64)"`
	UserId    int    `json:"user_id" gorm:"not null;index:idx_canvas_projects_user_updated,priority:1"`
	Title     string `json:"title" gorm:"type:varchar(255);not null"`
	Revision  int    `json:"revision" gorm:"not null;default:1"`
	Content   string `json:"content" gorm:"type:text;not null"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;not null;autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"type:bigint;not null;autoCreateTime;autoUpdateTime;index:idx_canvas_projects_user_updated,priority:2,sort:desc"`
}

type CanvasProjectMetadata struct {
	Id        string `json:"id"`
	UserId    int    `json:"user_id"`
	Title     string `json:"title"`
	Revision  int    `json:"revision"`
	CreatedAt int64  `json:"created_at"`
	UpdatedAt int64  `json:"updated_at"`
}

func CreateCanvasProject(project *CanvasProject) error {
	if project.Revision <= 0 {
		project.Revision = 1
	}
	return DB.Create(project).Error
}

func ListCanvasProjects(userId int) ([]*CanvasProjectMetadata, error) {
	var projects []*CanvasProjectMetadata
	err := DB.Model(&CanvasProject{}).
		Select("id", "user_id", "title", "revision", "created_at", "updated_at").
		Where("user_id = ?", userId).
		Order("updated_at DESC").
		Find(&projects).Error
	if err != nil {
		return nil, err
	}
	if projects == nil {
		projects = make([]*CanvasProjectMetadata, 0)
	}
	return projects, nil
}

func GetCanvasProjectById(id string, userId int) (*CanvasProject, error) {
	var project CanvasProject
	err := DB.Where("id = ? AND user_id = ?", id, userId).First(&project).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCanvasProjectNotFound
		}
		return nil, err
	}
	return &project, nil
}

func UpdateCanvasProject(id string, userId int, clientRevision int, title *string, content *string) (*CanvasProject, error) {
	updates := map[string]any{
		"revision": gorm.Expr("revision + 1"),
	}
	if title != nil {
		updates["title"] = *title
	}
	if content != nil {
		updates["content"] = *content
	}

	result := DB.Model(&CanvasProject{}).
		Where("id = ? AND user_id = ? AND revision = ?", id, userId, clientRevision).
		Updates(updates)

	if result.Error != nil {
		return nil, result.Error
	}

	if result.RowsAffected == 0 {
		var count int64
		if err := DB.Model(&CanvasProject{}).Where("id = ? AND user_id = ?", id, userId).Count(&count).Error; err != nil {
			return nil, err
		}
		if count > 0 {
			return nil, ErrCanvasProjectConflict
		}
		return nil, ErrCanvasProjectNotFound
	}

	return GetCanvasProjectById(id, userId)
}

func DeleteCanvasProject(id string, userId int) error {
	result := DB.Where("id = ? AND user_id = ?", id, userId).Delete(&CanvasProject{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return ErrCanvasProjectNotFound
	}
	return nil
}
