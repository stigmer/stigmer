package storage

import (
	"context"
	"fmt"
	"time"
)

// ArtifactStorage provides an interface for storing and retrieving agent execution artifacts.
// This supports both input attachments and output artifacts from agent executions.
type ArtifactStorage interface {
	// Upload stores artifact data with the given key and returns the storage location
	Upload(ctx context.Context, key string, data []byte, contentType string) error

	// Download retrieves artifact data by key
	Download(ctx context.Context, key string) ([]byte, error)

	// GetSignedURL generates a time-limited download URL for the artifact.
	// expiresIn specifies how long the URL should remain valid.
	//
	// downloadFilename controls Content-Disposition on the resulting URL: when
	// non-empty, the URL forces a browser download saved under that filename
	// (Content-Disposition: attachment); when empty, the URL displays inline
	// (today's behavior). The disposition is baked into the URL itself because
	// browsers ignore the HTML `download` attribute on cross-origin URLs.
	GetSignedURL(ctx context.Context, key string, expiresIn time.Duration, downloadFilename string) (string, error)

	// Delete removes the artifact from storage
	Delete(ctx context.Context, key string) error

	// Exists checks if an artifact with the given key exists
	Exists(ctx context.Context, key string) (bool, error)

	// Health checks storage connectivity
	Health(ctx context.Context) error
}

// Config holds artifact storage configuration
type Config struct {
	// Storage selection
	Type string // "local" or "r2" (default: "local")

	// Local filesystem configuration
	LocalBasePath string // Base directory for local storage
	LocalServeURL string // Base URL for serving local files (e.g., "http://localhost:7235")

	// Cloudflare R2 configuration (S3-compatible)
	R2Bucket          string
	R2Endpoint        string // Cloudflare R2 endpoint
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2Region          string // Usually "auto" for R2
}

// NewArtifactStorage creates an ArtifactStorage implementation based on config.
func NewArtifactStorage(ctx context.Context, cfg Config) (ArtifactStorage, error) {
	storageType := cfg.Type
	if storageType == "" {
		storageType = "local" // Default to local
	}

	switch storageType {
	case "local":
		return NewLocalStorage(cfg.LocalBasePath, cfg.LocalServeURL)
	case "r2":
		return NewR2Storage(ctx, cfg)
	default:
		return nil, fmt.Errorf("unknown storage type: %s (must be 'local' or 'r2')", storageType)
	}
}
