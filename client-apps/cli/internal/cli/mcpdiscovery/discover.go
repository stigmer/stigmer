package mcpdiscovery

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
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
) (*mcpserverv1.DiscoveredCapabilities, error) {
	var stderrBuf bytes.Buffer
	transport, err := CreateTransport(spec, envOverrides, &stderrBuf)
	if err != nil {
		return nil, errors.Wrap(err, "failed to create MCP transport")
	}

	client := mcp.NewClient(
		&mcp.Implementation{Name: "stigmer-cli", Version: "1.0.0"},
		nil,
	)

	session, err := client.Connect(ctx, transport, nil)
	if err != nil {
		return nil, withStderr(errors.Wrap(err, "failed to connect to MCP server"), &stderrBuf)
	}
	defer session.Close()

	tools, err := listAllTools(ctx, session)
	if err != nil {
		return nil, withStderr(errors.Wrap(err, "failed to list tools"), &stderrBuf)
	}

	var templates []*mcp.ResourceTemplate
	if caps := session.InitializeResult().Capabilities; caps != nil && caps.Resources != nil {
		templates, err = listAllResourceTemplates(ctx, session)
		if err != nil {
			return nil, withStderr(errors.Wrap(err, "failed to list resource templates"), &stderrBuf)
		}
	}

	return &mcpserverv1.DiscoveredCapabilities{
		Tools:             ConvertTools(tools),
		ResourceTemplates: ConvertResourceTemplates(templates),
		LastDiscoveredAt:  timestamppb.Now(),
	}, nil
}

// withStderr appends captured subprocess stderr to an error message when
// stderr contains useful output. This gives callers diagnostic context
// (e.g. Go toolchain errors, config failures) without ever printing raw
// subprocess output to the user's terminal.
func withStderr(err error, buf *bytes.Buffer) error {
	output := strings.TrimSpace(buf.String())
	if output == "" {
		return err
	}
	return fmt.Errorf("%w\nsubprocess stderr:\n%s", err, output)
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
