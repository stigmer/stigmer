package mcpserver

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"gopkg.in/yaml.v3"
)

// EnvResolutionResult contains the outcome of resolving environment variables
// for an MCP server. Overrides are KEY=VALUE pairs for variables that were
// successfully resolved. Unresolved lists variable names that are declared in
// env_spec but could not be resolved from any local source.
type EnvResolutionResult struct {
	Overrides  []string
	Unresolved []string
}

// ResolveEnvForDiscovery builds a list of KEY=VALUE environment overrides
// needed to spawn an MCP server for capability discovery.
//
// For each variable declared in the server's env_spec, this function checks
// whether the variable is already present in os.Environ(). If it is, we
// leave it alone (the user's shell takes priority). If not, we attempt to
// resolve it from the CLI configuration or well-known local credential stores.
//
// Supported variables:
//
//   - STIGMER_SERVER_ADDRESS — resolved from the CLI's backend configuration.
//   - STIGMER_API_KEY — resolved from the CLI's backend configuration.
//   - GITHUB_TOKEN — resolved by running `gh auth token` (reads from OS keychain).
//   - PLANTON_API_KEY — resolved from ~/.planton/credentials/{env}/token.json.
func ResolveEnvForDiscovery(server *mcpserverv1.McpServer, cfg *config.Config) *EnvResolutionResult {
	envSpec := server.GetSpec().GetEnvSpec().GetData()
	if len(envSpec) == 0 {
		return &EnvResolutionResult{}
	}

	result := &EnvResolutionResult{}
	for name := range envSpec {
		if os.Getenv(name) != "" {
			continue
		}

		if val, ok := resolveKnownVar(name, cfg); ok {
			result.Overrides = append(result.Overrides, fmt.Sprintf("%s=%s", name, val))
		} else {
			result.Unresolved = append(result.Unresolved, name)
		}
	}

	return result
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

	case "GITHUB_TOKEN":
		return resolveGithubToken()

	case "PLANTON_API_KEY":
		return resolvePlantonAPIKey()

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

// resolveGithubToken retrieves the GitHub OAuth token by running `gh auth token`.
// Modern gh CLI versions store tokens in the OS keychain rather than in plain-text
// config files, so a subprocess call is the only reliable cross-platform method.
// Returns ("", false) if gh is not installed or the user is not authenticated.
func resolveGithubToken() (string, bool) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	out, err := exec.CommandContext(ctx, "gh", "auth", "token").Output()
	if err != nil {
		return "", false
	}

	token := strings.TrimSpace(string(out))
	if token == "" {
		return "", false
	}
	return token, true
}

// resolvePlantonAPIKey reads the Planton CLI's stored OAuth access token from
// the local credential store (~/.planton/credentials/{env}/token.json).
//
// Environment resolution: reads current_environment from ~/.planton/config.yaml.
// If the config file does not exist, defaults to "production".
func resolvePlantonAPIKey() (string, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", false
	}

	env := resolvePlantonEnvironment(filepath.Join(home, ".planton", "config.yaml"))

	tokenPath := filepath.Join(home, ".planton", "credentials", env, "token.json")
	data, err := os.ReadFile(tokenPath)
	if err != nil {
		return "", false
	}

	var tokenFile struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(data, &tokenFile); err != nil {
		return "", false
	}
	if tokenFile.AccessToken == "" {
		return "", false
	}
	return tokenFile.AccessToken, true
}

// resolvePlantonEnvironment reads the current environment name from the
// Planton CLI config file. Returns "production" if the file is missing,
// unreadable, or does not specify a current environment.
func resolvePlantonEnvironment(configPath string) string {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return "production"
	}

	var cfg struct {
		CurrentEnvironment string `yaml:"current_environment"`
	}
	if err := yaml.Unmarshal(data, &cfg); err != nil || cfg.CurrentEnvironment == "" {
		return "production"
	}
	return cfg.CurrentEnvironment
}
