package mcpdiscovery

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// Discover connects to an MCP server described by spec, lists its tools and
// resource templates, and returns them as a DiscoveredCapabilities proto.
//
// envOverrides supplies KEY=VALUE strings merged on top of the process
// environment for stdio transports (see CreateTransport).
//
// The caller must provide a context with an appropriate timeout; discovery
// of slow-starting servers (e.g. go run) may take tens of seconds on first
// invocation.
func Discover(
	ctx context.Context,
	spec *mcpserverv1.McpServerSpec,
	envOverrides []string,
	source mcpserverv1.DiscoverySource,
) (*mcpserverv1.DiscoveredCapabilities, error) {
	transport, err := CreateTransport(spec, envOverrides)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create MCP transport")
	}

	client := mcp.NewClient(
		&mcp.Implementation{Name: "stigmer-cli", Version: "1.0.0"},
		nil,
	)

	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, errors.Wrap(err, "failed to connect to MCP server")
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
		Tools:             ConvertTools(tools),
		ResourceTemplates: ConvertResourceTemplates(templates),
		LastDiscoveredAt:  timestamppb.Now(),
		DiscoveredBy:      source,
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

// listAllResourceTemplates collects all resource templates across paginated
// responses.
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
