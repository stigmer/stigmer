package mcpserver

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	"google.golang.org/grpc"
)

// ApplyOptions contains options for applying an MCP server configuration
type ApplyOptions struct {
	// McpServer is the MCP server proto to apply
	McpServer *mcpserverv1.McpServer
	// OrgID is the organization ID for the resource
	OrgID string
	// Conn is the gRPC connection to the backend
	Conn grpc.ClientConnInterface
	// Quiet suppresses detailed output
	Quiet bool
	// DryRun validates without applying
	DryRun bool
}

// ApplyResult contains the result of applying an MCP server configuration
type ApplyResult struct {
	// McpServer is the applied MCP server (from server response)
	McpServer *mcpserverv1.McpServer
	// Created is true if resource was created, false if updated
	Created bool
}

// Apply applies an MCP server configuration to the backend.
// It uses the Apply RPC which handles both create and update (idempotent).
func Apply(opts *ApplyOptions) (*ApplyResult, error) {
	if opts.McpServer == nil {
		return nil, fmt.Errorf("mcpServer is required")
	}

	if opts.Conn == nil {
		return nil, fmt.Errorf("connection is required")
	}

	// Ensure metadata exists and set organization
	if opts.McpServer.Metadata == nil {
		opts.McpServer.Metadata = &apiresource.ApiResourceMetadata{}
	}

	// Set organization if not already set
	if opts.McpServer.Metadata.Org == "" && opts.OrgID != "" {
		opts.McpServer.Metadata.Org = opts.OrgID
	}

	// Dry run - just validate and return
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

	// Check if resource exists to determine create vs update
	existingID := opts.McpServer.Metadata.Id
	isCreate := existingID == ""

	if !opts.Quiet {
		if isCreate {
			climsg.Info("Creating MCP server: %s", opts.McpServer.Metadata.Name)
		} else {
			climsg.Info("Updating MCP server: %s", opts.McpServer.Metadata.Name)
		}
	}

	// Call Apply RPC
	client := mcpserverv1.NewMcpServerCommandControllerClient(opts.Conn)
	result, err := client.Apply(context.Background(), opts.McpServer)
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

	// Display server type
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
