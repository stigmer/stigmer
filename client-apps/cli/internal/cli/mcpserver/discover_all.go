package mcpserver

import (
	"context"
	"time"

	"github.com/rs/zerolog/log"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/rpc"
	searchv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/search/v1"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"google.golang.org/grpc"
)

// DiscoverAllOptions configures the bootstrap auto-discovery flow.
type DiscoverAllOptions struct {
	Conn    grpc.ClientConnInterface
	Cfg     *config.Config
	OrgID   string
	Timeout time.Duration
}

// DiscoverAllResult summarises a bulk discovery run.
type DiscoverAllResult struct {
	Attempted int
	Succeeded int
	Skipped   int
}

// DiscoverAll lists all MCP servers accessible to the caller, then discovers
// capabilities for each one that uses a stdio transport. This is the bootstrap
// auto-discovery entry point invoked after the daemon starts.
//
// Discovery is best-effort: a failure for one server is logged but does not
// prevent discovery of the remaining servers or block the caller.
func DiscoverAll(ctx context.Context, opts *DiscoverAllOptions) *DiscoverAllResult {
	result := &DiscoverAllResult{}

	servers, err := listMcpServers(ctx, opts.Conn, opts.OrgID)
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

		result.Attempted++

		envOverrides := ResolveEnvForDiscovery(server, opts.Cfg)

		if err := DiscoverServer(ctx, opts.Conn, server, envOverrides, opts.Timeout); err != nil {
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

// listMcpServers fetches all MCP servers for the given org. Since there is no
// dedicated List RPC, we use the search API to enumerate MCP server slugs and
// then fetch each full McpServer proto via GetByReference.
func listMcpServers(ctx context.Context, conn grpc.ClientConnInterface, orgID string) ([]*mcpserverv1.McpServer, error) {
	searchClient := searchv1.NewSearchServiceClient(conn)
	resp, err := searchClient.Search(ctx, &searchv1.SearchRequest{
		Kinds: []apiresourcekind.ApiResourceKind{apiresourcekind.ApiResourceKind_mcp_server},
		Org:   orgID,
		Page:  &rpc.PageInfo{Num: 1, Size: 100},
	})
	if err != nil {
		return nil, err
	}

	if len(resp.GetEntries()) == 0 {
		return nil, nil
	}

	queryClient := mcpserverv1.NewMcpServerQueryControllerClient(conn)
	servers := make([]*mcpserverv1.McpServer, 0, len(resp.GetEntries()))

	for _, entry := range resp.GetEntries() {
		server, err := queryClient.GetByReference(ctx, &apiresource.ApiResourceReference{
			Org:  orgID,
			Kind: apiresourcekind.ApiResourceKind_mcp_server,
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
