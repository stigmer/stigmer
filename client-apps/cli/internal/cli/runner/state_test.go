package runner

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestRunnerState_IsDocker(t *testing.T) {
	assert.True(t, (&RunnerState{Runtime: RuntimeDocker}).IsDocker())
	assert.False(t, (&RunnerState{Runtime: RuntimeNative}).IsDocker())
	assert.False(t, (&RunnerState{Runtime: ""}).IsDocker())
}

func TestRunnerState_BackwardCompatibility_EmptyRuntime(t *testing.T) {
	// State files from before Docker placement have no Runtime field.
	// They must deserialize with Runtime="" and IsDocker()=false.
	oldJSON := `{
		"runner_id": "rnr-abc",
		"slug": "my-runner",
		"org": "acme",
		"backend_endpoint": "api.stigmer.ai:443",
		"pid": 12345,
		"task_queue": "runner:rnr-abc",
		"started_at": "2026-04-23T12:00:00Z"
	}`

	var state RunnerState
	err := json.Unmarshal([]byte(oldJSON), &state)
	require.NoError(t, err)

	assert.Equal(t, "rnr-abc", state.RunnerID)
	assert.Equal(t, "", state.Runtime)
	assert.Equal(t, "", state.ContainerID)
	assert.False(t, state.IsDocker())
}

func TestRunnerState_DockerRoundTrip(t *testing.T) {
	original := &RunnerState{
		RunnerID:        "rnr-xyz",
		Slug:            "docker-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		TaskQueue:       "runner:rnr-xyz",
		StartedAt:       time.Date(2026, 4, 23, 12, 0, 0, 0, time.UTC),
		Runtime:         RuntimeDocker,
		ContainerID:     "sha256:abc123def456789",
	}

	data, err := json.Marshal(original)
	require.NoError(t, err)

	var restored RunnerState
	require.NoError(t, json.Unmarshal(data, &restored))

	assert.Equal(t, RuntimeDocker, restored.Runtime)
	assert.Equal(t, "sha256:abc123def456789", restored.ContainerID)
	assert.True(t, restored.IsDocker())
	assert.Equal(t, 0, restored.PID)
}

func TestRunnerState_NativeOmitsDockerFields(t *testing.T) {
	state := &RunnerState{
		RunnerID:        "rnr-abc",
		Slug:            "native-runner",
		Org:             "acme",
		BackendEndpoint: "localhost:7234",
		PID:             12345,
		TaskQueue:       "runner:rnr-abc",
		StartedAt:       time.Date(2026, 4, 23, 12, 0, 0, 0, time.UTC),
		Runtime:         RuntimeNative,
	}

	data, err := json.Marshal(state)
	require.NoError(t, err)

	// runtime:"native" is included via omitempty only when non-empty,
	// but "native" is non-empty so it's present. ContainerID must be absent.
	assert.NotContains(t, string(data), "container_id")
}

func TestRunnerState_BackwardCompatibility_NoMachineID(t *testing.T) {
	// State files from before T03 have no machine_id field.
	// They must deserialize with MachineID="" without error.
	oldJSON := `{
		"runner_id": "rnr-pre-t03",
		"slug": "my-runner",
		"org": "acme",
		"backend_endpoint": "api.stigmer.ai:443",
		"pid": 12345,
		"task_queue": "runner:rnr-pre-t03",
		"started_at": "2026-05-09T12:00:00Z",
		"runtime": "native"
	}`

	var state RunnerState
	err := json.Unmarshal([]byte(oldJSON), &state)
	require.NoError(t, err)

	assert.Equal(t, "rnr-pre-t03", state.RunnerID)
	assert.Equal(t, "", state.MachineID)
}

