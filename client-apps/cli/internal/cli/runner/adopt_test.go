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

// withTestRunnersDir overrides $HOME so that RunnersDir() resolves to a
// temp directory. Returns a cleanup function that restores the original.
func withTestRunnersDir(t *testing.T) string {
	t.Helper()
	tmpDir := t.TempDir()
	t.Setenv("HOME", tmpDir)

	runnersDir := filepath.Join(tmpDir, ".stigmer", "runners")
	require.NoError(t, os.MkdirAll(runnersDir, 0755))
	return runnersDir
}

func writeTestState(t *testing.T, dir, name string, state *RunnerState) {
	t.Helper()
	data, err := json.MarshalIndent(state, "", "  ")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, name+".json"), data, 0600))
}

func TestCheckOrAdopt_NoStateFile(t *testing.T) {
	withTestRunnersDir(t)

	adopted, err := checkOrAdopt("nonexistent", "", StartOptions{})
	assert.NoError(t, err)
	assert.Nil(t, adopted)
}

func TestCheckOrAdopt_DeadProcess(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "dead-runner", &RunnerState{
		RunnerID:        "rnr-dead",
		Slug:            "dead-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             999999,
		TaskQueue:       "runner:rnr-dead",
		StartedAt:       time.Now().Add(-1 * time.Hour),
		Runtime:         RuntimeNative,
	})

	adopted, err := checkOrAdopt("dead-runner", "", StartOptions{})
	assert.NoError(t, err)
	assert.Nil(t, adopted)

	// Stale state file should be removed.
	_, statErr := os.Stat(filepath.Join(dir, "dead-runner.json"))
	assert.True(t, os.IsNotExist(statErr))
}

func TestCheckOrAdopt_AliveRunner_NoOverrides(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "my-runner", &RunnerState{
		RunnerID:        "rnr-abc",
		Slug:            "my-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-abc",
		StartedAt:       time.Now().Add(-10 * time.Minute),
		Runtime:         RuntimeNative,
	})

	adopted, err := checkOrAdopt("my-runner", "", StartOptions{})
	assert.NoError(t, err)
	require.NotNil(t, adopted)
	assert.Equal(t, "rnr-abc", adopted.RunnerID)
	assert.Equal(t, os.Getpid(), adopted.PID)
}

func TestCheckOrAdopt_AliveRunner_MatchingOrg(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "my-runner", &RunnerState{
		RunnerID:        "rnr-abc",
		Slug:            "my-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-abc",
		StartedAt:       time.Now().Add(-10 * time.Minute),
		Runtime:         RuntimeNative,
	})

	adopted, err := checkOrAdopt("my-runner", "", StartOptions{
		OrgOverride:      "acme",
		EndpointOverride: "api.stigmer.ai:443",
	})
	assert.NoError(t, err)
	require.NotNil(t, adopted)
	assert.Equal(t, "rnr-abc", adopted.RunnerID)
}

func TestCheckOrAdopt_AliveRunner_OrgMismatch(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "my-runner", &RunnerState{
		RunnerID:        "rnr-abc",
		Slug:            "my-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-abc",
		StartedAt:       time.Now().Add(-10 * time.Minute),
		Runtime:         RuntimeNative,
	})

	adopted, err := checkOrAdopt("my-runner", "", StartOptions{
		OrgOverride: "other-org",
	})
	assert.Error(t, err)
	assert.Nil(t, adopted)
	assert.Contains(t, err.Error(), "already running for organization")
	assert.Contains(t, err.Error(), "acme")
	assert.Contains(t, err.Error(), "other-org")
}

func TestCheckOrAdopt_AliveRunner_EndpointMismatch(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "my-runner", &RunnerState{
		RunnerID:        "rnr-abc",
		Slug:            "my-runner",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-abc",
		StartedAt:       time.Now().Add(-10 * time.Minute),
		Runtime:         RuntimeNative,
	})

	adopted, err := checkOrAdopt("my-runner", "", StartOptions{
		EndpointOverride: "localhost:7234",
	})
	assert.Error(t, err)
	assert.Nil(t, adopted)
	assert.Contains(t, err.Error(), "already running against")
	assert.Contains(t, err.Error(), "api.stigmer.ai:443")
	assert.Contains(t, err.Error(), "localhost:7234")
}

