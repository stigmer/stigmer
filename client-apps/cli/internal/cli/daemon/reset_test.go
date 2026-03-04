package daemon

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRemoveSQLiteDatabase(t *testing.T) {
	configDir := t.TempDir()

	base := filepath.Join(configDir, "stigmer.db")
	require.NoError(t, os.WriteFile(base, []byte("db"), 0644))
	require.NoError(t, os.WriteFile(base+"-wal", []byte("wal"), 0644))
	require.NoError(t, os.WriteFile(base+"-shm", []byte("shm"), 0644))

	removed, err := removeSQLiteDatabase(configDir)
	require.NoError(t, err)

	assert.ElementsMatch(t, []string{base, base + "-wal", base + "-shm"}, removed)
	assert.NoFileExists(t, base)
	assert.NoFileExists(t, base+"-wal")
	assert.NoFileExists(t, base+"-shm")
}

func TestRemoveSQLiteDatabase_OnlyMainFile(t *testing.T) {
	configDir := t.TempDir()

	base := filepath.Join(configDir, "stigmer.db")
	require.NoError(t, os.WriteFile(base, []byte("db"), 0644))

	removed, err := removeSQLiteDatabase(configDir)
	require.NoError(t, err)

	assert.Equal(t, []string{base}, removed)
	assert.NoFileExists(t, base)
}

func TestRemoveSQLiteDatabase_NoneExist(t *testing.T) {
	configDir := t.TempDir()

	removed, err := removeSQLiteDatabase(configDir)
	require.NoError(t, err)
	assert.Empty(t, removed)
}

func TestRemoveStorageDir(t *testing.T) {
	configDir := t.TempDir()
	storageDir := filepath.Join(configDir, "storage")
	require.NoError(t, os.MkdirAll(filepath.Join(storageDir, "skills"), 0755))
	require.NoError(t, os.WriteFile(filepath.Join(storageDir, "skills", "s1.zip"), []byte("data"), 0644))

	removed, err := removeStorageDir(configDir)
	require.NoError(t, err)

	assert.Equal(t, []string{storageDir}, removed)
	assert.NoDirExists(t, storageDir)
}

func TestRemoveSessionsDir(t *testing.T) {
	configDir := t.TempDir()
	sessionsDir := filepath.Join(configDir, "sessions")
	require.NoError(t, os.MkdirAll(sessionsDir, 0755))
	require.NoError(t, os.WriteFile(filepath.Join(sessionsDir, "abc.json"), []byte("{}"), 0644))

	removed, err := removeSessionsDir(configDir)
	require.NoError(t, err)

	assert.Equal(t, []string{sessionsDir}, removed)
	assert.NoDirExists(t, sessionsDir)
}

func TestRemoveRuntimesDir(t *testing.T) {
	configDir := t.TempDir()
	runtimesDir := filepath.Join(configDir, "runtimes")
	require.NoError(t, os.MkdirAll(filepath.Join(runtimesDir, "agent-runner"), 0755))

	removed, err := removeRuntimesDir(configDir)
	require.NoError(t, err)

	assert.Equal(t, []string{runtimesDir}, removed)
	assert.NoDirExists(t, runtimesDir)
}

func TestRemoveIfExists_NotPresent(t *testing.T) {
	removed, err := removeIfExists(filepath.Join(t.TempDir(), "does-not-exist"))
	require.NoError(t, err)
	assert.Empty(t, removed)
}
