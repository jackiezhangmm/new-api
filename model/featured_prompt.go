package model

import (
	"errors"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var ErrFeaturedPromptNotFound = errors.New("精选提示词不存在")

type FeaturedPrompt struct {
	Id        int    `json:"id" gorm:"primaryKey"`
	Title     string `json:"title" gorm:"type:varchar(100);not null"`
	Prompt    string `json:"prompt" gorm:"type:text;not null"`
	CoverURL  string `json:"cover_url" gorm:"type:text;not null"`
	CoverKey  string `json:"-" gorm:"type:text;not null"`
	SortOrder int    `json:"sort_order" gorm:"not null;index"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;not null;autoCreateTime"`
	UpdatedAt int64  `json:"updated_at" gorm:"type:bigint;not null;autoCreateTime;autoUpdateTime"`
}

func ListFeaturedPrompts(pageInfo *common.PageInfo, keyword string) ([]*FeaturedPrompt, int64, error) {
	query := DB.Model(&FeaturedPrompt{})
	keyword = strings.TrimSpace(keyword)
	if keyword != "" {
		pattern := "%" + keyword + "%"
		likeOp := "ILIKE"
		// ponytail: sqlite LIKE fallback for in-memory unit tests; production uses PostgreSQL ILIKE
		if DB != nil && DB.Dialector != nil && DB.Dialector.Name() == "sqlite" {
			likeOp = "LIKE"
		}
		query = query.Where("title "+likeOp+" ? OR prompt "+likeOp+" ?", pattern, pattern)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	items := make([]*FeaturedPrompt, 0)
	err := query.Order("sort_order ASC, id ASC").
		Offset(pageInfo.GetStartIdx()).
		Limit(pageInfo.GetPageSize()).
		Find(&items).Error
	return items, total, err
}

func CreateFeaturedPrompt(title, prompt, coverURL, coverKey string) (*FeaturedPrompt, error) {
	item := &FeaturedPrompt{Title: title, Prompt: prompt, CoverURL: coverURL, CoverKey: coverKey, SortOrder: 1}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockFeaturedPromptOrder(tx); err != nil {
			return err
		}
		if err := tx.Model(&FeaturedPrompt{}).Where("sort_order >= ?", 1).UpdateColumn("sort_order", gorm.Expr("sort_order + 1")).Error; err != nil {
			return err
		}
		return tx.Create(item).Error
	})
	return item, err
}

func UpdateFeaturedPrompt(id int, title, prompt string, coverURL, coverKey *string) (*FeaturedPrompt, string, error) {
	item := &FeaturedPrompt{}
	oldCoverKey := ""
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("id = ?", id).First(item).Error; err != nil {
			return featuredPromptNotFound(err)
		}
		updates := map[string]any{"title": title, "prompt": prompt}
		if coverURL != nil && coverKey != nil {
			oldCoverKey = item.CoverKey
			updates["cover_url"] = *coverURL
			updates["cover_key"] = *coverKey
		}
		return tx.Model(item).Updates(updates).Error
	})
	if err != nil {
		return nil, "", err
	}
	if err := DB.First(item, id).Error; err != nil {
		return nil, "", err
	}
	return item, oldCoverKey, nil
}

func DeleteFeaturedPrompt(id int) (string, error) {
	coverKey := ""
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockFeaturedPromptOrder(tx); err != nil {
			return err
		}
		item := &FeaturedPrompt{}
		if err := tx.Where("id = ?", id).First(item).Error; err != nil {
			return featuredPromptNotFound(err)
		}
		coverKey = item.CoverKey
		if err := tx.Delete(item).Error; err != nil {
			return err
		}
		return tx.Model(&FeaturedPrompt{}).Where("sort_order > ?", item.SortOrder).UpdateColumn("sort_order", gorm.Expr("sort_order - 1")).Error
	})
	return coverKey, err
}

func MoveFeaturedPrompt(id int, direction string) (*FeaturedPrompt, error) {
	item := &FeaturedPrompt{}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := lockFeaturedPromptOrder(tx); err != nil {
			return err
		}
		if err := tx.Where("id = ?", id).First(item).Error; err != nil {
			return featuredPromptNotFound(err)
		}
		targetOrder := item.SortOrder - 1
		if direction == "down" {
			targetOrder = item.SortOrder + 1
		}
		target := &FeaturedPrompt{}
		if err := tx.Where("sort_order = ?", targetOrder).First(target).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil
			}
			return err
		}
		if err := tx.Model(target).UpdateColumn("sort_order", item.SortOrder).Error; err != nil {
			return err
		}
		if err := tx.Model(item).UpdateColumn("sort_order", targetOrder).Error; err != nil {
			return err
		}
		item.SortOrder = targetOrder
		return nil
	})
	return item, err
}

func lockFeaturedPromptOrder(tx *gorm.DB) error {
	if tx.Dialector.Name() == "postgres" {
		return tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(0x4650524f4d5054)).Error
	}
	return nil
}

func featuredPromptNotFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrFeaturedPromptNotFound
	}
	return err
}
