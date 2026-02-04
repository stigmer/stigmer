package mcpserver

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
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
			cliprint.PrintInfo("Dry run mode - configuration is valid")
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
			cliprint.PrintInfo("Creating MCP server: %s", opts.McpServer.Metadata.Name)
		} else {
			cliprint.PrintInfo("Updating MCP server: %s", opts.McpServer.Metadata.Name)
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
	cliprint.PrintInfo("MCP Server Configuration:")
	cliprint.PrintInfo("  Name:        %s", mcpServer.Metadata.Name)

	if mcpServer.Spec.Description != "" {
		cliprint.PrintInfo("  Description: %s", mcpServer.Spec.Description)
	}

	// Display server type
	if stdio := mcpServer.Spec.GetStdio(); stdio != nil {
		cliprint.PrintInfo("  Type:        stdio")
		cliprint.PrintInfo("  Command:     %s", stdio.Command)
		if len(stdio.Args) > 0 {
			cliprint.PrintInfo("  Args:        %v", stdio.Args)
		}
	} else if http := mcpServer.Spec.GetHttp(); http != nil {
		cliprint.PrintInfo("  Type:        http")
		cliprint.PrintInfo("  URL:         %s", http.Url)
	}

	if len(mcpServer.Spec.Tags) > 0 {
		cliprint.PrintInfo("  Tags:        %v", mcpServer.Spec.Tags)
	}

	fmt.Println()
}

// DisplayApplyResult displays the result of an apply operation
func DisplayApplyResult(result *ApplyResult) {
	fmt.Println()
	if result.Created {
		cliprint.PrintSuccess("MCP server created successfully")
	} else {
		cliprint.PrintSuccess("MCP server updated successfully")
	}

	fmt.Println()
	cliprint.PrintInfo("Resource Details:")
	cliprint.PrintInfo("  ID:   %s", result.McpServer.Metadata.Id)
	cliprint.PrintInfo("  Name: %s", result.McpServer.Metadata.Name)
	cliprint.PrintInfo("  Slug: %s", result.McpServer.Metadata.Slug)

	fmt.Println()
	cliprint.PrintInfo("Next steps:")
	cliprint.PrintInfo("  - View details:  stigmer mcpserver get %s", result.McpServer.Metadata.Slug)
	cliprint.PrintInfo("  - Delete:        stigmer mcpserver delete %s", result.McpServer.Metadata.Slug)
	fmt.Println()
}