func TestCheckOrAdopt_AliveRunner_EmptyOrgInState(t *testing.T) {
	dir := withTestRunnersDir(t)

	// Legacy state files may have empty org — should adopt, not conflict.
	writeTestState(t, dir, "legacy-runner", &RunnerState{
		RunnerID:        "rnr-legacy",
		Slug:            "legacy-runner",
		Org:             "",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-legacy",
		StartedAt:       time.Now().Add(-30 * time.Minute),
		Runtime:         RuntimeNative,
	})

	adopted, err := checkOrAdopt("legacy-runner", "", StartOptions{
		OrgOverride: "acme",
	})
	assert.NoError(t, err)
	require.NotNil(t, adopted)
	assert.Equal(t, "rnr-legacy", adopted.RunnerID)
}

func TestCheckOrAdopt_AliveRunner_EmptyEndpointInState(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "legacy-runner", &RunnerState{
		RunnerID:        "rnr-legacy",
		Slug:            "legacy-runner",
		Org:             "acme",
		BackendEndpoint: "",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-legacy",
		StartedAt:       time.Now().Add(-30 * time.Minute),
		Runtime:         RuntimeNative,
	})

	adopted, err := checkOrAdopt("legacy-runner", "", StartOptions{
		EndpointOverride: "api.stigmer.ai:443",
	})
	assert.NoError(t, err)
	require.NotNil(t, adopted)
	assert.Equal(t, "rnr-legacy", adopted.RunnerID)
}

// --- Machine ID adoption tests ---

func TestCheckOrAdopt_MachineID_HostnameChanged(t *testing.T) {
	dir := withTestRunnersDir(t)

	// Runner exists under old hostname slug, with machine_id set.
	writeTestState(t, dir, "old-hostname", &RunnerState{
		RunnerID:        "rnr-mac",
		Slug:            "old-hostname",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-mac",
		StartedAt:       time.Now().Add(-1 * time.Hour),
		Runtime:         RuntimeNative,
		MachineID:       "mach_deadbeef12345678abcdef0123456789ab",
	})

	// Current hostname resolves to "new-hostname" — no state file at that slug.
	// But machine_id matches, so adoption should succeed.
	adopted, err := checkOrAdopt("new-hostname", "mach_deadbeef12345678abcdef0123456789ab", StartOptions{})
	assert.NoError(t, err)
	require.NotNil(t, adopted)
	assert.Equal(t, "rnr-mac", adopted.RunnerID)
	assert.Equal(t, "mach_deadbeef12345678abcdef0123456789ab", adopted.MachineID)
}

func TestCheckOrAdopt_MachineID_NoMatch(t *testing.T) {
	dir := withTestRunnersDir(t)

	// Runner exists with a different machine_id.
	writeTestState(t, dir, "other-machine", &RunnerState{
		RunnerID:        "rnr-other",
		Slug:            "other-machine",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-other",
		StartedAt:       time.Now().Add(-1 * time.Hour),
		Runtime:         RuntimeNative,
		MachineID:       "mach_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	})

	// Different machine_id — should not adopt.
	adopted, err := checkOrAdopt("my-runner", "mach_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", StartOptions{})
	assert.NoError(t, err)
	assert.Nil(t, adopted)
}

func TestCheckOrAdopt_MachineID_OrgMismatch(t *testing.T) {
	dir := withTestRunnersDir(t)

	writeTestState(t, dir, "old-hostname", &RunnerState{
		RunnerID:        "rnr-mac",
		Slug:            "old-hostname",
		Org:             "acme",
		BackendEndpoint: "api.stigmer.ai:443",
		PID:             os.Getpid(),
		TaskQueue:       "runner:rnr-mac",
		StartedAt:       time.Now().Add(-1 * time.Hour),
		Runtime:         RuntimeNative,
		MachineID:       "mach_deadbeef12345678abcdef0123456789ab",
	})

	// Same machine_id but different org → conflict error.
	adopted, err := checkOrAdopt("new-hostname", "mach_deadbeef12345678abcdef0123456789ab", StartOptions{
		OrgOverride: "other-org",
	})
	assert.Error(t, err)
	assert.Nil(t, adopted)
	assert.Contains(t, err.Error(), "already running for organization")
}
