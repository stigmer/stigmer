package runner

import (
	"bytes"
	"encoding/json"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestEnsureResultFromState_Adoption(t *testing.T) {
	state := &RunnerState{
		RunnerID:        "rnr-abc123",
		Slug:            "my-macbook",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             9730,
		TaskQueue:       "runner:rnr-abc123",
		StartedAt:       time.Date(2026, 5, 9, 6, 12, 0, 0, time.UTC),
		Runtime:         RuntimeNative,
		LogFile:         "/home/user/.stigmer/runners/my-macbook.log",
	}

	result := ensureResultFromState("my-macbook", state, ActionAdoptedExisting)

	assert.True(t, result.OK)
	assert.Equal(t, ActionAdoptedExisting, result.Action)
	assert.Equal(t, "rnr-abc123", result.RunnerID)
	assert.Equal(t, "my-macbook", result.Name)
	assert.Equal(t, "acme", result.Org)
	assert.Equal(t, 9730, result.PID)
	assert.Equal(t, RuntimeNative, result.Runtime)
	assert.Equal(t, "api.stigmer.ai:443", result.BackendEndpoint)
	assert.Equal(t, "runner:rnr-abc123", result.TaskQueue)
	assert.Equal(t, "/home/user/.stigmer/runners/my-macbook.log", result.LogFile)
	assert.Empty(t, result.ContainerID)
}

func TestEnsureResultFromState_FreshStart(t *testing.T) {
	state := &RunnerState{
		RunnerID:        "rnr-xyz",
		Slug:            "build-machine",
		Org:             "acme",
		BackendEndpoint: "localhost:7234",
		PID:             4567,
		TaskQueue:       "runner:rnr-xyz",
		StartedAt:       time.Now(),
		Runtime:         RuntimeNative,
	}

	result := ensureResultFromState("build-machine", state, ActionStartedFresh)

	assert.True(t, result.OK)
	assert.Equal(t, ActionStartedFresh, result.Action)
	assert.Equal(t, 4567, result.PID)
}

func TestEnsureResultFromState_Docker(t *testing.T) {
	state := &RunnerState{
		RunnerID:        "rnr-docker",
		Slug:            "docker-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		TaskQueue:       "runner:rnr-docker",
		StartedAt:       time.Now(),
		Runtime:         RuntimeDocker,
		ContainerID:     "sha256:abc123def456789",
	}

	result := ensureResultFromState("docker-runner", state, ActionStartedFresh)

	assert.True(t, result.OK)
	assert.Equal(t, RuntimeDocker, result.Runtime)
	assert.Equal(t, "sha256:abc123def456789", result.ContainerID)
	assert.Equal(t, 0, result.PID)
}

func TestEnsureResultFromState_EmptyRuntimeDefaultsToNative(t *testing.T) {
	state := &RunnerState{
		RunnerID:        "rnr-old",
		Slug:            "old-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             1234,
		TaskQueue:       "runner:rnr-old",
		StartedAt:       time.Now(),
	}

	result := ensureResultFromState("old-runner", state, ActionAdoptedExisting)

	assert.Equal(t, RuntimeNative, result.Runtime)
}

func TestEnsureResult_JSONRoundTrip(t *testing.T) {
	original := &EnsureResult{
		OK:              true,
		Action:          ActionAdoptedExisting,
		RunnerID:        "rnr-abc123",
		Name:            "swarups-macbook-pro-local",
		Org:             "acme",
		PID:             9730,
		Runtime:         RuntimeNative,
		BackendEndpoint: "api.stigmer.ai:443",
		TaskQueue:       "runner:rnr-abc123",
		StartedAt:       time.Date(2026, 5, 9, 6, 12, 0, 0, time.UTC),
		LogFile:         "/Users/swarup/.stigmer/runners/swarups-macbook-pro-local.log",
	}

	data, err := json.Marshal(original)
	require.NoError(t, err)

	var restored EnsureResult
	require.NoError(t, json.Unmarshal(data, &restored))

	assert.Equal(t, original.OK, restored.OK)
	assert.Equal(t, original.Action, restored.Action)
	assert.Equal(t, original.RunnerID, restored.RunnerID)
	assert.Equal(t, original.Name, restored.Name)
	assert.Equal(t, original.Org, restored.Org)
	assert.Equal(t, original.PID, restored.PID)
	assert.Equal(t, original.Runtime, restored.Runtime)
	assert.Equal(t, original.BackendEndpoint, restored.BackendEndpoint)
	assert.Equal(t, original.TaskQueue, restored.TaskQueue)
	assert.True(t, original.StartedAt.Equal(restored.StartedAt))
	assert.Equal(t, original.LogFile, restored.LogFile)
}

func TestEnsureResult_JSONContract_AdoptedExisting(t *testing.T) {
	result := &EnsureResult{
		OK:              true,
		Action:          ActionAdoptedExisting,
		RunnerID:        "rnr_abc123",
		Name:            "swarups-macbook-pro-local",
		Org:             "acme",
		PID:             9730,
		Runtime:         RuntimeNative,
		BackendEndpoint: "api.stigmer.ai:443",
		TaskQueue:       "runner:rnr_abc123",
		StartedAt:       time.Date(2026, 5, 9, 6, 12, 0, 0, time.UTC),
		LogFile:         "/Users/swarup/.stigmer/runners/swarups-macbook-pro-local.log",
	}

	var buf bytes.Buffer
	require.NoError(t, result.WriteJSON(&buf))

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal(buf.Bytes(), &parsed))

	assert.Equal(t, true, parsed["ok"])
	assert.Equal(t, "adopted_existing", parsed["action"])
	assert.Equal(t, "rnr_abc123", parsed["runner_id"])
	assert.Equal(t, "swarups-macbook-pro-local", parsed["name"])
	assert.Equal(t, "acme", parsed["org"])
	assert.Equal(t, float64(9730), parsed["pid"])
	assert.Equal(t, "native", parsed["runtime"])
	assert.Equal(t, "api.stigmer.ai:443", parsed["backend_endpoint"])
	assert.Equal(t, "runner:rnr_abc123", parsed["task_queue"])
	assert.Equal(t, "2026-05-09T06:12:00Z", parsed["started_at"])
	assert.Equal(t, "/Users/swarup/.stigmer/runners/swarups-macbook-pro-local.log", parsed["log_file"])

	_, hasContainerID := parsed["container_id"]
	assert.False(t, hasContainerID, "container_id should be omitted for native runners")
}

