package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ArtifactStorage provides an interface for storing and retrieving skill artifacts.
// This abstraction allows for different storage backends (local file system, cloud bucket, etc.)
type ArtifactStorage interface {
	// Store saves a skill artifact and returns the storage key.
	// The hash is used as the unique identifier (content-addressable storage).
	Store(hash string, data []byte) (storageKey string, err error)

	// Get retrieves a skill artifact by its storage key.
	Get(storageKey string) (data []byte, err error)

	// Exists checks if an artifact with the given hash already exists.
	// This is used for deduplication - if the same content is uploaded twice,
	// we can skip re-uploading.
	Exists(hash string) (bool, error)

	// GetStorageKey returns the storage key for a given hash (without actually storing).
	// This is useful for constructing paths or URLs.
	GetStorageKey(hash string) string

	// Size reports the stored artifact's byte size without loading it.
	// Used by getArtifactDownloadUrl so clients can sanity-check before
	// fetching over HTTP.
	Size(storageKey string) (int64, error)
}

// LocalFileStorage implements ArtifactStorage using the local filesystem.
// Artifacts are stored in: <storagePath>/skills/<hash>.zip
type LocalFileStorage struct {
	storagePath string
}

// NewLocalFileStorage creates a new local file storage backend.
func NewLocalFileStorage(storagePath string) (*LocalFileStorage, error) {
	// Ensure skills subdirectory exists
	skillsDir := filepath.Join(storagePath, "skills")
	if err := os.MkdirAll(skillsDir, 0755); err != nil {
		return nil, fmt.Errorf("failed to create skills storage directory: %w", err)
	}

	return &LocalFileStorage{
		storagePath: storagePath,
	}, nil
}

// Store saves the artifact to local filesystem.
// Security: File is written with 0600 permissions (owner read/write only).
func (s *LocalFileStorage) Store(hash string, data []byte) (string, error) {
	storageKey := s.GetStorageKey(hash)
	filePath := filepath.Join(s.storagePath, storageKey)

	// Ensure parent directory exists
	if err := os.MkdirAll(filepath.Dir(filePath), 0755); err != nil {
		return "", fmt.Errorf("failed to create directory: %w", err)
	}

	// Write file with restricted permissions (owner read/write only)
	// This prevents unauthorized access to skill artifacts
	if err := os.WriteFile(filePath, data, 0600); err != nil {
		return "", fmt.Errorf("failed to write artifact: %w", err)
	}

	return storageKey, nil
}

// Get retrieves the artifact from local filesystem.
func (s *LocalFileStorage) Get(storageKey string) ([]byte, error) {
	filePath, ok := s.resolveWithinRoot(storageKey)
	if !ok {
		// A traversal key (e.g. "../../etc/passwd") addresses nothing inside the
		// store; treat it as a missing artifact rather than reading the escaped path.
		return nil, fmt.Errorf("artifact not found: %s", storageKey)
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, fmt.Errorf("artifact not found: %s", storageKey)
		}
		return nil, fmt.Errorf("failed to read artifact: %w", err)
	}

	return data, nil
}

// resolveWithinRoot joins a client-supplied storage key to the storage root and
// confirms the cleaned result stays inside the root. It returns false for keys
// that escape via path traversal (e.g. "../../etc/passwd"), guarding against
// reading arbitrary files off the host.
func (s *LocalFileStorage) resolveWithinRoot(storageKey string) (string, bool) {
	root := filepath.Clean(s.storagePath)
	filePath := filepath.Join(root, storageKey)
	if filePath != root && !strings.HasPrefix(filePath, root+string(os.PathSeparator)) {
		return "", false
	}
	return filePath, true
}

// Size reports the artifact file's byte size via stat (never reads content).
func (s *LocalFileStorage) Size(storageKey string) (int64, error) {
	filePath, ok := s.resolveWithinRoot(storageKey)
	if !ok {
		return 0, fmt.Errorf("artifact not found: %s", storageKey)
	}

	info, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, fmt.Errorf("artifact not found: %s", storageKey)
		}
		return 0, fmt.Errorf("failed to stat artifact: %w", err)
	}
	return info.Size(), nil
}

// Exists checks if the artifact file exists.
func (s *LocalFileStorage) Exists(hash string) (bool, error) {
	storageKey := s.GetStorageKey(hash)
	filePath := filepath.Join(s.storagePath, storageKey)

	_, err := os.Stat(filePath)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

// GetStorageKey returns the relative storage path for a hash.
// Format: skills/<hash>.zip
func (s *LocalFileStorage) GetStorageKey(hash string) string {
	return filepath.Join("skills", hash+".zip")
}

// CalculateHash computes the SHA256 hash of the given data.
// This is used to generate content-addressable identifiers.
func CalculateHash(data []byte) string {
	hash := sha256.Sum256(data)
	return hex.EncodeToString(hash[:])
}

// CalculateHashFromReader computes the SHA256 hash from an io.Reader.
// This is useful when working with streams instead of byte slices.
func CalculateHashFromReader(r io.Reader) (string, error) {
	hasher := sha256.New()
	if _, err := io.Copy(hasher, r); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}