func TestRunnerState_MachineID_RoundTrip(t *testing.T) {
	original := &RunnerState{
		RunnerID:        "rnr-t03",
		Slug:            "my-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             12345,
		TaskQueue:       "runner:rnr-t03",
		StartedAt:       time.Date(2026, 5, 9, 12, 0, 0, 0, time.UTC),
		Runtime:         RuntimeNative,
		MachineID:       "mach_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
	}

	data, err := json.Marshal(original)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"machine_id":"mach_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"`)

	var restored RunnerState
	require.NoError(t, json.Unmarshal(data, &restored))
	assert.Equal(t, "mach_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6", restored.MachineID)
}

func TestRunnerState_MachineID_OmittedWhenEmpty(t *testing.T) {
	state := &RunnerState{
		RunnerID:  "rnr-old",
		Slug:      "my-runner",
		Org:       "acme",
		PID:       12345,
		TaskQueue: "runner:rnr-old",
		StartedAt: time.Date(2026, 5, 9, 12, 0, 0, 0, time.UTC),
		MachineID: "",
	}

	data, err := json.Marshal(state)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "machine_id")
}

func TestSaveAndLoadState_Docker(t *testing.T) {
	tmpDir := t.TempDir()

	// Override the runners dir via a state file written directly
	statePath := filepath.Join(tmpDir, "test-docker-runner.json")
	state := &RunnerState{
		RunnerID:        "rnr-docker",
		Slug:            "test-docker-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		TaskQueue:       "runner:rnr-docker",
		StartedAt:       time.Now().Truncate(time.Second),
		Runtime:         RuntimeDocker,
		ContainerID:     "abc123def456",
	}

	data, err := json.MarshalIndent(state, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(statePath, data, 0600))

	// Read it back
	readData, err := os.ReadFile(statePath)
	require.NoError(t, err)

	var loaded RunnerState
	require.NoError(t, json.Unmarshal(readData, &loaded))

	assert.Equal(t, RuntimeDocker, loaded.Runtime)
	assert.Equal(t, "abc123def456", loaded.ContainerID)
	assert.True(t, loaded.IsDocker())
	assert.Equal(t, state.RunnerID, loaded.RunnerID)
}

// --- SocketPath backward compatibility ---

func TestRunnerState_BackwardCompatibility_NoSocketPath(t *testing.T) {
	oldJSON := `{
		"runner_id": "rnr-pre-t04",
		"slug": "my-runner",
		"org": "acme",
		"backend_endpoint": "api.stigmer.ai:443",
		"pid": 12345,
		"task_queue": "runner:rnr-pre-t04",
		"started_at": "2026-05-09T12:00:00Z",
		"machine_id": "mach_aabb"
	}`

	var state RunnerState
	err := json.Unmarshal([]byte(oldJSON), &state)
	require.NoError(t, err)
	assert.Equal(t, "", state.SocketPath)
}

func TestRunnerState_SocketPath_RoundTrip(t *testing.T) {
	original := &RunnerState{
		RunnerID:   "rnr-t04",
		Slug:       "my-runner",
		Org:        "acme",
		PID:        12345,
		TaskQueue:  "runner:rnr-t04",
		StartedAt:  time.Date(2026, 5, 9, 12, 0, 0, 0, time.UTC),
		MachineID:  "mach_aabb",
		SocketPath: "/home/user/.stigmer/run/runner.sock",
	}

	data, err := json.Marshal(original)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"socket_path"`)

	var restored RunnerState
	require.NoError(t, json.Unmarshal(data, &restored))
	assert.Equal(t, "/home/user/.stigmer/run/runner.sock", restored.SocketPath)
}

func TestRunnerState_SocketPath_OmittedWhenEmpty(t *testing.T) {
	state := &RunnerState{
		RunnerID:   "rnr-old",
		Slug:       "my-runner",
		Org:        "acme",
		PID:        12345,
		TaskQueue:  "runner:rnr-old",
		StartedAt:  time.Date(2026, 5, 9, 12, 0, 0, 0, time.UTC),
		SocketPath: "",
	}

	data, err := json.Marshal(state)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "socket_path")
}

