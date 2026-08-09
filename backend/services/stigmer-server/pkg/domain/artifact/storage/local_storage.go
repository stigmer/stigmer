package storage

import (
	"context"
	"fmt"
	neturl "net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// LocalStorage implements ArtifactStorage using the local filesystem.
//
// The configured base path IS the artifact root: a key K is stored at
// <basePath>/<K>, with no implicit "artifacts" segment. This makes the base
// path the exact directory the agent-runner reads via LOCAL_ARTIFACT_PATH, so
// the server and the runner share one store by construction (#285).
type LocalStorage struct {
	basePath string
	serveURL string // Base URL for generating download URLs
}

// NewLocalStorage creates a new local filesystem storage backend.
func NewLocalStorage(basePath, serveURL string) (*LocalStorage, error) {
	s := &LocalStorage{
		basePath: basePath,
		serveURL: serveURL,
	}
	// Ensure artifacts directory exists
	if err := os.MkdirAll(s.root(), 0755); err != nil {
		return nil, fmt.Errorf("failed to create artifacts directory: %w", err)
	}
	return s, nil
}

// Upload saves the artifact to local filesystem.
func (s *LocalStorage) Upload(ctx context.Context, key string, data []byte, contentType string) error {
	filePath, err := s.resolveWithinRoot(key)
	if err != nil {
		return err
	}

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
	filePath, err := s.resolveWithinRoot(key)
	if err != nil {
		return nil, err
	}

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
	filePath, err := s.resolveWithinRoot(key)
	if err != nil {
		return err
	}

	if err := os.Remove(filePath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to delete artifact: %w", err)
	}

	// Try to remove empty parent directories
	s.cleanupEmptyDirs(filepath.Dir(filePath))

	return nil
}

// Exists checks if the artifact file exists.
func (s *LocalStorage) Exists(ctx context.Context, key string) (bool, error) {
	filePath, err := s.resolveWithinRoot(key)
	if err != nil {
		return false, err
	}

	_, err = os.Stat(filePath)
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
	artifactsDir := s.root()

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

// root is the single directory every artifact key resolves under. The base path
// is the root itself (#285): keeping it in one place means the key→path mapping,
// the health probe, and the cleanup floor can never disagree about where the
// store lives.
func (s *LocalStorage) root() string {
	return s.basePath
}

// resolveWithinRoot maps a storage key to an absolute filesystem path and
// guarantees the result stays inside the artifact root. Storage keys carry
// caller-influenced segments (an attachment's original filename rides in the
// key), and `filepath.Join` *cleans* `..` rather than rejecting it — so without
// this guard a crafted key escapes the store and reads or writes arbitrary
// paths. Any key that resolves outside the root is refused with a descriptive,
// non-path error; the caller never receives a usable path for an escape.
func (s *LocalStorage) resolveWithinRoot(key string) (string, error) {
	root := s.root()
	full := filepath.Join(root, key)
	if !isWithin(root, full) {
		return "", fmt.Errorf("storage key %q resolves outside the artifact storage root", key)
	}
	return full, nil
}

// isWithin reports whether `path` is `root` itself or a descendant of it. It
// compares cleaned paths with a trailing separator so a sibling whose name
// merely shares a prefix (e.g. `/a/bc` vs `/a/b`) is correctly excluded — the
// bug the deprecated, lexical `filepath.HasPrefix` would have introduced.
func isWithin(root, path string) bool {
	root = filepath.Clean(root)
	path = filepath.Clean(path)
	return path == root || strings.HasPrefix(path, root+string(os.PathSeparator))
}

// cleanupEmptyDirs removes empty parent directories up to (but not including)
// the artifacts root.
func (s *LocalStorage) cleanupEmptyDirs(dir string) {
	root := s.root()

	// Never climb above or delete the artifacts root itself.
	if !isWithin(root, dir) || filepath.Clean(dir) == filepath.Clean(root) {
		return
	}

	// Try to remove the directory (will fail if not empty)
	if err := os.Remove(dir); err == nil {
		// Successfully removed, try parent
		s.cleanupEmptyDirs(filepath.Dir(dir))
	}
}
