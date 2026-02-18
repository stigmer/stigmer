// Package skills provides the "get_skill" MCP tool backed by the
// SkillQueryController.getByReference RPC.
//
// Skills support versioning: the caller can optionally request a specific
// version by tag name (e.g. "stable") or exact SHA-256 hash. When the
// version is omitted, the latest version is returned.
package skills

import (
	"context"
	"fmt"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	stigmergrpc "github.com/stigmer/stigmer/mcp-server/internal/grpc"
)

// GetSkillInput defines the parameters for the "get_skill" tool.
type GetSkillInput struct {
	Org     string `json:"org"              jsonschema:"required,description=Organization slug that owns the skill."`
	Slug    string `json:"slug"             jsonschema:"required,description=Skill slug — unique identifier within the org."`
	Version string `json:"version,omitempty" jsonschema:"description=Version to retrieve: tag name (e.g. stable) or SHA-256 hash. Omit for latest."`
}

// Tool returns the MCP tool definition for registration.
func Tool() *mcp.Tool {
	return &mcp.Tool{
		Name: "get_skill",
		Description: "Get full details of a Stigmer skill by org and slug, optionally at a specific version. " +
			"Omit 'version' for the latest.",
	}
}

// Handler returns the typed tool handler.
func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetSkillInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, req *mcp.CallToolRequest, input *GetSkillInput) (*mcp.CallToolResult, any, error) {
		apiKey, err := auth.GetAPIKey(ctx)
		if err != nil {
			return nil, nil, fmt.Errorf("get_skill: %w", err)
		}

		conn, err := stigmergrpc.NewConnection(serverAddress, apiKey)
		if err != nil {
			return nil, nil, fmt.Errorf("get_skill: %w", err)
		}
		defer conn.Close()

		rpcCtx, cancel := context.WithTimeout(ctx, stigmergrpc.DefaultRPCTimeout)
		defer cancel()

		client := skillv1.NewSkillQueryControllerClient(conn)
		skill, err := client.GetByReference(rpcCtx, &apiresource.ApiResourceReference{
			Org:     input.Org,
			Kind:    apiresourcekind.ApiResourceKind_skill,
			Slug:    input.Slug,
			Version: input.Version,
		})
		if err != nil {
			return nil, nil, domains.RPCError(err, fmt.Sprintf("skill %q in org %q", input.Slug, input.Org))
		}

		text, err := domains.MarshalJSON(skill)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