// --- MigrateStateLayout tests ---

func TestMigrateStateLayout_RenamesSlugToMachineID(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "old-hostname", &RunnerState{
		RunnerID:  "rnr-migrate",
		Slug:      "old-hostname",
		Org:       "acme",
		PID:       os.Getpid(),
		TaskQueue: "runner:rnr-migrate",
		StartedAt: time.Now(),
		MachineID: "mach_aabbccdd11223344aabbccdd11223344",
	})

	migrated := MigrateStateLayout()
	require.Len(t, migrated, 1)
	assert.Contains(t, migrated[0], "old-hostname")
	assert.Contains(t, migrated[0], "mach_aabbccdd11223344aabbccdd11223344")

	// Old file should be gone.
	_, err := os.Stat(filepath.Join(dir, "old-hostname.json"))
	assert.True(t, os.IsNotExist(err))

	// New file should exist with correct content.
	state, err := LoadState("mach_aabbccdd11223344aabbccdd11223344")
	require.NoError(t, err)
	assert.Equal(t, "rnr-migrate", state.RunnerID)
	assert.Equal(t, "mach_aabbccdd11223344aabbccdd11223344", state.MachineID)
}

func TestMigrateStateLayout_SkipsAlreadyMigrated(t *testing.T) {
	dir := withTestRunnersDir(t)

	machineID := "mach_aabbccdd11223344aabbccdd11223344"
	writeTestState(t, dir, machineID, &RunnerState{
		RunnerID:  "rnr-already",
		Slug:      "my-runner",
		Org:       "acme",
		PID:       os.Getpid(),
		TaskQueue: "runner:rnr-already",
		StartedAt: time.Now(),
		MachineID: machineID,
	})

	migrated := MigrateStateLayout()
	assert.Empty(t, migrated)

	// File should still exist under machine_id name.
	state, err := LoadState(machineID)
	require.NoError(t, err)
	assert.Equal(t, "rnr-already", state.RunnerID)
}

func TestMigrateStateLayout_Idempotent(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "old-name", &RunnerState{
		RunnerID:  "rnr-idem",
		Slug:      "old-name",
		Org:       "acme",
		PID:       os.Getpid(),
		TaskQueue: "runner:rnr-idem",
		StartedAt: time.Now(),
		MachineID: "mach_1122334455667788aabbccddeeff0011",
	})

	migrated1 := MigrateStateLayout()
	require.Len(t, migrated1, 1)

	// Second call should find nothing to migrate.
	migrated2 := MigrateStateLayout()
	assert.Empty(t, migrated2)
}

func TestMigrateStateLayout_SkipsEmptyMachineID(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "legacy-no-machid", &RunnerState{
		RunnerID:  "rnr-legacy",
		Slug:      "legacy-no-machid",
		Org:       "acme",
		PID:       os.Getpid(),
		TaskQueue: "runner:rnr-legacy",
		StartedAt: time.Now(),
		MachineID: "",
	})

	migrated := MigrateStateLayout()
	assert.Empty(t, migrated)

	// Original file should remain.
	_, err := os.Stat(filepath.Join(dir, "legacy-no-machid.json"))
	assert.NoError(t, err)
}

func TestMigrateStateLayout_MigratesLogFile(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "slug-with-log", &RunnerState{
		RunnerID:  "rnr-log",
		Slug:      "slug-with-log",
		Org:       "acme",
		PID:       os.Getpid(),
		TaskQueue: "runner:rnr-log",
		StartedAt: time.Now(),
		MachineID: "mach_logtest1234567890abcdef12345678",
	})

	// Create a log file alongside the state file.
	logPath := filepath.Join(dir, "slug-with-log.log")
	require.NoError(t, os.WriteFile(logPath, []byte("test log"), 0600))

	migrated := MigrateStateLayout()
	require.Len(t, migrated, 1)

	// Old log should be gone.
	_, err := os.Stat(logPath)
	assert.True(t, os.IsNotExist(err))

	// New log should exist.
	newLog := filepath.Join(dir, "mach_logtest1234567890abcdef12345678.log")
	data, err := os.ReadFile(newLog)
	require.NoError(t, err)
	assert.Equal(t, "test log", string(data))
}

