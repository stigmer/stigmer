package mcpserver

import (
	"context"
	"time"

	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/backend/libs/go/mcpdiscovery"
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

	// EnvOverrides supplies KEY=VALUE pairs merged on top of os.Environ()
	// for stdio transports. Used to inject resolved credentials (e.g.
	// STIGMER_SERVER_ADDRESS) that aren't set in the current shell.
	EnvOverrides []string
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

	capabilities, err := discoverCapabilities(ctx, server, opts.EnvOverrides)
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

// DiscoverServer connects to an already-fetched MCP server, discovers its
// capabilities, and pushes the results. This is used by the bootstrap
// auto-discovery flow which already has the McpServer proto in hand.
func DiscoverServer(ctx context.Context, conn grpc.ClientConnInterface, server *mcpserverv1.McpServer, envOverrides []string, timeout time.Duration) error {
	if timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, timeout)
		defer cancel()
	}

	capabilities, err := discoverCapabilities(ctx, server, envOverrides)
	if err != nil {
		return err
	}

	_, err = pushCapabilities(ctx, conn, server.Metadata.Id, capabilities)
	return err
}

// discoverCapabilities delegates to the shared mcpdiscovery library.
func discoverCapabilities(ctx context.Context, server *mcpserverv1.McpServer, envOverrides []string) (*mcpserverv1.DiscoveredCapabilities, error) {
	caps, err := mcpdiscovery.Discover(ctx, server.Spec, envOverrides, mcpserverv1.DiscoverySource_cli)
	if err != nil {
		return nil, errors.Wrapf(err, "discovery failed for MCP server '%s'", server.Metadata.Name)
	}

	// Stamp with current time (shared library already does this, but
	// normalise to the caller's clock just in case).
	caps.LastDiscoveredAt = timestamppb.Now()
	return caps, nil
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
