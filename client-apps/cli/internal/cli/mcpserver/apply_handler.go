package mcpserver

import (
	"context"
	"fmt"

	"github.com/pkg/errors"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/applier"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/clioutput"
	"google.golang.org/grpc"
	"google.golang.org/protobuf/proto"
)

type applyHandler struct{}

// NewApplyHandler returns an ApplyHandler for McpServer resources.
func NewApplyHandler() applier.ApplyHandler { return &applyHandler{} }

func (h *applyHandler) Kind() apiresourcekind.ApiResourceKind {
	return apiresourcekind.ApiResourceKind_mcp_server
}

func (h *applyHandler) LoadFromBytes(raw []byte) (proto.Message, error) {
	result, err := LoadFromBytes(raw)
	if err != nil {
		return nil, errors.Wrap(err, "failed to load MCP server")
	}
	return result.McpServer, nil
}

// Validate is a no-op: structural validation (apiVersion, kind, metadata,
// spec transport) already runs inside the loader's parseContent.
func (h *applyHandler) Validate(proto.Message) error { return nil }

func (h *applyHandler) Metadata(msg proto.Message) *apiresource.ApiResourceMetadata {
	return msg.(*mcpserverv1.McpServer).Metadata
}

func (h *applyHandler) Apply(ctx context.Context, conn grpc.ClientConnInterface, msg proto.Message) (*applier.ApplyResult, error) {
	mcp := msg.(*mcpserverv1.McpServer)

	if mcp.Metadata == nil {
		mcp.Metadata = &apiresource.ApiResourceMetadata{}
	}

	isCreate := mcp.Metadata.Id == ""

	client := mcpserverv1.NewMcpServerCommandControllerClient(conn)
	result, err := client.Apply(ctx, mcp)
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply MCP server")
	}

	return &applier.ApplyResult{
		Resource: result,
		Created:  isCreate,
	}, nil
}

func (h *applyHandler) BuildDryRunResult(msg proto.Message) *clioutput.CommandResult {
	mcp := msg.(*mcpserverv1.McpServer)
	out := clioutput.Success("Dry run: %s is valid", mcp.Metadata.Name)
	sec := out.AddSection("MCP Server Preview")
	sec.Field("Name", mcp.Metadata.Name)
	if mcp.Spec.Description != "" {
		sec.Field("Description", mcp.Spec.Description)
	}
	if stdio := mcp.Spec.GetStdio(); stdio != nil {
		sec.Field("Type", "stdio")
		sec.Field("Command", stdio.Command)
		if len(stdio.Args) > 0 {
			sec.Field("Args", fmt.Sprintf("%v", stdio.Args))
		}
	} else if http := mcp.Spec.GetHttp(); http != nil {
		sec.Field("Type", "http")
		sec.Field("URL", http.Url)
	}
	if len(mcp.Spec.Tags) > 0 {
		sec.Field("Tags", fmt.Sprintf("%v", mcp.Spec.Tags))
	}
	return out
}

func (h *applyHandler) BuildApplyResult(msg proto.Message, created bool) *clioutput.CommandResult {
	mcp := msg.(*mcpserverv1.McpServer)
	action := "updated"
	if created {
		action = "created"
	}
	out := clioutput.Success("MCP server %s successfully", action)
	out.AddSection("Resource Details").
		Field("ID", mcp.Metadata.Id).
		Field("Name", mcp.Metadata.Name).
		Field("Slug", mcp.Metadata.Slug)
	out.Hintf("View details: stigmer get mcpserver %s", mcp.Metadata.Slug)
	out.Hintf("Delete:       stigmer delete mcpserver %s", mcp.Metadata.Slug)
	return out
}

func init() {
	var _ applier.ApplyHandler = (*applyHandler)(nil)
}
