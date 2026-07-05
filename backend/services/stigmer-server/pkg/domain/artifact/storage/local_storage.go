package storage

import (
	"context"
	"fmt"
	neturl "net/url"
	"os"
	"path/filepath"
	"time"
)

// LocalStorage implements ArtifactStorage using the local filesystem.
// Artifacts are stored in: <basePath>/artifacts/<key>
type LocalStorage struct {
	basePath string
	serveURL string // Base URL for generating download URLs
}

// NewLocalStorage creates a new local filesystem storage backend.
func NewLocalStorage(basePath, serveURL string) (*LocalStorage, error) {
	// Ensure artifacts directory exists
	artifactsDir := filepath.Join(basePath, "artifacts")
	if err := os.MkdirAll(artifactsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create artifacts directory: %w", err)
	}

	return &LocalStorage{
		basePath: basePath,
		serveURL: serveURL,
	}, nil
}

// Upload saves the artifact to local filesystem.
func (s *LocalStorage) Upload(ctx context.Context, key string, data []byte, contentType string) error {
	filePath := s.getFilePath(key)

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Write file with restricted permissions
	if err := os.WriteFile(filePath, data, 0600); err != nil {
		return fmt.Errorf("failed to write artifact: %w", err)
	}

	return nil
}

// Download retrieves the artifact from local filesystem.
func (s *LocalStorage) Download(ctx context.Context, key string) ([]byte, error) {
	filePath := s.getFilePath(key)

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("artifact not found: %s", key)
		}
		return nil, fmt.Errorf("failed to read artifact: %w", err)
	}

	return data, nil
}

// GetSignedURL returns a direct URL to the artifact.
// For local storage, this is simply the serve URL + key.
// Note: In production, you'd want proper authentication/authorization.
//
// When downloadFilename is non-empty, a `download` query parameter carrying
// the (URL-encoded) name is appended. The local artifact file server reads it
// and sets Content-Disposition: attachment, mirroring the R2 backend's signed
// disposition so the download UX is identical across storage backends.
func (s *LocalStorage) GetSignedURL(ctx context.Context, key string, expiresIn time.Duration, downloadFilename string) (string, error) {
	if s.serveURL == "" {
		return "", fmt.Errorf("local serve URL not configured")
	}

	// For local storage, we return a simple URL
	// In production, you might want to add authentication tokens
	url := fmt.Sprintf("%s/%s", s.serveURL, key)
	if downloadFilename != "" {
		url += "?" + LocalDownloadQueryParam + "=" + neturl.QueryEscape(downloadFilename)
	}
	return url, nil
}

// Delete removes the artifact from filesystem.
func (s *LocalStorage) Delete(ctx context.Context, key string) error {
	filePath := s.getFilePath(key)

	err := os.Remove(filePath)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete artifact: %w", err)
	}

	// Try to remove empty parent directories
	s.cleanupEmptyDirs(filepath.Dir(filePath))

	return nil
}

// Exists checks if the artifact file exists.
func (s *LocalStorage) Exists(ctx context.Context, key string) (bool, error) {
	filePath := s.getFilePath(key)

	_, err := os.Stat(filePath)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// Health checks local filesystem accessibility.
func (s *LocalStorage) Health(ctx context.Context) error {
	artifactsDir := filepath.Join(s.basePath, "artifacts")

	// Check if directory exists and is writable
	info, err := os.Stat(artifactsDir)
	if err != nil {
		return fmt.Errorf("artifacts directory not accessible: %w", err)
	}

	if !info.IsDir() {
		return fmt.Errorf("artifacts path is not a directory")
	}

	// Try to create a test file to verify write permissions
	testFile := filepath.Join(artifactsDir, ".health_check")
	if err := os.WriteFile(testFile, []byte("ok"), 0600); err != nil {
		return fmt.Errorf("artifacts directory not writable: %w", err)
	}

	// Clean up test file
	_ = os.Remove(testFile)

	return nil
}

// getFilePath returns the full filesystem path for a storage key.
func (s *LocalStorage) getFilePath(key string) string {
	return filepath.Join(s.basePath, "artifacts", key)
}

// cleanupEmptyDirs removes empty parent directories up to the artifacts root.
func (s *LocalStorage) cleanupEmptyDirs(dir string) {
	artifactsRoot := filepath.Join(s.basePath, "artifacts")

	// Don't delete the artifacts root directory
	if dir == artifactsRoot || !filepath.HasPrefix(dir, artifactsRoot) {
		return
	}

	// Try to remove the directory (will fail if not empty)
	if err := os.Remove(dir); err == nil {
		// Successfully removed, try parent
		s.cleanupEmptyDirs(filepath.Dir(dir))
	}
}
