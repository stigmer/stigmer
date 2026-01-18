package claimcheck

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/google/uuid"
)

// FilesystemStore implements ObjectStore using local disk storage
type FilesystemStore struct {
	basePath string
}

// NewFilesystemStore creates filesystem-backed store
func NewFilesystemStore(basePath string) (*FilesystemStore, error) {
	// Validate required config
	if basePath == "" {
		return nil, fmt.Errorf("filesystem base path is required")
	}

	// Create directory if it doesn't exist
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("failed to create storage directory: %w", err)
	}

	return &FilesystemStore{
		basePath: basePath,
	}, nil
}

// Put writes data to filesystem with UUID key
func (f *FilesystemStore) Put(ctx context.Context, data []byte) (string, error) {
	key := uuid.New().String() // Generate unique key

	filePath := filepath.Join(f.basePath, key)
	if err := os.WriteFile(filePath, data, 0644); err != nil {
		return "", fmt.Errorf("filesystem put failed: %w", err)
	}

	return key, nil
}

// Get retrieves data from filesystem by key
func (f *FilesystemStore) Get(ctx context.Context, key string) ([]byte, error) {
	filePath := filepath.Join(f.basePath, key)
	
	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, fmt.Errorf("filesystem get failed: %w", err)
	}

	return data, nil
}

// Delete removes file from filesystem
func (f *FilesystemStore) Delete(ctx context.Context, key string) error {
	filePath := filepath.Join(f.basePath, key)
	
	err := os.Remove(filePath)
	if err != nil {
		// Ignore "not found" errors - already deleted
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("filesystem delete failed: %w", err)
	}

	return nil
}

// Health checks filesystem accessibility
func (f *FilesystemStore) Health(ctx context.Context) error {
	// Check if base path exists and is accessible
	info, err := os.Stat(f.basePath)
	if err != nil {
		return fmt.Errorf("filesystem health check failed: %w", err)
	}

	// Verify it's a directory
	if !info.IsDir() {
		return fmt.Errorf("filesystem health check failed: %s is not a directory", f.basePath)
	}

	return nil
}

// ListKeys lists all files in storage directory
func (f *FilesystemStore) ListKeys(ctx context.Context) ([]string, error) {
	entries, err := os.ReadDir(f.basePath)
	if err != nil {
		return nil, fmt.Errorf("filesystem list failed: %w", err)
	}

	keys := make([]string, 0, len(entries))
	for _, entry := range entries {
		// Only include files, skip directories
		if !entry.IsDir() {
			keys = append(keys, entry.Name())
		}
	}

	return keys, nil
}
