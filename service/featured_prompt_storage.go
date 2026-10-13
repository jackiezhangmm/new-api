package service

import (
	"context"
	"fmt"
	"path"

	"github.com/google/uuid"
)

var ErrFeaturedPromptStorageUnavailable = ErrStorageUnavailable

type FeaturedPromptObjectStore interface {
	Upload(ctx context.Context, data []byte, contentType string) (key string, publicURL string, err error)
	Delete(ctx context.Context, key string) error
}

type featuredPromptS3StoreAdapter struct {
	driver StorageDriver
}

func NewFeaturedPromptObjectStoreFromEnv() FeaturedPromptObjectStore {
	return NewFeaturedPromptObjectStoreWithDriver(NewS3DriverFromEnv())
}

func NewFeaturedPromptObjectStoreWithDriver(driver StorageDriver) FeaturedPromptObjectStore {
	return &featuredPromptS3StoreAdapter{
		driver: driver,
	}
}

func (s *featuredPromptS3StoreAdapter) Upload(ctx context.Context, data []byte, contentType string) (string, string, error) {
	if !s.driver.IsConfigured() {
		return "", "", ErrFeaturedPromptStorageUnavailable
	}
	extension := map[string]string{
		"image/jpeg": ".jpg",
		"image/png":  ".png",
		"image/webp": ".webp",
	}[contentType]
	if extension == "" {
		return "", "", fmt.Errorf("不支持的封面图片类型：%s", contentType)
	}
	relKey := path.Join("featured-prompts", uuid.NewString()+extension)
	return s.driver.Upload(ctx, relKey, data, contentType)
}

func (s *featuredPromptS3StoreAdapter) Delete(ctx context.Context, key string) error {
	if !s.driver.IsConfigured() {
		return ErrFeaturedPromptStorageUnavailable
	}
	return s.driver.Delete(ctx, key)
}