// --- Orphan detection tests ---

func TestIsOrphaned_CurrentProcess(t *testing.T) {
	// The test process itself is never orphaned (it has a real parent).
	assert.False(t, isOrphaned(os.Getpid()))
}

func TestIsOrphaned_DeadPID(t *testing.T) {
	// A PID that doesn't exist cannot be checked — returns false (safe default).
	assert.False(t, isOrphaned(999999999))
}

func TestIsOrphaned_ZeroPID(t *testing.T) {
	assert.False(t, isOrphaned(0))
}

func TestIsOrphaned_NegativePID(t *testing.T) {
	assert.False(t, isOrphaned(-1))
}

func TestIsProcessAlive_CurrentProcess(t *testing.T) {
	assert.True(t, isProcessAlive(os.Getpid()))
}

func TestIsProcessAlive_DeadPID(t *testing.T) {
	assert.False(t, isProcessAlive(999999999))
}

func TestIsProcessAlive_ZeroPID(t *testing.T) {
	assert.False(t, isProcessAlive(0))
}

func TestRunnerState_CursorRunnerPID_RoundTrip(t *testing.T) {
	original := &RunnerState{
		RunnerID:        "rnr-cursor",
		Slug:            "my-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             12345,
		TaskQueue:       "runner:rnr-cursor",
		StartedAt:       time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC),
		Runtime:         RuntimeNative,
		CursorRunnerPID: 12346,
	}

	data, err := json.Marshal(original)
	require.NoError(t, err)
	assert.Contains(t, string(data), `"cursor_runner_pid":12346`)

	var restored RunnerState
	require.NoError(t, json.Unmarshal(data, &restored))
	assert.Equal(t, 12346, restored.CursorRunnerPID)
}

func TestRunnerState_CursorRunnerPID_OmittedWhenZero(t *testing.T) {
	state := &RunnerState{
		RunnerID:        "rnr-no-cursor",
		Slug:            "my-runner",
		Org:             "acme",
		PID:             12345,
		TaskQueue:       "runner:rnr-no-cursor",
		StartedAt:       time.Date(2026, 5, 10, 12, 0, 0, 0, time.UTC),
		CursorRunnerPID: 0,
	}

	data, err := json.Marshal(state)
	require.NoError(t, err)
	assert.NotContains(t, string(data), "cursor_runner_pid")
}

func TestMigrateStateLayout_DoesNotOverwriteExisting(t *testing.T) {
	dir := withTestRunnersDir(t)
	machineID := "mach_collision12345678901234567890ab"

	// Write two state files: one under the slug, one already at the machine_id.
	writeTestState(t, dir, "slug-name", &RunnerState{
		RunnerID:  "rnr-slug",
		Slug:      "slug-name",
		Org:       "acme",
		PID:       os.Getpid(),
		TaskQueue: "runner:rnr-slug",
		StartedAt: time.Now(),
		MachineID: machineID,
	})

	writeTestState(t, dir, machineID, &RunnerState{
		RunnerID:  "rnr-existing",
		Slug:      "other-runner",
		Org:       "acme",
		PID:       os.Getpid(),
		TaskQueue: "runner:rnr-existing",
		StartedAt: time.Now(),
		MachineID: machineID,
	})

	migrated := MigrateStateLayout()
	assert.Empty(t, migrated)

	// The existing file should not have been overwritten.
	state, err := LoadState(machineID)
	require.NoError(t, err)
	assert.Equal(t, "rnr-existing", state.RunnerID)

	// The slug file should still be there.
	_, err = os.Stat(filepath.Join(dir, "slug-name.json"))
	assert.NoError(t, err)
}
