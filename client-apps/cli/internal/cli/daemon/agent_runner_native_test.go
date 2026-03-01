package daemon

import (
	"strings"
	"testing"
)

func TestBuildNativeAgentRunnerEnv(t *testing.T) {
	dataDir := "/tmp/stigmer-test/data"
	secrets := map[string]string{
		"ANTHROPIC_API_KEY": "sk-ant-test",
	}

	env := buildNativeAgentRunnerEnv(
		dataDir,
		"localhost:7233",
		"anthropic",
		"claude-sonnet-4.5",
		"http://localhost:11434",
		"local",
		"ghcr.io/stigmer/agent-sandbox-basic:latest",
		true,
		true,
		3600,
		secrets,
	)

	assertEnvContains(t, env, "MODE", "local")
	assertEnvContains(t, env, "STIGMER_BACKEND_ENDPOINT", "localhost:7234")
	assertEnvContains(t, env, "TEMPORAL_SERVICE_ADDRESS", "localhost:7233")
	assertEnvContains(t, env, "SANDBOX_ROOT_DIR", "/tmp/stigmer-test/data/workspace")
	assertEnvContains(t, env, "LOCAL_ARTIFACT_PATH", "/tmp/stigmer-test/data/artifacts")
	assertEnvContains(t, env, "LOCAL_ARTIFACT_SERVE_URL", "http://localhost:7235")
	assertEnvContains(t, env, "STIGMER_LLM_PROVIDER", "anthropic")
	assertEnvContains(t, env, "STIGMER_LLM_MODEL", "claude-sonnet-4.5")
	assertEnvContains(t, env, "OLLAMA_BASE_URL", "http://localhost:11434")
	assertEnvPresent(t, env, "ANTHROPIC_API_KEY")

	// Native mode must NOT set WORKSPACE_ROOT (Docker artifact)
	for _, e := range env {
		if strings.HasPrefix(e, "WORKSPACE_ROOT=") {
			t.Errorf("native env should not contain WORKSPACE_ROOT, but found: %s", e)
		}
	}
}

func TestBuildNativeAgentRunnerEnv_NoHostDockerInternal(t *testing.T) {
	env := buildNativeAgentRunnerEnv(
		"/tmp/data", "localhost:7233",
		"ollama", "qwen2.5-coder:7b", "http://localhost:11434",
		"local", "img:latest", true, true, 3600, nil,
	)

	for _, e := range env {
		if strings.Contains(e, "host.docker.internal") {
			t.Errorf("native env must not reference host.docker.internal: %s", e)
		}
	}
}

func TestTailBytes(t *testing.T) {
	tests := []struct {
		name  string
		input string
		n     int
		want  string
	}{
		{"shorter than n", "hello", 10, "hello"},
		{"exact n", "hello", 5, "hello"},
		{"longer than n", "hello world", 5, "...world"},
		{"empty", "", 5, ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tailBytes([]byte(tt.input), tt.n)
			if got != tt.want {
				t.Errorf("tailBytes(%q, %d) = %q, want %q", tt.input, tt.n, got, tt.want)
			}
		})
	}
}

func assertEnvContains(t *testing.T, env []string, key, wantValue string) {
	t.Helper()
	prefix := key + "="
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			gotValue := strings.TrimPrefix(e, prefix)
			if gotValue != wantValue {
				t.Errorf("env %s = %q, want %q", key, gotValue, wantValue)
			}
			return
		}
	}
	t.Errorf("env %s not found", key)
}

func assertEnvPresent(t *testing.T, env []string, key string) {
	t.Helper()
	prefix := key + "="
	for _, e := range env {
		if strings.HasPrefix(e, prefix) {
			return
		}
	}
	t.Errorf("env %s not found", key)
}
