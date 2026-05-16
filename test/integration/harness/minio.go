package harness

import (
	"context"
	"fmt"

	minioclient "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/testcontainers/testcontainers-go/modules/minio"
)

// MinIOContainer holds a running MinIO instance for S3-compatible artifact
// storage during integration tests.
type MinIOContainer struct {
	Container *minio.MinioContainer
	Endpoint  string
	AccessKey string
	SecretKey string
}

const (
	minioDefaultUser     = "minioadmin"
	minioDefaultPassword = "minioadmin"
)

// Required buckets for skill artifacts, execution artifacts, and claim checks.
var minioBuckets = []string{"test-bucket", "test-claimcheck-bucket"}

// StartMinIO starts a MinIO container with default credentials and
// pre-creates the required S3 buckets.
func StartMinIO(ctx context.Context) (*MinIOContainer, error) {
	container, err := minio.Run(ctx, "minio/minio:latest",
		minio.WithUsername(minioDefaultUser),
		minio.WithPassword(minioDefaultPassword),
	)
	if err != nil {
		return nil, fmt.Errorf("start minio container: %w", err)
	}

	endpoint, err := container.ConnectionString(ctx)
	if err != nil {
		return nil, fmt.Errorf("get minio connection string: %w", err)
	}

	client, err := minioclient.New(endpoint, &minioclient.Options{
		Creds:  credentials.NewStaticV4(minioDefaultUser, minioDefaultPassword, ""),
		Secure: false,
	})
	if err != nil {
		return nil, fmt.Errorf("create minio client: %w", err)
	}

	for _, bucket := range minioBuckets {
		if err := client.MakeBucket(ctx, bucket, minioclient.MakeBucketOptions{}); err != nil {
			exists, errExists := client.BucketExists(ctx, bucket)
			if errExists != nil || !exists {
				return nil, fmt.Errorf("create bucket %q: %w", bucket, err)
			}
		}
	}

	return &MinIOContainer{
		Container: container,
		Endpoint:  "http://" + endpoint,
		AccessKey: minioDefaultUser,
		SecretKey: minioDefaultPassword,
	}, nil
}
