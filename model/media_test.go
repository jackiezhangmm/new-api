package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestMediaCRUD(t *testing.T) {
	originalDB := DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	t.Cleanup(func() { DB = originalDB })
	require.NoError(t, db.AutoMigrate(&Media{}))

	m := &Media{
		Id:       "media-test-123",
		UserId:   42,
		Key:      "media/42/media-test-123.mp4",
		URL:      "https://cdn.example.com/media/42/media-test-123.mp4",
		Bytes:    1048576,
		MimeType: "video/mp4",
	}

	require.NoError(t, CreateMedia(m))

	found, err := GetMediaById("media-test-123")
	require.NoError(t, err)
	assert.Equal(t, 42, found.UserId)
	assert.Equal(t, int64(1048576), found.Bytes)
	assert.Equal(t, "video/mp4", found.MimeType)
	assert.Equal(t, "https://cdn.example.com/media/42/media-test-123.mp4", found.URL)

	_, err = GetMediaById("non-existent")
	assert.ErrorIs(t, err, ErrMediaNotFound)

	require.NoError(t, DeleteMedia("media-test-123"))
	_, err = GetMediaById("media-test-123")
	assert.ErrorIs(t, err, ErrMediaNotFound)
}

func TestGetByOnlyTaskId(t *testing.T) {
	originalDB := DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	t.Cleanup(func() { DB = originalDB })
	require.NoError(t, db.AutoMigrate(&Task{}))

	task := &Task{
		TaskID: "task-uuid-abc",
		UserId: 10,
		Status: TaskStatusSuccess,
	}
	require.NoError(t, DB.Create(task).Error)

	found, exist, err := GetByOnlyTaskId("task-uuid-abc")
	require.NoError(t, err)
	assert.True(t, exist)
	assert.Equal(t, 10, found.UserId)

	foundNone, existNone, err := GetByOnlyTaskId("task-non-existent")
	require.NoError(t, err)
	assert.False(t, existNone)
	assert.Nil(t, foundNone)
}
