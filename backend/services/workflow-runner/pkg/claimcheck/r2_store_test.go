package claimcheck_test

import (
	"context"
	"os"
	"testing"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/claimcheck"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestR2Store_PutAndGet(t *testing.T) {
	// Skip if R2 credentials not available
	if os.Getenv("R2_ACCESS_KEY_ID") == "" {
		t.Skip("R2 credentials not configured")
	}

	ctx := context.Background()

	cfg := claimcheck.Config{
		R2Bucket:          os.Getenv("R2_BUCKET"),
		R2Endpoint:        os.Getenv("R2_ENDPOINT"),
		R2AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2Region:          "auto", // R2 uses "auto" for region
	}

	store, err := claimcheck.NewR2Store(ctx, cfg)
	require.NoError(t, err)

	// Test data
	testData := []byte("Hello, Claim Check!")

	// Put
	key, err := store.Put(ctx, testData)
	require.NoError(t, err)
	assert.NotEmpty(t, key)

	// Get
	retrieved, err := store.Get(ctx, key)
	require.NoError(t, err)
	assert.Equal(t, testData, retrieved)

	// Cleanup
	err = store.Delete(ctx, key)
	require.NoError(t, err)
}

func TestR2Store_Health(t *testing.T) {
	if os.Getenv("R2_ACCESS_KEY_ID") == "" {
		t.Skip("R2 credentials not configured")
	}

	ctx := context.Background()

	cfg := claimcheck.Config{
		R2Bucket:          os.Getenv("R2_BUCKET"),
		R2Endpoint:        os.Getenv("R2_ENDPOINT"),
		R2AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2Region:          "auto",
	}

	store, err := claimcheck.NewR2Store(ctx, cfg)
	require.NoError(t, err)

	err = store.Health(ctx)
	assert.NoError(t, err)
}

func TestR2Store_ListKeys(t *testing.T) {
	if os.Getenv("R2_ACCESS_KEY_ID") == "" {
		t.Skip("R2 credentials not configured")
	}

	ctx := context.Background()

	cfg := claimcheck.Config{
		R2Bucket:          os.Getenv("R2_BUCKET"),
		R2Endpoint:        os.Getenv("R2_ENDPOINT"),
		R2AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2Region:          "auto",
	}

	store, err := claimcheck.NewR2Store(ctx, cfg)
	require.NoError(t, err)

	// Put a test object
	testData := []byte("Test data for list")
	key, err := store.Put(ctx, testData)
	require.NoError(t, err)

	// List keys
	keys, err := store.ListKeys(ctx)
	require.NoError(t, err)
	assert.Contains(t, keys, key)

	// Cleanup
	err = store.Delete(ctx, key)
	require.NoError(t, err)
}

func TestR2Store_LargePayload(t *testing.T) {
	if os.Getenv("R2_ACCESS_KEY_ID") == "" {
		t.Skip("R2 credentials not configured")
	}

	ctx := context.Background()

	cfg := claimcheck.Config{
		R2Bucket:          os.Getenv("R2_BUCKET"),
		R2Endpoint:        os.Getenv("R2_ENDPOINT"),
		R2AccessKeyID:     os.Getenv("R2_ACCESS_KEY_ID"),
		R2SecretAccessKey: os.Getenv("R2_SECRET_ACCESS_KEY"),
		R2Region:          "auto",
	}

	store, err := claimcheck.NewR2Store(ctx, cfg)
	require.NoError(t, err)

	// 1MB payload
	largeData := make([]byte, 1024*1024)
	for i := range largeData {
		largeData[i] = byte(i % 256)
	}

	// Put
	key, err := store.Put(ctx, largeData)
	require.NoError(t, err)

	// Get
	retrieved, err := store.Get(ctx, key)
	require.NoError(t, err)
	assert.Equal(t, largeData, retrieved)

	// Cleanup
	err = store.Delete(ctx, key)
	require.NoError(t, err)
}

func TestR2Store_MissingConfig(t *testing.T) {
	ctx := context.Background()

	// Missing bucket
	_, err := claimcheck.NewR2Store(ctx, claimcheck.Config{
		R2Endpoint:        "https://test.r2.cloudflarestorage.com",
		R2AccessKeyID:     "test-key",
		R2SecretAccessKey: "test-secret",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "bucket name is required")

	// Missing endpoint
	_, err = claimcheck.NewR2Store(ctx, claimcheck.Config{
		R2Bucket:          "test-bucket",
		R2AccessKeyID:     "test-key",
		R2SecretAccessKey: "test-secret",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "endpoint is required")

	// Missing access key
	_, err = claimcheck.NewR2Store(ctx, claimcheck.Config{
		R2Bucket:          "test-bucket",
		R2Endpoint:        "https://test.r2.cloudflarestorage.com",
		R2SecretAccessKey: "test-secret",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "access key ID is required")

	// Missing secret key
	_, err = claimcheck.NewR2Store(ctx, claimcheck.Config{
		R2Bucket:      "test-bucket",
		R2Endpoint:    "https://test.r2.cloudflarestorage.com",
		R2AccessKeyID: "test-key",
	})
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "secret access key is required")
}
