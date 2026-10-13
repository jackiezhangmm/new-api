package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

const defaultS3CacheControl = "public, max-age=31536000, immutable"

var ErrStorageUnavailable = errors.New("对象存储未配置或不可用")

type StorageDriver interface {
	IsConfigured() bool
	Upload(ctx context.Context, relativeKey string, data []byte, contentType string) (finalKey string, publicURL string, err error)
	Delete(ctx context.Context, finalKey string) error
}

type s3Driver struct {
	client    *s3.Client
	bucket    string
	publicURL string
	prefix    string
}

type unavailableStorageDriver struct{}

func (unavailableStorageDriver) IsConfigured() bool {
	return false
}

func (unavailableStorageDriver) Upload(context.Context, string, []byte, string) (string, string, error) {
	return "", "", ErrStorageUnavailable
}

func (unavailableStorageDriver) Delete(context.Context, string) error {
	return ErrStorageUnavailable
}

func NewS3DriverFromEnv() StorageDriver {
	endpoint := strings.TrimSpace(os.Getenv("S3_ENDPOINT"))
	publicURL := strings.TrimRight(strings.TrimSpace(os.Getenv("S3_PUBLIC_URL")), "/")
	region := strings.TrimSpace(os.Getenv("S3_REGION"))
	bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
	accessKey := strings.TrimSpace(os.Getenv("S3_ACCESS_KEY"))
	secretKey := strings.TrimSpace(os.Getenv("S3_SECRET_KEY"))

	if endpoint == "" || publicURL == "" || region == "" || bucket == "" || accessKey == "" || secretKey == "" {
		return unavailableStorageDriver{}
	}
	if _, err := url.ParseRequestURI(endpoint); err != nil {
		return unavailableStorageDriver{}
	}
	if _, err := url.ParseRequestURI(publicURL); err != nil {
		return unavailableStorageDriver{}
	}

	config := aws.Config{
		Region:      region,
		Credentials: credentials.NewStaticCredentialsProvider(accessKey, secretKey, ""),
	}
	client := s3.NewFromConfig(config, func(options *s3.Options) {
		options.BaseEndpoint = aws.String(endpoint)
		options.UsePathStyle = strings.EqualFold(strings.TrimSpace(os.Getenv("S3_PATH_STYLE")), "true")
	})
	return &s3Driver{
		client:    client,
		bucket:    bucket,
		publicURL: publicURL,
		prefix:    strings.Trim(strings.TrimSpace(os.Getenv("S3_PREFIX")), "/"),
	}
}

func (s *s3Driver) IsConfigured() bool {
	return true
}

func (s *s3Driver) Upload(ctx context.Context, relativeKey string, data []byte, contentType string) (string, string, error) {
	finalKey := strings.TrimPrefix(path.Join(s.prefix, relativeKey), "/")
	_, err := s.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(s.bucket),
		Key:          aws.String(finalKey),
		Body:         bytes.NewReader(data),
		ContentType:  aws.String(contentType),
		CacheControl: aws.String(defaultS3CacheControl),
	})
	if err != nil {
		return "", "", fmt.Errorf("上传对象到 S3 失败：%w", err)
	}
	return finalKey, s.publicURL + "/" + finalKey, nil
}

func (s *s3Driver) Delete(ctx context.Context, finalKey string) error {
	if strings.TrimSpace(finalKey) == "" {
		return nil
	}
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(finalKey),
	})
	if err != nil {
		return fmt.Errorf("删除 S3 对象失败：%w", err)
	}
	return nil
}
