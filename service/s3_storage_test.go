package service

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestS3StorageUploadsAndDeletes(t *testing.T) {
	methods := make([]string, 0, 2)
	paths := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method)
		paths = append(paths, r.URL.Path)
		if r.Method == http.MethodPut {
			body, err := io.ReadAll(r.Body)
			require.NoError(t, err)
			assert.Equal(t, []byte("image-data"), body)
			assert.Equal(t, "image/png", r.Header.Get("Content-Type"))
			assert.Equal(t, "public, max-age=31536000, immutable", r.Header.Get("Cache-Control"))
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(server.Close)

	t.Setenv("S3_ENDPOINT", server.URL)
	t.Setenv("S3_PUBLIC_URL", "https://cdn.example.com")
	t.Setenv("S3_REGION", "us-east-1")
	t.Setenv("S3_BUCKET", "my-bucket")
	t.Setenv("S3_ACCESS_KEY", "ak")
	t.Setenv("S3_SECRET_KEY", "sk")
	t.Setenv("S3_PATH_STYLE", "true")
	t.Setenv("S3_PREFIX", "root-prefix")

	driver := NewS3DriverFromEnv()
	require.True(t, driver.IsConfigured())

	key, publicURL, err := driver.Upload(context.Background(), "images/123.png", []byte("image-data"), "image/png")
	require.NoError(t, err)
	assert.Equal(t, "root-prefix/images/123.png", key)
	assert.Equal(t, "https://cdn.example.com/root-prefix/images/123.png", publicURL)

	err = driver.Delete(context.Background(), key)
	require.NoError(t, err)

	assert.Equal(t, []string{http.MethodPut, http.MethodDelete}, methods)
	assert.Equal(t, []string{"/my-bucket/" + key, "/my-bucket/" + key}, paths)
}

func TestS3StorageUnconfigured(t *testing.T) {
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
	driver := NewS3DriverFromEnv()
	assert.False(t, driver.IsConfigured())
	_, _, err := driver.Upload(context.Background(), "test.png", []byte("data"), "image/png")
	assert.ErrorIs(t, err, ErrStorageUnavailable)
}
