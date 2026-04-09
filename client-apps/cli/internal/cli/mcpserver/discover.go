package mcpserver

import (
	"context"
	"os"
	"strings"
	"time"

	"github.com/pkg/errors"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/backend/libs/go/mcpdiscovery"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// DiscoverOptions configures an MCP server capability discovery run.
type DiscoverOptions struct {
	Conn    grpc.ClientConnInterface
	Cfg     *config.Config
	OrgID   string
	Ref     string
	Timeout time.Duration
	DryRun  bool

	// EnvOverrides supplies KEY=VALUE pairs from --env flags.
	// These take highest priority over OS env and well-known var resolution.
	EnvOverrides []string
}

// DiscoverResult holds the outcome of a discovery run.
type DiscoverResult struct {
	McpServer    *mcpserverv1.McpServer
	Capabilities *mcpserverv1.DiscoveredCapabilities
	Updated      *mcpserverv1.McpServer // nil when DryRun is true
}

// Discover resolves credentials locally and delegates MCP discovery to the
// backend via the Connect RPC. The backend creates an ephemeral
// ExecutionContext, starts a Temporal workflow on the agent-runner to connect
// to the MCP server, and returns the updated McpServer with discovered
// capabilities and tool approval policies.
//
// For DryRun, local discovery is performed instead (capabilities are not
// persisted to the backend).
func Discover(ctx context.Context, opts *DiscoverOptions) (*DiscoverResult, error) {
	if opts.Timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, opts.Timeout)
		defer cancel()
	}

	server, err := GetFromBackend(opts.Conn, opts.OrgID, opts.Ref)
	if err != nil {
		return nil, err
	}

	result := &DiscoverResult{McpServer: server}

	if !opts.DryRun {
		runtimeEnv := buildRuntimeEnv(server, opts.Cfg, opts.EnvOverrides)
		updated, err := callConnect(ctx, opts.Conn, server.Metadata.Id, runtimeEnv)
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

// DiscoverServer resolves credentials and calls the Connect RPC for an
// already-fetched MCP server. Used by the bootstrap auto-discovery flow
// and post-apply discovery which already have the McpServer proto in hand.
func DiscoverServer(ctx context.Context, conn grpc.ClientConnInterface, server *mcpserverv1.McpServer, cfg *config.Config, timeout time.Duration) error {
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	runtimeEnv := buildRuntimeEnv(server, cfg, nil)
	_, err := callConnect(ctx, conn, server.Metadata.Id, runtimeEnv)
	return err
}

// callConnect invokes the Connect RPC with the given runtime_env.
func callConnect(
	ctx context.Context,
	conn grpc.ClientConnInterface,
	mcpServerID string,
	runtimeEnv map[string]*executioncontextv1.ExecutionValue,
) (*mcpserverv1.McpServer, error) {
	client := mcpserverv1.NewMcpServerCommandControllerClient(conn)
	input := &mcpserverv1.ConnectInput{
		McpServerId: mcpServerID,
	}
	if len(runtimeEnv) > 0 {
		input.RuntimeEnv = runtimeEnv
	}
	result, err := client.Connect(ctx, input)
	if err != nil {
		return nil, errors.Wrap(err, "connect failed")
	}
	return result, nil
}

// buildRuntimeEnv constructs the runtime_env map for the Connect RPC from
// three sources (lowest to highest priority):
//  1. Well-known vars resolved from CLI config (credential stores, gh CLI, etc.)
//  2. OS environment variables
//  3. Explicit --env flag overrides
//
// Only keys declared in the MCP server's env_spec are included (plus any
// extra keys from envOverrides).
func buildRuntimeEnv(
	server *mcpserverv1.McpServer,
	cfg *config.Config,
	envOverrides []string,
) map[string]*executioncontextv1.ExecutionValue {
	envSpec := server.GetSpec().GetEnvSpec().GetData()

	overrideMap := parseEnvOverrides(envOverrides)

	allKeys := make(map[string]bool, len(envSpec)+len(overrideMap))
	for k := range envSpec {
		allKeys[k] = true
	}
	for k := range overrideMap {
		allKeys[k] = true
	}

	if len(allKeys) == 0 {
		return nil
	}

	result := make(map[string]*executioncontextv1.ExecutionValue, len(allKeys))

	requiredVars := make(map[string]bool, len(envSpec))
	for k := range envSpec {
		requiredVars[k] = true
	}
	if cfg != nil {
		for k, v := range ResolveWellKnownEnvScoped(cfg, requiredVars) {
			result[k] = v
		}
	}

	for key, envVal := range envSpec {
		if val := os.Getenv(key); val != "" {
			result[key] = &executioncontextv1.ExecutionValue{
				Value:    val,
				IsSecret: envVal.GetIsSecret(),
			}
		}
	}

	for key, val := range overrideMap {
		isSecret := false
		if spec, ok := envSpec[key]; ok {
			isSecret = spec.GetIsSecret()
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
	caps.LastDiscoveredAt = timestamppb.Now()
	return caps, nil
}
