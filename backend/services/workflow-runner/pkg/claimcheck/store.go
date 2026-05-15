package claimcheck

import (
	"context"
)

// ObjectStore abstracts external storage backends (Cloudflare R2, S3, etc.)
type ObjectStore interface {
	// Put uploads data and returns unique storage key
	Put(ctx context.Context, data []byte) (key string, err error)

	// Get retrieves data by key
	Get(ctx context.Context, key string) (data []byte, err error)

	// Delete removes data by key (for TTL cleanup)
	Delete(ctx context.Context, key string) error

	// Health checks storage availability
	Health(ctx context.Context) error

	// ListKeys lists all stored keys (for admin/debugging)
	ListKeys(ctx context.Context) ([]string, error)
}

// Config holds storage backend configuration
type Config struct {
	ThresholdBytes     int64 // Offload if payload > threshold
	TTLDays            int   // Auto-delete after N days
	CompressionEnabled bool  // Enable gzip compression

	// Storage selection: "r2", "filesystem", or "proxy" (default: "r2")
	StorageType string

	// Filesystem configuration
	FilesystemBasePath string // Base directory for local storage

	// Cloudflare R2 configuration (S3-compatible, used when StorageType = "r2")
	R2Bucket          string
	R2Endpoint        string // Cloudflare R2 endpoint
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2Region          string // Usually "auto" for R2

	// Proxy configuration (used when StorageType = "proxy")
	ProxyEndpoint  string // Stigmer Side-Channel Proxy base URL
	ProxyAuthToken string // Bearer token for proxy authentication
}
