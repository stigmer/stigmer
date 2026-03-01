package daemon

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestIsAgentRunnerDocker_StartupConfigNative(t *testing.T) {
	dataDir := t.TempDir()
	writeStartupConfig(t, dataDir, "native")

	if IsAgentRunnerDocker(dataDir) {
		t.Error("expected false when startup config says native")
	}
}

func TestIsAgentRunnerDocker_StartupConfigDocker(t *testing.T) {
	dataDir := t.TempDir()
	writeStartupConfig(t, dataDir, "docker")

	if !IsAgentRunnerDocker(dataDir) {
		t.Error("expected true when startup config says docker")
	}
}

func TestIsAgentRunnerDocker_StartupConfigOverridesStaleContainerID(t *testing.T) {
	dataDir := t.TempDir()
	writeStartupConfig(t, dataDir, "native")
	writeMarkerFile(t, dataDir, AgentRunnerContainerIDFileName)

	if IsAgentRunnerDocker(dataDir) {
		t.Error("startup config (native) should override stale container ID file")
	}
}

func TestIsAgentRunnerDocker_StartupConfigOverridesStalePID(t *testing.T) {
	dataDir := t.TempDir()
	writeStartupConfig(t, dataDir, "docker")
	writeMarkerFile(t, dataDir, AgentRunnerPIDFileName)

	if !IsAgentRunnerDocker(dataDir) {
		t.Error("startup config (docker) should override stale PID file")
	}
}

func TestIsAgentRunnerDocker_PIDFileOnly(t *testing.T) {
	dataDir := t.TempDir()
	writeMarkerFile(t, dataDir, AgentRunnerPIDFileName)

	if IsAgentRunnerDocker(dataDir) {
		t.Error("PID file present with no config should indicate native (not Docker)")
	}
}

func TestIsAgentRunnerDocker_ContainerIDFileOnly(t *testing.T) {
	dataDir := t.TempDir()
	writeMarkerFile(t, dataDir, AgentRunnerContainerIDFileName)

	if !IsAgentRunnerDocker(dataDir) {
		t.Error("container ID file present with no config should indicate Docker")
	}
}

func TestIsAgentRunnerDocker_BothMarkers_PIDWins(t *testing.T) {
	dataDir := t.TempDir()
	writeMarkerFile(t, dataDir, AgentRunnerPIDFileName)
	writeMarkerFile(t, dataDir, AgentRunnerContainerIDFileName)

	if IsAgentRunnerDocker(dataDir) {
		t.Error("when both markers exist, PID (native) should take precedence")
	}
}

func TestIsAgentRunnerDocker_NoMarkersNoConfig(t *testing.T) {
	dataDir := t.TempDir()

	if IsAgentRunnerDocker(dataDir) {
		t.Error("no markers and no config should default to false (not Docker)")
	}
}

func TestIsAgentRunnerDocker_EmptyModeInConfig(t *testing.T) {
	dataDir := t.TempDir()
	writeStartupConfig(t, dataDir, "")

	if IsAgentRunnerDocker(dataDir) {
		t.Error("empty mode in config with no markers should default to false")
	}
}

func TestIsAgentRunnerDocker_EmptyModeWithContainerID(t *testing.T) {
	dataDir := t.TempDir()
	writeStartupConfig(t, dataDir, "")
	writeMarkerFile(t, dataDir, AgentRunnerContainerIDFileName)

	if !IsAgentRunnerDocker(dataDir) {
		t.Error("empty mode should fall through to marker heuristic; container ID means Docker")
	}
}

// --- helpers ---

func writeStartupConfig(t *testing.T, dataDir, mode string) {
	t.Helper()
	cfg := StartupConfig{
		DataDir:         dataDir,
		AgentRunnerMode: mode,
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataDir, startupConfigFileName), data, 0644); err != nil {
		t.Fatal(err)
	}
}

func writeMarkerFile(t *testing.T, dataDir, name string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dataDir, name), []byte("test"), 0644); err != nil {
		t.Fatal(err)
	}
}
