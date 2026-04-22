package root

import (
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"testing"
	"time"

	"github.com/fatih/color"
	"github.com/spf13/cobra"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
)

func init() {
	color.NoColor = true
}

func daemonPortInUse() bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", daemon.DaemonPort), 500*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func skipIfDaemonRunning(t *testing.T) {
	t.Helper()
	if daemonPortInUse() {
		t.Skipf("skipping: stigmer daemon is already running on port %d", daemon.DaemonPort)
	}
}

// localAnthropicConfig returns a config with a non-Ollama LLM provider,
// avoiding any dependency on a running Ollama instance.
func localAnthropicConfig() string {
	return `backend:
  type: local
  local:
    llm:
      provider: anthropic
      model: claude-sonnet-4.5
    temporal:
      managed: true
    execution:
      mode: local
      auto_pull: true
      cleanup: true
      ttl: 3600
`
}

// =============================================================================
// resolveResultFormat
// =============================================================================

func TestResolveResultFormat(t *testing.T) {
	tests := []struct {
		name      string
		jsonFlag  bool
		quietFlag bool
		want      clioutput.OutputFormat
	}{
		{"default returns human", false, false, clioutput.FormatHuman},
		{"json flag returns json", true, false, clioutput.FormatJSON},
		{"quiet flag returns quiet", false, true, clioutput.FormatQuiet},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveResultFormat(tt.jsonFlag, tt.quietFlag)
			assert.Equal(t, tt.want, got)
		})
	}
}

// =============================================================================
// Flag Registration
// =============================================================================

func TestFlagRegistration_AllCommandsHaveJsonAndQuietFlags(t *testing.T) {
	tests := []struct {
		name string
		cmd  *cobra.Command
	}{
		{"delete", NewDeleteCommand()},
		{"apply", NewApplyCommand()},
		{"config set", newConfigSetCommand()},
		{"config list", newConfigListCommand()},
		{"backend status", newBackendStatusCommand()},
		{"backend set", newBackendSetCommand()},
		{"up", NewUpCommand()},
		{"down", NewDownCommand()},
		{"status", NewStatusCommand()},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jsonFlag := tt.cmd.Flags().Lookup("json")
			require.NotNil(t, jsonFlag, "--json flag must be registered")
			assert.Equal(t, "false", jsonFlag.DefValue)
			assert.Empty(t, jsonFlag.Shorthand, "--json should have no shorthand")

			quietFlag := tt.cmd.Flags().Lookup("quiet")
			require.NotNil(t, quietFlag, "--quiet flag must be registered")
			assert.Equal(t, "false", quietFlag.DefValue)
			assert.Equal(t, "q", quietFlag.Shorthand)
		})
	}
}

// =============================================================================
// JSON Output Tests
// =============================================================================

// jsonEnvelope is the top-level structure emitted by JSONRenderer.
type jsonEnvelope struct {
	Status   string        `json:"status"`
	Message  string        `json:"message"`
	Sections []jsonSection `json:"sections,omitempty"`
	Hints    []string      `json:"hints,omitempty"`
}

type jsonSection struct {
	Title  string      `json:"title,omitempty"`
	Fields []jsonField `json:"fields,omitempty"`
	Items  []string    `json:"items,omitempty"`
}

type jsonField struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

func TestJSONOutput_SuccessPaths(t *testing.T) {
	tests := []struct {
		name           string
		config         string
		handler        func()
		wantStatus     string
		wantMsgContain string
		wantSections   bool
	}{
		{
			name:           "config list",
			config:         localAnthropicConfig(),
			handler:        func() { handleConfigList(clioutput.FormatJSON) },
			wantStatus:     "success",
			wantMsgContain: "Configuration",
			wantSections:   true,
		},
		{
			name:           "config set",
			config:         localAnthropicConfig(),
			handler:        func() { handleConfigSet("llm.model", "claude-sonnet-4.5", clioutput.FormatJSON) },
			wantStatus:     "success",
			wantMsgContain: "Configuration updated",
			wantSections:   false,
		},
		{
			name:           "backend status",
			config:         localAnthropicConfig(),
			handler:        func() { handleBackendStatus(clioutput.FormatJSON) },
			wantStatus:     "success",
			wantMsgContain: "Backend",
			wantSections:   true,
		},
		{
			name:           "backend set local",
			config:         localAnthropicConfig(),
			handler:        func() { handleBackendSet("local", clioutput.FormatJSON) },
			wantStatus:     "success",
			wantMsgContain: "Backend set to local",
			wantSections:   false,
		},
	
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setupTestHome(t, tt.config)

			stdout := captureStdout(t, tt.handler)

			var envelope jsonEnvelope
			require.NoError(t, json.Unmarshal([]byte(stdout), &envelope),
				"stdout must be valid JSON; got: %s", stdout)

			assert.Equal(t, tt.wantStatus, envelope.Status)
			assert.Contains(t, envelope.Message, tt.wantMsgContain)

			if tt.wantSections {
				assert.NotEmpty(t, envelope.Sections, "expected at least one section")
			}
		})
	}
}

func TestJSONOutput_WarningPaths(t *testing.T) {
	tests := []struct {
		name           string
		config         string
		handler        func()
		wantStatus     string
		wantMsgContain string
		needsNoDaemon  bool
	}{
		{
			name:           "down not running",
			config:         localAnthropicConfig(),
			handler:        func() { handleStop(clioutput.FormatJSON) },
			wantStatus:     "warning",
			wantMsgContain: "not running",
			needsNoDaemon:  true,
		},
		{
			name:           "status not running",
			config:         localAnthropicConfig(),
			handler:        func() { handleStatus(clioutput.FormatJSON) },
			wantStatus:     "warning",
			wantMsgContain: "not running",
			needsNoDaemon:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.needsNoDaemon {
				skipIfDaemonRunning(t)
			}
			setupTestHome(t, tt.config)

			stdout := captureStdout(t, tt.handler)

			var envelope jsonEnvelope
			require.NoError(t, json.Unmarshal([]byte(stdout), &envelope),
				"stdout must be valid JSON; got: %s", stdout)

			assert.Equal(t, tt.wantStatus, envelope.Status)
			assert.True(t,
				strings.Contains(strings.ToLower(envelope.Message), strings.ToLower(tt.wantMsgContain)),
				"message %q should contain %q", envelope.Message, tt.wantMsgContain)
		})
	}
}

// =============================================================================
// Quiet Output Tests
// =============================================================================

func TestQuietOutput_StdoutIsEmpty(t *testing.T) {
	tests := []struct {
		name          string
		config        string
		handler       func()
		needsNoDaemon bool
	}{
		{"config list", localAnthropicConfig(), func() { handleConfigList(clioutput.FormatQuiet) }, false},
		{"config set", localAnthropicConfig(), func() { handleConfigSet("llm.model", "claude-sonnet-4.5", clioutput.FormatQuiet) }, false},
		{"backend status", localAnthropicConfig(), func() { handleBackendStatus(clioutput.FormatQuiet) }, false},
		{"backend set local", localAnthropicConfig(), func() { handleBackendSet("local", clioutput.FormatQuiet) }, false},
		{"down not running", localAnthropicConfig(), func() { handleStop(clioutput.FormatQuiet) }, true},
		{"status not running", localAnthropicConfig(), func() { handleStatus(clioutput.FormatQuiet) }, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.needsNoDaemon {
				skipIfDaemonRunning(t)
			}
			setupTestHome(t, tt.config)

			stdout := captureStdout(t, tt.handler)
			assert.Empty(t, stdout, "quiet format must not write to stdout")
		})
	}
}
