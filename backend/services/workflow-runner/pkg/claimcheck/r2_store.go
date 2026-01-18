package claimcheck

import (
	"bytes"
	"context"
	"fmt"
	"io"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/google/uuid"
)

// R2Store implements ObjectStore using Cloudflare R2 (S3-compatible)
type R2Store struct {
	client *s3.Client
	bucket string
}

// NewR2Store creates Cloudflare R2-backed store
// R2 is S3-compatible, so we use AWS SDK with custom endpoint
func NewR2Store(ctx context.Context, cfg Config) (*R2Store, error) {
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

	return &R2Store{
		client: client,
		bucket: cfg.R2Bucket,
	}, nil
}

// Put uploads data to R2 with UUID key
func (r *R2Store) Put(ctx context.Context, data []byte) (string, error) {
	key := uuid.New().String() // Generate unique key

	_, err := r.client.PutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
		Body:   bytes.NewReader(data),
	})
	if err != nil {
		return "", fmt.Errorf("r2 put failed: %w", err)
	}

	return key, nil
}

// Get retrieves data from R2 by key
func (r *R2Store) Get(ctx context.Context, key string) ([]byte, error) {
	result, err := r.client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, fmt.Errorf("r2 get failed: %w", err)
	}
	defer result.Body.Close()

	data, err := io.ReadAll(result.Body)
	if err != nil {
		return nil, fmt.Errorf("r2 read failed: %w", err)
	}

	return data, nil
}

// Delete removes object from R2
func (r *R2Store) Delete(ctx context.Context, key string) error {
	_, err := r.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(r.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("r2 delete failed: %w", err)
	}

	return nil
}

// Health checks R2 connectivity
func (r *R2Store) Health(ctx context.Context) error {
	_, err := r.client.HeadBucket(ctx, &s3.HeadBucketInput{
		Bucket: aws.String(r.bucket),
	})
	if err != nil {
		return fmt.Errorf("r2 health check failed: %w", err)
	}

	return nil
}

// ListKeys lists all objects in bucket (for debugging)
func (r *R2Store) ListKeys(ctx context.Context) ([]string, error) {
	result, err := r.client.ListObjectsV2(ctx, &s3.ListObjectsV2Input{
		Bucket: aws.String(r.bucket),
	})
	if err != nil {
		return nil, fmt.Errorf("r2 list failed: %w", err)
	}

	keys := make([]string, 0, len(result.Contents))
	for _, obj := range result.Contents {
		if obj.Key != nil {
			keys = append(keys, *obj.Key)
		}
	}

	return keys, nil
}
