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

	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/envfile"
	"gopkg.in/yaml.v3"
)

// wellKnownVars lists the environment variable names that can be resolved
// from local credential stores without user-provided flags. This is the
// single source of truth for both ResolveEnvForDiscovery and
// ResolveWellKnownEnv.
var wellKnownVars = []string{
	"STIGMER_SERVER_ADDRESS",
	"STIGMER_API_KEY",
	"GITHUB_TOKEN",
	"PLANTON_API_KEY",
	"PLANTON_CLOUD_ENVIRONMENT",
}

// secretVars is the set of well-known variables that contain credentials
// and must be marked as secrets (encrypted at rest, redacted in logs).
var secretVars = map[string]bool{
	"STIGMER_API_KEY": true,
	"GITHUB_TOKEN":    true,
	"PLANTON_API_KEY": true,
}

// EnvResolutionResult contains the outcome of resolving environment variables
// for an MCP server. Overrides are KEY=VALUE pairs for variables that were
// successfully resolved. Unresolved lists secret variable names that could not
// be resolved and block discovery (the server cannot authenticate without
// credentials). UnresolvedOptional lists non-secret variable names that could
// not be resolved but are non-blocking — the MCP server is expected to have
// sensible defaults for configuration variables like endpoints or environment
// selectors.
type EnvResolutionResult struct {
	Overrides          []string
	Unresolved         []string
	UnresolvedOptional []string
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
//   - PLANTON_CLOUD_ENVIRONMENT — resolved from ~/.planton/config.yaml (defaults to "production").
func ResolveEnvForDiscovery(server *mcpserverv1.McpServer, cfg *config.Config) *EnvResolutionResult {
	envDecls := server.GetSpec().GetEnv()
	if len(envDecls) == 0 {
		return &EnvResolutionResult{}
	}

	result := &EnvResolutionResult{}
	for name, decl := range envDecls {
		if os.Getenv(name) != "" {
			continue
		}

		if val, ok := resolveKnownVar(name, cfg); ok {
			result.Overrides = append(result.Overrides, fmt.Sprintf("%s=%s", name, val))
		} else if decl.GetIsSecret() {
			result.Unresolved = append(result.Unresolved, name)
		} else {
			result.UnresolvedOptional = append(result.UnresolvedOptional, name)
		}
	}

	return result
}

// ResolveWellKnownEnv resolves all well-known environment variables from
// local credential stores and CLI configuration, returning them as an
// envfile.EnvMap suitable for merging into runtime_env.
//
// Unlike ResolveEnvForDiscovery (which is scoped to a single MCP server's
// env_spec), this function resolves every well-known variable unconditionally.
// The caller is expected to merge the result as the LOWEST priority source
// so that user-provided --env/--secret flags and env files take precedence.
//
// Variables already present in os.Environ() are skipped (shell env wins).
// Variables that resolve to an empty value are also skipped — the backend
// enforces a non-empty constraint on every runtime_env entry, so adding a
// key with an empty value would fail proto validation (e.g. STIGMER_API_KEY
// is intentionally empty on local backends, which don't require auth).
// Credential values are marked with IsSecret: true so the backend encrypts
// them at rest and redacts them in logs.
func ResolveWellKnownEnv(cfg *config.Config) envfile.EnvMap {
	return resolveWellKnownEnvFiltered(cfg, nil)
}

// ResolveWellKnownEnvScoped resolves well-known environment variables, but
// only those that appear in requiredVars. This prevents injecting credentials
// into executions that don't need them (e.g. GITHUB_TOKEN into an agent
// whose env_spec only declares STIGMER_SERVER_ADDRESS).
//
// Semantics match ResolveWellKnownEnv: shell env wins, empty values are
// skipped, and credentials are marked as secrets.
func ResolveWellKnownEnvScoped(cfg *config.Config, requiredVars map[string]bool) envfile.EnvMap {
	return resolveWellKnownEnvFiltered(cfg, requiredVars)
}

// resolveWellKnownEnvFiltered is the shared implementation for both
// ResolveWellKnownEnv and ResolveWellKnownEnvScoped. When filter is nil,
// all well-known vars are resolved; when non-nil, only vars in the filter
// set are resolved.
func resolveWellKnownEnvFiltered(cfg *config.Config, filter map[string]bool) envfile.EnvMap {
	result := make(envfile.EnvMap)
	for _, name := range wellKnownVars {
		if filter != nil && !filter[name] {
			continue
		}
		if os.Getenv(name) != "" {
			continue
		}
		val, ok := resolveKnownVar(name, cfg)
		if !ok || val == "" {
			continue
		}
		result[name] = &executioncontextv1.ExecutionValue{
			Value:    val,
			IsSecret: isSecretVar(name),
		}
	}
	return result
}

// isSecretVar reports whether a well-known variable contains a credential
// that should be treated as a secret.
func isSecretVar(name string) bool {
	return secretVars[name]
}

// resolveKnownVar attempts to resolve a single environment variable from
// well-known local sources. Returns the resolved value and true, or empty
// string and false if the variable is not recognised or cannot be resolved.
func resolveKnownVar(name string, cfg *config.Config) (string, bool) {
	switch name {
	case "STIGMER_SERVER_ADDRESS":
		return resolveStigmerServerAddress(cfg), true

	case "STIGMER_API_KEY":
		return resolveStigmerAPIKey(cfg)

	case "GITHUB_TOKEN":
		return resolveGithubToken()

	case "PLANTON_API_KEY":
		return resolvePlantonAPIKey()

	case "PLANTON_CLOUD_ENVIRONMENT":
		return resolvePlantonCloudEnvironment()

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
// backend and whether the resolution succeeded.
//
// Local backends don't require authentication, so ("", true) is returned --
// the empty value is intentional, not a failure to resolve. For cloud
// backends, the stored token from 'stigmer login' is used; ("", false)
// indicates the user has not authenticated yet.
func resolveStigmerAPIKey(cfg *config.Config) (string, bool) {
	switch cfg.Backend.Type {
	case config.BackendTypeLocal:
		return "", true

	case config.BackendTypeCloud:
		if cfg.Backend.Cloud != nil && cfg.Backend.Cloud.Token != "" {
			return cfg.Backend.Cloud.Token, true
		}
		return "", false

	default:
		return "", true
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

// resolvePlantonCloudEnvironment returns the Planton Cloud environment name
// from ~/.planton/config.yaml. Defaults to "production" when the config is
// absent or incomplete. Always succeeds — a sensible default is available.
func resolvePlantonCloudEnvironment() (string, bool) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "production", true
	}
	return resolvePlantonEnvironment(filepath.Join(home, ".planton", "config.yaml")), true
}