func TestEnsureResult_JSONContract_Docker(t *testing.T) {
	result := &EnsureResult{
		OK:              true,
		Action:          ActionStartedFresh,
		RunnerID:        "rnr_docker",
		Name:            "docker-runner",
		Org:             "acme",
		Runtime:         RuntimeDocker,
		ContainerID:     "abc123def456",
		BackendEndpoint: "api.stigmer.ai:443",
		TaskQueue:       "runner:rnr_docker",
		StartedAt:       time.Date(2026, 5, 9, 10, 0, 0, 0, time.UTC),
	}

	var buf bytes.Buffer
	require.NoError(t, result.WriteJSON(&buf))

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal(buf.Bytes(), &parsed))

	assert.Equal(t, "started_fresh", parsed["action"])
	assert.Equal(t, "docker", parsed["runtime"])
	assert.Equal(t, "abc123def456", parsed["container_id"])

	_, hasPID := parsed["pid"]
	assert.False(t, hasPID, "pid should be omitted for Docker runners")
}

func TestWriteJSONError(t *testing.T) {
	var buf bytes.Buffer
	err := WriteJSONError(&buf, assert.AnError, "Run stigmer down runner first")

	require.NoError(t, err)

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal(buf.Bytes(), &parsed))

	assert.Equal(t, false, parsed["ok"])
	assert.NotEmpty(t, parsed["error"])
	assert.Equal(t, "Run stigmer down runner first", parsed["hint"])
}

func TestWriteJSONError_NoHint(t *testing.T) {
	var buf bytes.Buffer
	err := WriteJSONError(&buf, assert.AnError, "")

	require.NoError(t, err)

	var parsed map[string]interface{}
	require.NoError(t, json.Unmarshal(buf.Bytes(), &parsed))

	assert.Equal(t, false, parsed["ok"])
	_, hasHint := parsed["hint"]
	assert.False(t, hasHint, "hint should be omitted when empty")
}

func TestCheckOrAdopt_NoState(t *testing.T) {
	name := "nonexistent-runner-" + t.Name()
	state, err := checkOrAdopt(name, StartOptions{})

	assert.Nil(t, state)
	assert.Nil(t, err)
}

func TestCheckOrAdopt_OrgMismatch(t *testing.T) {
	name := "org-mismatch-runner"
	tmpState := &RunnerState{
		RunnerID:        "rnr-test",
		Slug:            name,
		Org:             "org-a",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             1,
		TaskQueue:       "runner:rnr-test",
		StartedAt:       time.Now(),
	}

	require.NoError(t, SaveState(name, tmpState))
	t.Cleanup(func() { _ = RemoveState(name) })

	state, err := checkOrAdopt(name, StartOptions{OrgOverride: "org-b"})

	if isProcessAlive(1) {
		assert.Nil(t, state)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "already running for organization")
	}
}

func TestCheckOrAdopt_EndpointMismatch(t *testing.T) {
	name := "endpoint-mismatch-runner"
	tmpState := &RunnerState{
		RunnerID:        "rnr-test",
		Slug:            name,
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             1,
		TaskQueue:       "runner:rnr-test",
		StartedAt:       time.Now(),
	}

	require.NoError(t, SaveState(name, tmpState))
	t.Cleanup(func() { _ = RemoveState(name) })

	state, err := checkOrAdopt(name, StartOptions{EndpointOverride: "staging.stigmer.ai:443"})

	if isProcessAlive(1) {
		assert.Nil(t, state)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "already running against")
	}
}
