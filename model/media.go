package model

import (
	"errors"

	"gorm.io/gorm"
)

var ErrMediaNotFound = errors.New("媒体不存在")

type Media struct {
	Id        string `json:"id" gorm:"primaryKey;type:varchar(64)"`
	UserId    int    `json:"user_id" gorm:"not null;index"`
	Key       string `json:"key" gorm:"type:text;not null"`
	URL       string `json:"url" gorm:"type:text;not null"`
	Bytes     int64  `json:"bytes" gorm:"not null"`
	MimeType  string `json:"mime_type" gorm:"type:varchar(64);not null"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;not null;autoCreateTime"`
}

func CreateMedia(m *Media) error {
	return DB.Create(m).Error
}

func GetMediaById(id string) (*Media, error) {
	var m Media
	err := DB.Where("id = ?", id).First(&m).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrMediaNotFound
		}
		return nil, err
	}
	return &m, nil
}

func DeleteMedia(id string) error {
	return DB.Where("id = ?", id).Delete(&Media{}).Error
}
