// Package skills provides the "get_skill" MCP tool backed by the
// SkillQueryController.getByReference RPC.
//
// Skills support versioning: the caller can optionally request a specific
// version by tag name (e.g. "stable") or exact SHA-256 hash. When the
// version is omitted, the latest version is returned.
package skills

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
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
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetSkillInput) (*mcp.CallToolResult, any, error) {
		text, err := Fetch(ctx, serverAddress, input.Org, input.Slug, input.Version)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
