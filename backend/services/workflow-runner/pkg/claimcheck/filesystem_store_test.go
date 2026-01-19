package claimcheck_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stigmer/stigmer/backend/services/workflow-runner/pkg/claimcheck"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestFilesystemStore_New(t *testing.T) {
	t.Run("creates store with valid path", func(t *testing.T) {
		tmpDir := t.TempDir()
		store, err := claimcheck.NewFilesystemStore(tmpDir)
		require.NoError(t, err)
		require.NotNil(t, store)
	})

	t.Run("creates directory if missing", func(t *testing.T) {
		tmpDir := t.TempDir()
		newDir := filepath.Join(tmpDir, "new", "nested", "dir")
		
		store, err := claimcheck.NewFilesystemStore(newDir)
		require.NoError(t, err)
		require.NotNil(t, store)
		
		// Verify directory was created
		info, err := os.Stat(newDir)
		require.NoError(t, err)
		assert.True(t, info.IsDir())
	})

	t.Run("returns error for empty path", func(t *testing.T) {
		_, err := claimcheck.NewFilesystemStore("")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "base path is required")
	})
}

func TestFilesystemStore_Put(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()
	testData := []byte("Hello, Filesystem!")

	key, err := store.Put(ctx, testData)
	require.NoError(t, err)
	assert.NotEmpty(t, key)

	// Verify file exists
	filePath := filepath.Join(tmpDir, key)
	assert.FileExists(t, filePath)

	// Verify file content
	content, err := os.ReadFile(filePath)
	require.NoError(t, err)
	assert.Equal(t, testData, content)
}

func TestFilesystemStore_Get(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()
	testData := []byte("Test data for get")

	// Put data first
	key, err := store.Put(ctx, testData)
	require.NoError(t, err)

	// Get data
	retrieved, err := store.Get(ctx, key)
	require.NoError(t, err)
	assert.Equal(t, testData, retrieved)
}

func TestFilesystemStore_Get_Nonexistent(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()
	
	// Try to get non-existent key
	_, err = store.Get(ctx, "nonexistent-key")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "filesystem get failed")
}

func TestFilesystemStore_Delete(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()
	testData := []byte("Data to be deleted")

	// Put data
	key, err := store.Put(ctx, testData)
	require.NoError(t, err)

	filePath := filepath.Join(tmpDir, key)
	assert.FileExists(t, filePath)

	// Delete
	err = store.Delete(ctx, key)
	require.NoError(t, err)

	// Verify file removed
	_, err = os.Stat(filePath)
	assert.True(t, os.IsNotExist(err))
}

func TestFilesystemStore_Delete_Nonexistent(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()

	// Delete non-existent file should not error (idempotent)
	err = store.Delete(ctx, "nonexistent-key")
	assert.NoError(t, err)
}

func TestFilesystemStore_Health(t *testing.T) {
	t.Run("healthy when directory exists", func(t *testing.T) {
		tmpDir := t.TempDir()
		store, err := claimcheck.NewFilesystemStore(tmpDir)
		require.NoError(t, err)

		ctx := context.Background()
		err = store.Health(ctx)
		assert.NoError(t, err)
	})

	t.Run("unhealthy when directory removed", func(t *testing.T) {
		tmpDir := t.TempDir()
		store, err := claimcheck.NewFilesystemStore(tmpDir)
		require.NoError(t, err)

		// Remove directory after creation
		err = os.RemoveAll(tmpDir)
		require.NoError(t, err)

		ctx := context.Background()
		err = store.Health(ctx)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "filesystem health check failed")
	})
}

func TestFilesystemStore_ListKeys(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()

	t.Run("empty directory", func(t *testing.T) {
		keys, err := store.ListKeys(ctx)
		require.NoError(t, err)
		assert.Empty(t, keys)
	})

	t.Run("lists stored keys", func(t *testing.T) {
		// Put multiple items
		data1 := []byte("Item 1")
		data2 := []byte("Item 2")
		data3 := []byte("Item 3")

		key1, err := store.Put(ctx, data1)
		require.NoError(t, err)
		key2, err := store.Put(ctx, data2)
		require.NoError(t, err)
		key3, err := store.Put(ctx, data3)
		require.NoError(t, err)

		// List keys
		keys, err := store.ListKeys(ctx)
		require.NoError(t, err)
		assert.Len(t, keys, 3)
		assert.Contains(t, keys, key1)
		assert.Contains(t, keys, key2)
		assert.Contains(t, keys, key3)
	})

	t.Run("ignores subdirectories", func(t *testing.T) {
		// Create a subdirectory
		subDir := filepath.Join(tmpDir, "subdir")
		err := os.Mkdir(subDir, 0755)
		require.NoError(t, err)

		// List should not include the subdirectory
		keys, err := store.ListKeys(ctx)
		require.NoError(t, err)
		assert.NotContains(t, keys, "subdir")
	})
}

func TestFilesystemStore_PutGet_RoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()

	testCases := []struct {
		name string
		data []byte
	}{
		{"small payload", []byte("Hello, World!")},
		{"empty payload", []byte("")},
		{"binary data", []byte{0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD}},
		{"large payload", make([]byte, 1024*1024)}, // 1MB
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			// Put
			key, err := store.Put(ctx, tc.data)
			require.NoError(t, err)
			assert.NotEmpty(t, key)

			// Get
			retrieved, err := store.Get(ctx, key)
			require.NoError(t, err)
			assert.Equal(t, tc.data, retrieved)

			// Cleanup
			err = store.Delete(ctx, key)
			require.NoError(t, err)
		})
	}
}

func TestFilesystemStore_ConcurrentOperations(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()

	// Test concurrent puts
	t.Run("concurrent puts", func(t *testing.T) {
		done := make(chan string, 10)

		for i := 0; i < 10; i++ {
			go func(index int) {
				data := []byte("concurrent data")
				key, err := store.Put(ctx, data)
				require.NoError(t, err)
				done <- key
			}(i)
		}

		// Collect all keys
		keys := make([]string, 10)
		for i := 0; i < 10; i++ {
			keys[i] = <-done
		}

		// All keys should be unique
		keySet := make(map[string]bool)
		for _, key := range keys {
			assert.False(t, keySet[key], "duplicate key: %s", key)
			keySet[key] = true
		}
	})
}

func TestFilesystemStore_LargePayload(t *testing.T) {
	tmpDir := t.TempDir()
	store, err := claimcheck.NewFilesystemStore(tmpDir)
	require.NoError(t, err)

	ctx := context.Background()

	// 10MB payload
	largeData := make([]byte, 10*1024*1024)
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
