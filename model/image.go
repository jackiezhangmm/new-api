package model

import (
	"errors"

	"gorm.io/gorm"
)

var ErrImageNotFound = errors.New("图片不存在")

type Image struct {
	Id        string `json:"id" gorm:"primaryKey;type:varchar(64)"`
	UserId    int    `json:"user_id" gorm:"not null;index"`
	Key       string `json:"key" gorm:"type:text;not null"`
	URL       string `json:"url" gorm:"type:text;not null"`
	Width     int    `json:"width" gorm:"not null"`
	Height    int    `json:"height" gorm:"not null"`
	Bytes     int64  `json:"bytes" gorm:"not null"`
	MimeType  string `json:"mime_type" gorm:"type:varchar(64);not null"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;not null;autoCreateTime"`
}

func CreateImage(img *Image) error {
	return DB.Create(img).Error
}

func GetImageById(id string) (*Image, error) {
	var img Image
	err := DB.Where("id = ?", id).First(&img).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrImageNotFound
		}
		return nil, err
	}
	return &img, nil
}

func DeleteImage(id string) error {
	return DB.Where("id = ?", id).Delete(&Image{}).Error
}
