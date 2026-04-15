package mcpserver

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog/log"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
)

// ConnectAllOptions configures the bootstrap auto-connect flow.
type ConnectAllOptions struct {
	Client  *stigmer.Client
	OrgID   string
	Timeout time.Duration
}

// ConnectAllResult summarises a bulk connect run.
type ConnectAllResult struct {
	Attempted int
	Succeeded int
	Skipped   int
	// SkipMessages contains user-facing hints for servers whose discovery
	// was skipped due to missing credentials.
	SkipMessages []string
}

// ConnectAll lists all MCP servers accessible to the caller, then connects
// to each one that uses a stdio transport to discover capabilities. This is
// the bootstrap auto-connect entry point invoked after the daemon starts.
//
// Connection is best-effort: a failure for one server is logged but does not
// prevent connection of the remaining servers or block the caller.
func ConnectAll(ctx context.Context, opts *ConnectAllOptions) *ConnectAllResult {
	result := &ConnectAllResult{}

	servers, err := listMcpServers(ctx, opts.Client, opts.OrgID)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to list MCP servers for discovery")
		return result
	}

	if len(servers) == 0 {
		log.Debug().Msg("No MCP servers found, skipping discovery")
		return result
	}

	for _, server := range servers {
		if server.Spec.GetStdio() == nil {
			log.Debug().
				Str("mcp_server", server.Metadata.GetName()).
				Msg("Skipping non-stdio MCP server for local discovery")
			result.Skipped++
			continue
		}

		missing := missingSecretEnvVars(server)
		if len(missing) > 0 {
			msg := FormatConnectSkipMessage(server.Metadata.GetName(), missing)
			result.SkipMessages = append(result.SkipMessages, msg)
			result.Skipped++
			log.Debug().
				Str("mcp_server", server.Metadata.GetName()).
				Strs("unresolved", missing).
				Msg("Skipping discovery: required credentials not in environment")
			continue
		}

		result.Attempted++

		if err := ConnectServer(ctx, opts.Client, server, opts.Timeout); err != nil {
			log.Warn().
				Err(err).
				Str("mcp_server", server.Metadata.GetName()).
				Msg("Discovery failed for MCP server (best-effort, continuing)")
			continue
		}

		result.Succeeded++
		log.Info().
			Str("mcp_server", server.Metadata.GetName()).
			Msg("Discovered MCP server capabilities")
	}

	return result
}

// FormatConnectSkipMessage builds a user-facing message explaining that
// connection was skipped for a server because required credentials (secret
// env vars) are not in the environment. The message includes a copy-paste
// stigmer connect command so the user can connect manually.
func FormatConnectSkipMessage(serverName string, unresolved []string) string {
	envPrefix := strings.Join(unresolved, "=<value> ") + "=<value>"
	return fmt.Sprintf(
		"Connect skipped for %s: %s not available\n  To connect manually:\n    %s stigmer connect mcp-server %s",
		serverName,
		strings.Join(unresolved, ", "),
		envPrefix,
		serverName,
	)
}

// ConnectOne runs connection and discovery for a single MCP server. This is
// the post-apply entry point: after an MCP server is registered via stigmer
// apply, we immediately attempt to connect and discover its capabilities so
// they are available without requiring a daemon restart.
//
// Returns nil if connection succeeds or if the server is skipped (non-stdio,
// missing env vars). The skipMessage return value is non-empty when connection
// was skipped due to missing credentials.
func ConnectOne(ctx context.Context, opts *ConnectOneOptions) (skipMessage string, err error) {
	server := opts.Server

	if server.Spec.GetStdio() == nil {
		return "", nil
	}

	missing := missingSecretEnvVars(server)
	if len(missing) > 0 {
		return FormatConnectSkipMessage(server.Metadata.GetName(), missing), nil
	}

	if err := ConnectServer(ctx, opts.Client, server, opts.Timeout); err != nil {
		return "", err
	}

	return "", nil
}

// ConnectOneOptions configures a single-server post-apply connect.
type ConnectOneOptions struct {
	Client  *stigmer.Client
	Server  *mcpserverv1.McpServer
	Timeout time.Duration
}

// missingSecretEnvVars returns the names of secret env vars declared by the
// server that are not present in the current OS environment.
func missingSecretEnvVars(server *mcpserverv1.McpServer) []string {
	var missing []string
	for name, decl := range server.GetSpec().GetEnv() {
		if decl.GetIsSecret() && os.Getenv(name) == "" {
			missing = append(missing, name)
		}
	}
	return missing
}

// listMcpServers fetches all MCP servers for the given org using the SDK's
// search-based List method and then fetches each full McpServer proto via
// GetByReference.
func listMcpServers(ctx context.Context, client *stigmer.Client, orgID string) ([]*mcpserverv1.McpServer, error) {
	listResult, err := client.McpServer.List(ctx, &stigmer.ListParams{
		Org:  orgID,
		Page: &stigmer.Page{Num: 1, Size: 100},
	})
	if err != nil {
		return nil, err
	}

	if len(listResult.Entries) == 0 {
		return nil, nil
	}

	servers := make([]*mcpserverv1.McpServer, 0, len(listResult.Entries))

	for _, entry := range listResult.Entries {
		server, err := client.McpServer.GetByReference(ctx, stigmer.ResourceRef{
			Org:  orgID,
			Slug: entry.GetSlug(),
		})
		if err != nil {
			log.Warn().
				Err(err).
				Str("slug", entry.GetSlug()).
				Str("org", orgID).
				Msg("Failed to fetch MCP server by reference, skipping")
			continue
		}
		servers = append(servers, server)
	}

	return servers, nil
}
