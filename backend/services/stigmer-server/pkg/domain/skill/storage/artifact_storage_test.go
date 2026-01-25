package storage

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestLocalFileStorage_Store_Success verifies that Store() saves an artifact
// to the filesystem with correct permissions (0600 for security).
func TestLocalFileStorage_Store_Success(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := NewLocalFileStorage(tempDir)
	require.NoError(t, err)

	// Create test artifact
	testData := []byte("test artifact content")
	testHash := CalculateHash(testData)

	// Store the artifact
	storageKey, err := storage.Store(testHash, testData)
	require.NoError(t, err)

	// Verify storage key format
	expectedKey := filepath.Join("skills", testHash+".zip")
	assert.Equal(t, expectedKey, storageKey)

	// Verify file exists
	filePath := filepath.Join(tempDir, storageKey)
	assert.FileExists(t, filePath)

	// Verify file permissions (0600 = owner read/write only)
	info, err := os.Stat(filePath)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0600), info.Mode().Perm(), "file should have 0600 permissions for security")

	// Verify file content
	savedData, err := os.ReadFile(filePath)
	require.NoError(t, err)
	assert.Equal(t, testData, savedData)
}

// TestLocalFileStorage_Store_CreatesDirectory verifies that Store() creates
// the necessary directory structure if it doesn't exist.
func TestLocalFileStorage_Store_CreatesDirectory(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := NewLocalFileStorage(tempDir)
	require.NoError(t, err)

	testData := []byte("test data")
	testHash := CalculateHash(testData)

	// Store should create skills/ directory if needed
	storageKey, err := storage.Store(testHash, testData)
	require.NoError(t, err)

	// Verify directory was created
	skillsDir := filepath.Join(tempDir, "skills")
	assert.DirExists(t, skillsDir)

	// Verify file exists in the directory
	filePath := filepath.Join(tempDir, storageKey)
	assert.FileExists(t, filePath)
}

// TestLocalFileStorage_Get_Success verifies that Get() retrieves
// a previously stored artifact correctly.
func TestLocalFileStorage_Get_Success(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := NewLocalFileStorage(tempDir)
	require.NoError(t, err)

	// Store an artifact first
	testData := []byte("retrievable artifact")
	testHash := CalculateHash(testData)
	storageKey, err := storage.Store(testHash, testData)
	require.NoError(t, err)

	// Retrieve the artifact
	retrieved, err := storage.Get(storageKey)
	require.NoError(t, err)

	// Verify content matches
	assert.Equal(t, testData, retrieved)
}

// TestLocalFileStorage_Get_NotFound verifies that Get() returns
// an appropriate error when the artifact doesn't exist.
func TestLocalFileStorage_Get_NotFound(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := NewLocalFileStorage(tempDir)
	require.NoError(t, err)

	// Try to get non-existent artifact
	nonExistentKey := "skills/nonexistent1234567890abcdef1234567890abcdef1234567890abcdef1234567890.zip"
	_, err = storage.Get(nonExistentKey)

	// Verify error is returned
	require.Error(t, err)
	assert.Contains(t, err.Error(), "artifact not found")
}

// TestLocalFileStorage_Exists_True verifies that Exists() returns true
// for artifacts that have been stored.
func TestLocalFileStorage_Exists_True(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := NewLocalFileStorage(tempDir)
	require.NoError(t, err)

	// Store an artifact
	testData := []byte("existing artifact")
	testHash := CalculateHash(testData)
	_, err = storage.Store(testHash, testData)
	require.NoError(t, err)

	// Check if it exists
	exists, err := storage.Exists(testHash)
	require.NoError(t, err)
	assert.True(t, exists)
}

// TestLocalFileStorage_Exists_False verifies that Exists() returns false
// for artifacts that haven't been stored.
func TestLocalFileStorage_Exists_False(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := NewLocalFileStorage(tempDir)
	require.NoError(t, err)

	// Check for non-existent hash
	nonExistentHash := "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
	exists, err := storage.Exists(nonExistentHash)
	require.NoError(t, err)
	assert.False(t, exists)
}

// TestLocalFileStorage_GetStorageKey verifies that GetStorageKey() returns
// the correct storage key format: skills/{hash}.zip
func TestLocalFileStorage_GetStorageKey(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := NewLocalFileStorage(tempDir)
	require.NoError(t, err)

	testHash := "abc123def456abc123def456abc123def456abc123def456abc123def456abc1"
	expectedKey := filepath.Join("skills", testHash+".zip")

	actualKey := storage.GetStorageKey(testHash)
	assert.Equal(t, expectedKey, actualKey)
}

// TestLocalFileStorage_Deduplication verifies that storing the same content
// twice (same hash) results in a single file on disk (content-addressable storage).
func TestLocalFileStorage_Deduplication(t *testing.T) {
	tempDir := t.TempDir()
	storage, err := NewLocalFileStorage(tempDir)
	require.NoError(t, err)

	testData := []byte("duplicate content")
	testHash := CalculateHash(testData)

	// Store the artifact first time
	storageKey1, err := storage.Store(testHash, testData)
	require.NoError(t, err)

	// Check that it exists
	exists, err := storage.Exists(testHash)
	require.NoError(t, err)
	assert.True(t, exists)

	// Store the same content again (same hash)
	storageKey2, err := storage.Store(testHash, testData)
	require.NoError(t, err)

	// Verify both operations returned the same storage key
	assert.Equal(t, storageKey1, storageKey2)

	// Verify only one file exists
	filePath := filepath.Join(tempDir, storageKey1)
	assert.FileExists(t, filePath)

	// Verify content is correct
	saved, err := storage.Get(storageKey1)
	require.NoError(t, err)
	assert.Equal(t, testData, saved)
}

// TestCalculateHash verifies that SHA256 hash calculation works correctly
// and produces a 64-character hex string.
func TestCalculateHash(t *testing.T) {
	testData := []byte("test data for hashing")
	hash := CalculateHash(testData)

	// Verify hash is 64 characters (SHA256 in hex)
	assert.Len(t, hash, 64, "SHA256 hash should be 64 hex characters")

	// Verify hash contains only hex characters
	for _, c := range hash {
		assert.True(t, (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'),
			"hash should contain only lowercase hex characters")
	}
}

// TestCalculateHash_Deterministic verifies that the same data always
// produces the same hash (required for content-addressable storage).
func TestCalculateHash_Deterministic(t *testing.T) {
	testData := []byte("deterministic test data")

	// Calculate hash multiple times
	hash1 := CalculateHash(testData)
	hash2 := CalculateHash(testData)
	hash3 := CalculateHash(testData)

	// All hashes should be identical
	assert.Equal(t, hash1, hash2)
	assert.Equal(t, hash2, hash3)
}

// TestCalculateHashFromReader verifies that calculating hash from an io.Reader
// produces the same result as calculating from byte slice.
func TestCalculateHashFromReader(t *testing.T) {
	testData := []byte("test data for reader hash")

	// Calculate hash from bytes
	hashFromBytes := CalculateHash(testData)

	// Calculate hash from reader
	reader := bytes.NewReader(testData)
	hashFromReader, err := CalculateHashFromReader(reader)
	require.NoError(t, err)

	// Both methods should produce the same hash
	assert.Equal(t, hashFromBytes, hashFromReader)
}
