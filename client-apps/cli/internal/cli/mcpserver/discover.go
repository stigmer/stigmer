package mcpserver

import (
	"context"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// DiscoverOptions configures an MCP server capability discovery run.
type DiscoverOptions struct {
	Conn    grpc.ClientConnInterface
	OrgID   string
	Ref     string
	Timeout time.Duration
	DryRun  bool
}

// DiscoverResult holds the outcome of a discovery run.
type DiscoverResult struct {
	McpServer    *mcpserverv1.McpServer
	Capabilities *mcpserverv1.DiscoveredCapabilities
	Updated      *mcpserverv1.McpServer // nil when DryRun is true
}

// Discover connects to an MCP server, queries its tools and resource templates,
// and pushes the results to stigmer-server via updateDiscoveredCapabilities.
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

	capabilities, err := discoverCapabilities(ctx, server)
	if err != nil {
		return nil, err
	}

	result := &DiscoverResult{
		McpServer:    server,
		Capabilities: capabilities,
	}

	if !opts.DryRun {
		updated, err := pushCapabilities(ctx, opts.Conn, server.Metadata.Id, capabilities)
		if err != nil {
			return nil, err
		}
		result.Updated = updated
	}

	return result, nil
}

// discoverCapabilities spawns/connects to the MCP server and lists its tools
// and resource templates.
func discoverCapabilities(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.DiscoveredCapabilities, error) {
	transport, err := createTransport(server.Spec)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create MCP transport")
	}

	client := mcp.NewClient(
		&mcp.Implementation{Name: "stigmer-cli", Version: "1.0.0"},
		nil,
	)

	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to connect to MCP server '%s'", server.Metadata.Name)
	}
	defer session.Close()

	tools, err := listAllTools(ctx, session)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list tools")
	}

	templates, err := listAllResourceTemplates(ctx, session)
	if err != nil {
		return nil, errors.Wrap(err, "failed to list resource templates")
	}

	return &mcpserverv1.DiscoveredCapabilities{
		Tools:             convertTools(tools),
		ResourceTemplates: convertResourceTemplates(templates),
		LastDiscoveredAt:  timestamppb.Now(),
		DiscoveredBy:      mcpserverv1.DiscoverySource_cli,
	}, nil
}

// listAllTools collects all tools across paginated responses.
func listAllTools(ctx context.Context, session *mcp.ClientSession) ([]*mcp.Tool, error) {
	var all []*mcp.Tool
	for tool, err := range session.Tools(ctx, nil) {
		if err != nil {
			return nil, err
		}
		all = append(all, tool)
	}
	return all, nil
}

// listAllResourceTemplates collects all resource templates across paginated responses.
func listAllResourceTemplates(ctx context.Context, session *mcp.ClientSession) ([]*mcp.ResourceTemplate, error) {
	var all []*mcp.ResourceTemplate
	for tmpl, err := range session.ResourceTemplates(ctx, nil) {
		if err != nil {
			return nil, err
		}
		all = append(all, tmpl)
	}
	return all, nil
}

// pushCapabilities sends the discovered capabilities to stigmer-server.
func pushCapabilities(
	ctx context.Context,
	conn grpc.ClientConnInterface,
	mcpServerID string,
	capabilities *mcpserverv1.DiscoveredCapabilities,
) (*mcpserverv1.McpServer, error) {
	client := mcpserverv1.NewMcpServerCommandControllerClient(conn)
	result, err := client.UpdateDiscoveredCapabilities(ctx, &mcpserverv1.UpdateDiscoveredCapabilitiesInput{
		McpServerId:            mcpServerID,
		DiscoveredCapabilities: capabilities,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to push discovered capabilities to backend")
	}
	return result, nil
}
