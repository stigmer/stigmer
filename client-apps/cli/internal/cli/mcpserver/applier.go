package mcpserver

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
)

// ApplyOptions contains options for applying an MCP server configuration
type ApplyOptions struct {
	McpServer *mcpserverv1.McpServer
	OrgID     string
	Client    *stigmer.Client
	Quiet     bool
	DryRun    bool
}

// ApplyResult contains the result of applying an MCP server configuration
type ApplyResult struct {
	McpServer *mcpserverv1.McpServer
	Created   bool
}

// Apply applies an MCP server configuration to the backend.
// It uses the Apply RPC which handles both create and update (idempotent).
func Apply(opts *ApplyOptions) (*ApplyResult, error) {
	if opts.McpServer == nil {
		return nil, fmt.Errorf("mcpServer is required")
	}

	if opts.Client == nil {
		return nil, fmt.Errorf("client is required")
	}

	if opts.McpServer.Metadata == nil {
		opts.McpServer.Metadata = &apiresource.ApiResourceMetadata{}
	}

	if opts.McpServer.Metadata.Org == "" && opts.OrgID != "" {
		opts.McpServer.Metadata.Org = opts.OrgID
	}

	if opts.DryRun {
		if !opts.Quiet {
			climsg.Info("Dry run mode - configuration is valid")
			displayMcpServerSummary(opts.McpServer)
		}
		return &ApplyResult{
			McpServer: opts.McpServer,
			Created:   false,
		}, nil
	}

	existingID := opts.McpServer.Metadata.Id
	isCreate := existingID == ""

	if !opts.Quiet {
		if isCreate {
			climsg.Info("Creating MCP server: %s", opts.McpServer.Metadata.Name)
		} else {
			climsg.Info("Updating MCP server: %s", opts.McpServer.Metadata.Name)
		}
	}

	result, err := opts.Client.McpServer.Apply(context.Background(), stigmer.McpServerInputFromProto(opts.McpServer))
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply MCP server")
	}

	return &ApplyResult{
		McpServer: result,
		Created:   isCreate,
	}, nil
}

// displayMcpServerSummary displays a summary of the MCP server configuration
func displayMcpServerSummary(mcpServer *mcpserverv1.McpServer) {
	fmt.Println()
	climsg.Info("MCP Server Configuration:")
	climsg.Info("  Name:        %s", mcpServer.Metadata.Name)

	if mcpServer.Spec.Description != "" {
		climsg.Info("  Description: %s", mcpServer.Spec.Description)
	}

	if stdio := mcpServer.Spec.GetStdio(); stdio != nil {
		climsg.Info("  Type:        stdio")
		climsg.Info("  Command:     %s", stdio.Command)
		if len(stdio.Args) > 0 {
			climsg.Info("  Args:        %v", stdio.Args)
		}
	} else if http := mcpServer.Spec.GetHttp(); http != nil {
		climsg.Info("  Type:        http")
		climsg.Info("  URL:         %s", http.Url)
	}

	if len(mcpServer.Spec.Tags) > 0 {
		climsg.Info("  Tags:        %v", mcpServer.Spec.Tags)
	}

	fmt.Println()
}
