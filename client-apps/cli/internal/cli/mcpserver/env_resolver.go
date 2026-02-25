package mcpserver

import (
	"fmt"
	"os"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

// ResolveEnvForDiscovery builds a list of KEY=VALUE environment overrides
// needed to spawn an MCP server for capability discovery.
//
// For each variable declared in the server's env_spec, this function checks
// whether the variable is already present in os.Environ(). If it is, we
// leave it alone (the user's shell takes priority). If not, we attempt to
// resolve it from the CLI configuration or well-known local credential stores.
//
// Currently supported variables:
//
//   - STIGMER_SERVER_ADDRESS — resolved from the CLI's backend configuration.
//     Local backend: "localhost:7234". Cloud backend: the configured endpoint.
//
//   - STIGMER_API_KEY — resolved from the CLI's backend configuration.
//     Local backend: empty (no auth required). Cloud backend: the stored token.
//
// To add support for a new MCP server's credentials (e.g. GITHUB_TOKEN for a
// GitHub MCP server), add a case to the switch statement below that reads
// from the appropriate well-known source.
func ResolveEnvForDiscovery(server *mcpserverv1.McpServer, cfg *config.Config) []string {
	envSpec := server.GetSpec().GetEnvSpec().GetData()
	if len(envSpec) == 0 {
		return nil
	}

	var overrides []string
	for name := range envSpec {
		if os.Getenv(name) != "" {
			continue
		}

		if val, ok := resolveKnownVar(name, cfg); ok {
			overrides = append(overrides, fmt.Sprintf("%s=%s", name, val))
		}
	}

	return overrides
}

// resolveKnownVar attempts to resolve a single environment variable from
// well-known local sources. Returns the resolved value and true, or empty
// string and false if the variable is not recognised or cannot be resolved.
func resolveKnownVar(name string, cfg *config.Config) (string, bool) {
	switch name {
	case "STIGMER_SERVER_ADDRESS":
		return resolveStigmerServerAddress(cfg), true

	case "STIGMER_API_KEY":
		val := resolveStigmerAPIKey(cfg)
		if val == "" {
			return "", false
		}
		return val, true

	default:
		return "", false
	}
}

// resolveStigmerServerAddress determines the gRPC address of the running
// stigmer-server instance based on the CLI configuration. This mirrors the
// logic in applyCLIConfig() from the mcp-server command.
func resolveStigmerServerAddress(cfg *config.Config) string {
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		return "localhost:7234"

	case config.BackendTypeCloud:
		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.Endpoint != "" {
			return cfg.Backend.Cloud.Endpoint
		}
		return "api.stigmer.ai:443"

	default:
		return "localhost:7234"
	}
}

// resolveStigmerAPIKey returns the API key / auth token for the configured
// backend. Local backends don't require authentication, so an empty string
// is returned. For cloud backends, the stored token from 'stigmer login' is
// used.
func resolveStigmerAPIKey(cfg *config.Config) string {
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		return ""

	case config.BackendTypeCloud:
		if cfg.Backend.Cloud != nil {
			return cfg.Backend.Cloud.Token
		}
		return ""

	default:
		return ""
	}
}
