package model

import (
	"net/url"
	"os"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestDigitalAssetPostgresSearchConstraintsAndCascade(t *testing.T) {
	dsn := os.Getenv("TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set TEST_POSTGRES_DSN to run PostgreSQL digital asset integration test")
	}
	parsed, err := url.Parse(dsn)
	require.NoError(t, err)
	query := parsed.Query()
	query.Set("search_path", "digital_asset_integration_test")
	parsed.RawQuery = query.Encode()

	adminDB, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, adminDB.Exec("DROP SCHEMA IF EXISTS digital_asset_integration_test CASCADE").Error)
	require.NoError(t, adminDB.Exec("CREATE SCHEMA digital_asset_integration_test").Error)
	t.Cleanup(func() {
		assert.NoError(t, adminDB.Exec("DROP SCHEMA IF EXISTS digital_asset_integration_test CASCADE").Error)
	})

	postgresDB, err := gorm.Open(postgres.Open(parsed.String()), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, postgresDB.AutoMigrate(
		&User{},
		&DigitalAsset{},
		&DigitalAssetTag{},
		&DigitalAssetTagLink{},
	))
	originalDB := DB
	DB = postgresDB
	t.Cleanup(func() { DB = originalDB })

	user := &User{Username: "asset-postgres-user", Password: "password123", Email: "asset-postgres@example.com", AffCode: "asset-postgres-aff"}
	require.NoError(t, DB.Create(user).Error)
	first, err := CreateDigitalAsset(user.Id, DigitalAssetTypeText, "City Portrait", "Neon LIGHT", []string{"Scene", "角色"}, nil)
	require.NoError(t, err)
	_, err = CreateDigitalAsset(user.Id, DigitalAssetTypeText, "Quiet forest", "morning fog", []string{"Scene"}, nil)
	require.NoError(t, err)

	pageInfo := &common.PageInfo{Page: 1, PageSize: 12}
	found, total, err := ListDigitalAssets(user.Id, DigitalAssetListFilter{Search: "light"}, pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	require.Len(t, found, 1)
	assert.Equal(t, first.Id, found[0].Id)

	tags, err := ListDigitalAssetTags(user.Id)
	require.NoError(t, err)
	require.Len(t, tags, 2)
	tagIds := []int{tags[0].Id, tags[1].Id}
	found, total, err = ListDigitalAssets(user.Id, DigitalAssetListFilter{TagIds: tagIds}, pageInfo)
	require.NoError(t, err)
	assert.Equal(t, int64(1), total)
	assert.Equal(t, first.Id, found[0].Id)

	duplicate := &DigitalAssetTag{UserId: user.Id, Name: "SCENE", NormalizedName: "scene"}
	assert.Error(t, DB.Create(duplicate).Error)

	require.NoError(t, DB.Unscoped().Delete(user).Error)
	var assetCount int64
	var tagCount int64
	var linkCount int64
	require.NoError(t, DB.Model(&DigitalAsset{}).Count(&assetCount).Error)
	require.NoError(t, DB.Model(&DigitalAssetTag{}).Count(&tagCount).Error)
	require.NoError(t, DB.Model(&DigitalAssetTagLink{}).Count(&linkCount).Error)
	assert.Zero(t, assetCount)
	assert.Zero(t, tagCount)
	assert.Zero(t, linkCount)
}
