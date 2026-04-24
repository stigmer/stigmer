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
