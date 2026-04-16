package mcpserver

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/mcpdiscovery"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	executioncontextv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
)

// ConnectOptions configures an MCP server capability discovery run.
type ConnectOptions struct {
	Client  *stigmer.Client
	Cfg     *config.Config
	OrgID   string
	Ref     string
	Timeout time.Duration
	DryRun  bool

	// EnvOverrides supplies KEY=VALUE pairs from --env flags.
	// These take priority over OS environment variables.
	EnvOverrides []string
}

// ConnectResult holds the outcome of a connect + discovery run.
type ConnectResult struct {
	McpServer    *mcpserverv1.McpServer
	Capabilities *mcpserverv1.DiscoveredCapabilities
	Updated      *mcpserverv1.McpServer // nil when DryRun is true
}

// Connect delegates MCP discovery to the backend via the Connect RPC. The
// backend creates an ephemeral ExecutionContext, starts a Temporal workflow
// on the agent-runner to connect to the MCP server, and returns the updated
// McpServer with discovered capabilities and tool approval policies.
//
// Environment variables are resolved from two sources (lowest to highest
// priority): OS environment variables, then explicit --env flag overrides.
//
// For DryRun, local discovery is performed instead (capabilities are not
// persisted to the backend).
func Connect(ctx context.Context, opts *ConnectOptions) (*ConnectResult, error) {
	if opts.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, opts.Timeout)
		defer cancel()
	}

	server, err := GetFromBackend(opts.Client, opts.OrgID, opts.Ref)
	if err != nil {
		return nil, err
	}

	result := &ConnectResult{McpServer: server}

	if !opts.DryRun && CheckOAuthRequired(server) && len(opts.EnvOverrides) == 0 {
		hasGrant, err := CheckOAuthGrantExists(ctx, opts.Client, server.Metadata.GetId(), opts.OrgID)
		if err != nil {
			return nil, err
		}
		if !hasGrant {
			if err := RunOAuthFlow(ctx, opts.Client, server, opts.OrgID, opts.Cfg); err != nil {
				return nil, err
			}
		}
	}

	if !opts.DryRun {
		runtimeEnv := buildRuntimeEnv(server, opts.EnvOverrides)
		updated, err := callConnect(ctx, opts.Client, server.Metadata.Id, runtimeEnv)
		if err != nil {
			return nil, err
		}
		result.Updated = updated
		result.Capabilities = updated.GetStatus().GetDiscoveredCapabilities()
	} else {
		caps, err := localDiscover(ctx, server, opts.EnvOverrides)
		if err != nil {
			return nil, err
		}
		result.Capabilities = caps
	}

	return result, nil
}

// ConnectServer calls the Connect RPC for an already-fetched MCP server.
// Used by the bootstrap auto-connect flow and post-apply connect which
// already have the McpServer proto in hand. Environment variables are
// resolved from the OS environment only.
func ConnectServer(ctx context.Context, client *stigmer.Client, server *mcpserverv1.McpServer, timeout time.Duration) error {
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	runtimeEnv := buildRuntimeEnv(server, nil)
	_, err := callConnect(ctx, client, server.Metadata.Id, runtimeEnv)
	return err
}

// callConnect invokes the Connect RPC with the given runtime_env.
func callConnect(
	ctx context.Context,
	client *stigmer.Client,
	mcpServerID string,
	runtimeEnv map[string]*executioncontextv1.ExecutionValue,
) (*mcpserverv1.McpServer, error) {
	input := &mcpserverv1.ConnectInput{
		McpServerId: mcpServerID,
	}
	if len(runtimeEnv) > 0 {
		input.RuntimeEnv = runtimeEnv
	}
	result, err := client.McpServer.Connect(ctx, input)
	if err != nil {
		return nil, errors.Wrap(err, "connect failed")
	}
	return result, nil
}

// buildRuntimeEnv constructs the runtime_env map for the Connect RPC from
// two sources (lowest to highest priority):
//  1. OS environment variables (for keys declared in the MCP server's env)
//  2. Explicit --env flag overrides
func buildRuntimeEnv(
	server *mcpserverv1.McpServer,
	envOverrides []string,
) map[string]*executioncontextv1.ExecutionValue {
	envDecls := server.GetSpec().GetEnv()
	overrideMap := parseEnvOverrides(envOverrides)

	allKeys := make(map[string]bool, len(envDecls)+len(overrideMap))
	for k := range envDecls {
		allKeys[k] = true
	}
	for k := range overrideMap {
		allKeys[k] = true
	}

	if len(allKeys) == 0 {
		return nil
	}

	result := make(map[string]*executioncontextv1.ExecutionValue, len(allKeys))

	for key, decl := range envDecls {
		if val := os.Getenv(key); val != "" {
			result[key] = &executioncontextv1.ExecutionValue{
				Value:    val,
				IsSecret: decl.GetIsSecret(),
			}
		}
	}

	for key, val := range overrideMap {
		isSecret := false
		if decl, ok := envDecls[key]; ok {
			isSecret = decl.GetIsSecret()
		}
		result[key] = &executioncontextv1.ExecutionValue{
			Value:    val,
			IsSecret: isSecret,
		}
	}

	return result
}

// parseEnvOverrides parses KEY=VALUE strings into a map.
func parseEnvOverrides(overrides []string) map[string]string {
	m := make(map[string]string, len(overrides))
	for _, kv := range overrides {
		parts := strings.SplitN(kv, "=", 2)
		if len(parts) == 2 {
			m[parts[0]] = parts[1]
		}
	}
	return m
}

// localDiscover performs local MCP discovery (without persisting to backend).
// Used for --dry-run to preview capabilities.
func localDiscover(ctx context.Context, server *mcpserverv1.McpServer, envOverrides []string) (*mcpserverv1.DiscoveredCapabilities, error) {
	caps, err := mcpdiscovery.Discover(ctx, server.Spec, envOverrides)
	if err != nil {
		return nil, errors.Wrapf(err, "discovery failed for MCP server '%s'", server.Metadata.Name)
	}
	return caps, nil
}
