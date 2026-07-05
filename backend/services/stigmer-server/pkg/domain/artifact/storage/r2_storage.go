package storage

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2Storage implements ArtifactStorage using Cloudflare R2 (S3-compatible).
type R2Storage struct {
	client        *s3.Client
	presignClient *s3.PresignClient
	bucket        string
}

// NewR2Storage creates Cloudflare R2-backed artifact storage.
// R2 is S3-compatible, so we use AWS SDK with custom endpoint.
func NewR2Storage(ctx context.Context, cfg Config) (*R2Storage, error) {
	// Validate required config
	if cfg.R2Bucket == "" {
		return nil, fmt.Errorf("R2 bucket name is required")
	}
	if cfg.R2Endpoint == "" {
		return nil, fmt.Errorf("R2 endpoint is required")
	}
	if cfg.R2AccessKeyID == "" {
		return nil, fmt.Errorf("R2 access key ID is required")
	}
	if cfg.R2SecretAccessKey == "" {
		return nil, fmt.Errorf("R2 secret access key is required")
	}

	// Set default region for R2
	region := cfg.R2Region
	if region == "" {
		region = "auto" // R2 typically uses "auto"
	}

	// Create credentials
	creds := credentials.NewStaticCredentialsProvider(
		cfg.R2AccessKeyID,
		cfg.R2SecretAccessKey,
		"",
	)

	// Load AWS config with R2 endpoint
	awsCfg, err := config.LoadDefaultConfig(ctx,
		config.WithRegion(region),
		config.WithCredentialsProvider(creds),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config: %w", err)
	}

	// Create S3 client with R2 endpoint
	client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.R2Endpoint)
		// R2 uses path-style addressing
		o.UsePathStyle = true
	})

	// Create presign client for generating signed URLs
	presignClient := s3.NewPresignClient(client)

	return &R2Storage{
		client:        client,
		presignClient: presignClient,
		bucket:        cfg.R2Bucket,
	}, nil
}

// Upload stores artifact data in R2.
func (r *R2Storage) Upload(ctx context.Context, key string, data []byte, contentType string) error {
	input := &s3.PutObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader(data),
	}

	// Set content type if provided
	if contentType != "" {
		input.ContentType = aws.String(contentType)
	}

	_, err := r.client.PutObject(ctx, input)
	if err != nil {
		return fmt.Errorf("r2 upload failed: %w", err)
	}

	return nil
}

// Download retrieves artifact data from R2.
func (r *R2Storage) Download(ctx context.Context, key string) ([]byte, error) {
	result, err := r.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("r2 download failed: %w", err)
	}
	defer result.Body.Close()

	data, err := io.ReadAll(result.Body)
	if err != nil {
		return nil, fmt.Errorf("r2 read failed: %w", err)
	}

	return data, nil
}

// GetSignedURL generates a presigned URL for downloading the artifact.
// The URL is valid for the specified duration (max 7 days for R2).
//
// When downloadFilename is non-empty, the response Content-Disposition is
// signed into the URL so the browser saves the object as an attachment under
// that name instead of rendering it inline.
func (r *R2Storage) GetSignedURL(ctx context.Context, key string, expiresIn time.Duration, downloadFilename string) (string, error) {
	// R2 has a maximum expiration of 7 days
	maxExpiration := 7 * 24 * time.Hour
	if expiresIn > maxExpiration {
		expiresIn = maxExpiration
	}

	input := &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	}
	if downloadFilename != "" {
		input.ResponseContentDisposition = aws.String(ContentDispositionAttachment(downloadFilename))
	}

	request, err := r.presignClient.PresignGetObject(ctx, input, func(opts *s3.PresignOptions) {
		opts.Expires = expiresIn
	})

	if err != nil {
		return "", fmt.Errorf("r2 presign failed: %w", err)
	}

	return request.URL, nil
}

// Delete removes artifact from R2.
func (r *R2Storage) Delete(ctx context.Context, key string) error {
	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("r2 delete failed: %w", err)
	}

	return nil
}

// Exists checks if artifact exists in R2.
func (r *R2Storage) Exists(ctx context.Context, key string) (bool, error) {
	_, err := r.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})

	if err != nil {
		// Check if it's a "not found" error
		// AWS SDK v2 doesn't have a simple NotFound checker, so we check the error string
		if isNotFoundError(err) {
			return false, nil
		}
		return false, fmt.Errorf("r2 head failed: %w", err)
	}

	return true, nil
}

// Health checks R2 connectivity.
func (r *R2Storage) Health(ctx context.Context) error {
	_, err := r.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(r.bucket),
	})
	if err != nil {
		return fmt.Errorf("r2 health check failed: %w", err)
	}

	return nil
}

// isNotFoundError checks if the error is a "not found" error.
func isNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	// AWS SDK v2 error checking
	return err.Error() == "NotFound" ||
		err.Error() == "NoSuchKey" ||
		contains(err.Error(), "404") ||
		contains(err.Error(), "not found")
}

// contains is a simple helper to check if a string contains a substring.
func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr ||
		(len(s) > len(substr) && (s[:len(substr)] == substr || s[len(s)-len(substr):] == substr ||
			findSubstring(s, substr))))
}

func findSubstring(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
