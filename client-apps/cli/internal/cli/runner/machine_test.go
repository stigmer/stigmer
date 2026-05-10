package runner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLoadOrCreateMachineID_FreshCreate(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	identity, err := LoadOrCreateMachineID()
	require.NoError(t, err)
	require.NotNil(t, identity)

	assert.True(t, strings.HasPrefix(identity.MachineID, machineIDPrefix))
	assert.Len(t, identity.MachineID, len(machineIDPrefix)+machineIDBytes*2) // "mach_" + 32 hex
	assert.NotEmpty(t, identity.DisplayName)
	assert.False(t, identity.CreatedAt.IsZero())

	// File should exist on disk.
	path := filepath.Join(tmpDir, ".stigmer", "machine.json")
	_, err = os.Stat(path)
	assert.NoError(t, err)
}

func TestLoadOrCreateMachineID_Idempotent(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	first, err := LoadOrCreateMachineID()
	require.NoError(t, err)

	second, err := LoadOrCreateMachineID()
	require.NoError(t, err)

	assert.Equal(t, first.MachineID, second.MachineID)
	assert.Equal(t, first.CreatedAt, second.CreatedAt)
	assert.Equal(t, first.DisplayName, second.DisplayName)
}

func TestLoadOrCreateMachineID_CorruptFileRecovery(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	stigmerDir := filepath.Join(tmpDir, ".stigmer")
	require.NoError(t, os.MkdirAll(stigmerDir, 0755))

	// Write corrupt JSON.
	corruptPath := filepath.Join(stigmerDir, "machine.json")
	require.NoError(t, os.WriteFile(corruptPath, []byte("not valid json{{{"), 0600))

	identity, err := LoadOrCreateMachineID()
	require.NoError(t, err)
	require.NotNil(t, identity)
	assert.True(t, strings.HasPrefix(identity.MachineID, machineIDPrefix))

	// Verify the file was overwritten with valid content.
	data, err := os.ReadFile(corruptPath)
	require.NoError(t, err)

	var restored MachineIdentity
	require.NoError(t, json.Unmarshal(data, &restored))
	assert.Equal(t, identity.MachineID, restored.MachineID)
}

func TestLoadOrCreateMachineID_EmptyMachineIDRecovery(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	stigmerDir := filepath.Join(tmpDir, ".stigmer")
	require.NoError(t, os.MkdirAll(stigmerDir, 0755))

	// Write valid JSON but with empty machine_id (should regenerate).
	emptyID := &MachineIdentity{MachineID: "", DisplayName: "test"}
	data, _ := json.Marshal(emptyID)
	require.NoError(t, os.WriteFile(filepath.Join(stigmerDir, "machine.json"), data, 0600))

	identity, err := LoadOrCreateMachineID()
	require.NoError(t, err)
	require.NotNil(t, identity)
	assert.True(t, strings.HasPrefix(identity.MachineID, machineIDPrefix))
	assert.NotEmpty(t, identity.MachineID)
}

func TestGenerateMachineID_Uniqueness(t *testing.T) {
	ids := make(map[string]struct{}, 100)
	for i := 0; i < 100; i++ {
		id, err := generateMachineID()
		require.NoError(t, err)
		assert.True(t, strings.HasPrefix(id, machineIDPrefix))
		_, exists := ids[id]
		assert.False(t, exists, "generated duplicate ID: %s", id)
		ids[id] = struct{}{}
	}
}

func TestGenerateMachineID_Format(t *testing.T) {
	id, err := generateMachineID()
	require.NoError(t, err)

	assert.True(t, strings.HasPrefix(id, "mach_"))

	hexPart := strings.TrimPrefix(id, "mach_")
	assert.Len(t, hexPart, 32)

	// Verify all characters are valid hex.
	for _, c := range hexPart {
		assert.True(t, (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'),
			"non-hex char %c in machine_id", c)
	}
}
