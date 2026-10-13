package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFeaturedPromptObjectStoreUploadsAndDeletesThroughS3CompatibleEndpoint(t *testing.T) {
	methods := make([]string, 0, 2)
	paths := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method)
		paths = append(paths, r.URL.Path)
		if r.Method == http.MethodPut {
			body, err := io.ReadAll(r.Body)
			require.NoError(t, err)
			assert.Equal(t, []byte("image-data"), body)
			assert.Equal(t, "image/webp", r.Header.Get("Content-Type"))
			assert.Equal(t, "public, max-age=31536000, immutable", r.Header.Get("Cache-Control"))
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	t.Setenv("S3_ENDPOINT", server.URL)
	t.Setenv("S3_PUBLIC_URL", "https://assets.example.test")
	t.Setenv("S3_REGION", "test-region")
	t.Setenv("S3_BUCKET", "test-bucket")
	t.Setenv("S3_ACCESS_KEY", "test-access-key")
	t.Setenv("S3_SECRET_KEY", "test-secret-key")
	t.Setenv("S3_PATH_STYLE", "true")
	t.Setenv("S3_PREFIX", "test")

	store := NewFeaturedPromptObjectStoreFromEnv()
	key, publicURL, err := store.Upload(context.Background(), []byte("image-data"), "image/webp")
	require.NoError(t, err)
	assert.True(t, strings.HasPrefix(key, "test/featured-prompts/"))
	assert.True(t, strings.HasSuffix(key, ".webp"))
	assert.Equal(t, "https://assets.example.test/"+key, publicURL)
	require.NoError(t, store.Delete(context.Background(), key))
	assert.Equal(t, []string{http.MethodPut, http.MethodDelete}, methods)
	assert.Equal(t, []string{"/test-bucket/" + key, "/test-bucket/" + key}, paths)
}

func TestFeaturedPromptObjectStoreRejectsMissingConfiguration(t *testing.T) {
	for _, key := range []string{
		"S3_ENDPOINT",
		"S3_PUBLIC_URL",
		"S3_REGION",
		"S3_BUCKET",
		"S3_ACCESS_KEY",
		"S3_SECRET_KEY",
	} {
		t.Setenv(key, "")
	}
	store := NewFeaturedPromptObjectStoreFromEnv()
	_, _, err := store.Upload(context.Background(), []byte("image-data"), "image/webp")
	assert.ErrorIs(t, err, ErrFeaturedPromptStorageUnavailable)
}
