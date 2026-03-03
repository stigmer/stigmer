package root

import (
	"fmt"
	"os"
	"strings"
	"time"

	"google.golang.org/grpc"

	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/search"
)

// checkStatus represents the outcome of a single diagnostic check.
type checkStatus int

const (
	statusPass checkStatus = iota
	statusWarn
	statusFail
	statusSkip
)

// statusSymbol returns the Unicode indicator for a check status.
func statusSymbol(s checkStatus) string {
	switch s {
	case statusPass:
		return "✓"
	case statusWarn:
		return "⚠"
	case statusFail:
		return "✗"
	case statusSkip:
		return "○"
	default:
		return "?"
	}
}

// checkField is a key-value pair displayed within a check's output section.
type checkField struct {
	key   string
	value string
}

// checkResult captures the outcome of a single diagnostic check.
type checkResult struct {
	name   string
	status checkStatus
	fields []checkField
	hint   string
}

func checkConfig(cfg *config.Config) checkResult {
	r := checkResult{name: "Configuration"}

	configPath, err := config.GetConfigPath()
	if err != nil {
		r.status = statusFail
		r.fields = []checkField{{key: "Config file", value: fmt.Sprintf("Cannot determine path %s", statusSymbol(statusFail))}}
		r.hint = "Ensure $HOME is set correctly"
		return r
	}

	if !config.IsInitialized() {
		r.status = statusWarn
		r.fields = []checkField{
			{key: "Config file", value: fmt.Sprintf("%s (not found) %s", configPath, statusSymbol(statusWarn))},
			{key: "Backend", value: "local (default)"},
		}
		r.hint = "Run 'stigmer server' to initialize, or create " + configPath + " manually"
		return r
	}

	homePath := abbreviateHome(configPath)

	r.status = statusPass
	r.fields = []checkField{
		{key: "Config file", value: fmt.Sprintf("%s %s", homePath, statusSymbol(statusPass))},
		{key: "Backend", value: string(cfg.Backend.Type)},
	}

	switch cfg.Backend.Type {
	case config.BackendTypeCloud:
		endpoint := "api.stigmer.ai:443"
		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.Endpoint != "" {
			endpoint = cfg.Backend.Cloud.Endpoint
		}
		r.fields = append(r.fields, checkField{key: "Endpoint", value: endpoint})

	case config.BackendTypeLocal:
		r.fields = append(r.fields, checkField{key: "Endpoint", value: "localhost:7234"})
	}

	return r
}

func checkAuth(cfg *config.Config) checkResult {
	r := checkResult{name: "Authentication"}

	if cfg.Backend.Type == config.BackendTypeLocal {
		r.status = statusSkip
		r.fields = []checkField{
			{key: "Status", value: fmt.Sprintf("Not applicable (local backend) %s", statusSymbol(statusSkip))},
		}
		return r
	}

	if cfg.Backend.Cloud == nil || cfg.Backend.Cloud.Token == "" {
		r.status = statusFail
		r.fields = []checkField{
			{key: "Token", value: fmt.Sprintf("Not configured %s", statusSymbol(statusFail))},
		}
		r.hint = "Authenticate with: stigmer login"
		return r
	}

	r.status = statusWarn
	r.fields = []checkField{
		{key: "Token", value: fmt.Sprintf("Configured (not verified) %s", statusSymbol(statusWarn))},
	}
	r.hint = "Token validation is not yet available"
	return r
}

func checkOrg(cfg *config.Config) (checkResult, string) {
	r := checkResult{name: "Organization"}

	orgID := cfg.ResolveContextOrganization()
	if orgID == "" {
		r.status = statusFail
		r.fields = []checkField{
			{key: "Context", value: fmt.Sprintf("Not set %s", statusSymbol(statusFail))},
		}
		r.hint = "Set organization context: stigmer context set --org <slug>"
		return r, ""
	}

	r.status = statusPass
	r.fields = []checkField{
		{key: "Context", value: fmt.Sprintf("%s %s", orgID, statusSymbol(statusPass))},
	}
	return r, orgID
}

func checkAgents(conn grpc.ClientConnInterface, orgID string) checkResult {
	r := checkResult{name: "Agents"}

	result, err := search.List(&search.ListOptions{
		Conn:     conn,
		Kind:     apiresourcekind.ApiResourceKind_agent,
		Org:      orgID,
		PageSize: 1,
	})
	if err != nil {
		r.status = statusWarn
		r.fields = []checkField{
			{key: "Availability", value: fmt.Sprintf("Could not query agents %s", statusSymbol(statusWarn))},
		}
		r.hint = "Agent listing failed — the server may not support the Search API yet"
		return r
	}

	count := result.TotalCount
	if count == 0 {
		r.status = statusWarn
		r.fields = []checkField{
			{key: "Availability", value: fmt.Sprintf("No agents found %s", statusSymbol(statusWarn))},
		}
		r.hint = "Apply agent definitions: stigmer apply -f agent.yaml"
		return r
	}

	r.status = statusPass
	r.fields = []checkField{
		{key: "Availability", value: fmt.Sprintf("%d agent(s) found %s", count, statusSymbol(statusPass))},
	}
	return r
}

func checkMCPHealth() checkResult {
	return checkResult{
		name:   "MCP Servers",
		status: statusSkip,
		fields: []checkField{
			{key: "Health", value: fmt.Sprintf("Skipped — runtime health check not yet implemented %s", statusSymbol(statusSkip))},
		},
	}
}

func skipCheck(name, reason string) checkResult {
	return checkResult{
		name:   name,
		status: statusSkip,
		fields: []checkField{
			{key: "Status", value: fmt.Sprintf("Skipped — %s %s", reason, statusSymbol(statusSkip))},
		},
	}
}

func formatLatency(d time.Duration) string {
	if d < time.Millisecond {
		return fmt.Sprintf("%dµs", d.Microseconds())
	}
	return fmt.Sprintf("%dms", d.Milliseconds())
}

// abbreviateHome replaces the home directory prefix with ~ for display.
func abbreviateHome(path string) string {
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if strings.HasPrefix(path, home) {
		return "~" + path[len(home):]
	}
	return path
}
