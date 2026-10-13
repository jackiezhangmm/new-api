package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestImageCRUD(t *testing.T) {
	originalDB := DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	t.Cleanup(func() { DB = originalDB })
	require.NoError(t, db.AutoMigrate(&Image{}))

	img := &Image{
		Id:       "img-test-123",
		UserId:   42,
		Key:      "images/42/img-test-123.png",
		URL:      "https://cdn.example.com/images/42/img-test-123.png",
		Width:    800,
		Height:   600,
		Bytes:    10240,
		MimeType: "image/png",
	}

	require.NoError(t, CreateImage(img))

	found, err := GetImageById("img-test-123")
	require.NoError(t, err)
	assert.Equal(t, 42, found.UserId)
	assert.Equal(t, 800, found.Width)
	assert.Equal(t, 600, found.Height)
	assert.Equal(t, int64(10240), found.Bytes)
	assert.Equal(t, "image/png", found.MimeType)
	assert.Equal(t, "https://cdn.example.com/images/42/img-test-123.png", found.URL)

	_, err = GetImageById("non-existent")
	assert.ErrorIs(t, err, ErrImageNotFound)
}
