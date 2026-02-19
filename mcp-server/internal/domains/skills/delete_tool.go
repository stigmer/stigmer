package skills

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// DeleteSkillInput defines the parameters for the "delete_skill" tool.
type DeleteSkillInput struct {
	Org  string `json:"org"  jsonschema:"required,description=Organization slug that owns the skill (e.g. stigmer)."`
	Slug string `json:"slug" jsonschema:"required,description=Skill slug — the unique identifier within the org (e.g. code-review-best-practices). Deletes the skill and all its versions."`
}

// DeleteTool returns the MCP tool definition for the delete_skill tool.
func DeleteTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "delete_skill",
		Description: "Delete a Stigmer skill and all its versions by org and slug. To create or update skills, use the 'stigmer skill push' CLI command. Returns the deleted skill.",
	}
}

// DeleteHandler returns the typed tool handler for delete_skill.
func DeleteHandler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *DeleteSkillInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *DeleteSkillInput) (*mcp.CallToolResult, any, error) {
		text, err := Delete(ctx, serverAddress, input.Org, input.Slug)
		if err != nil {
			return nil, nil, err
		}
		return &mcp.CallToolResult{
			Content: []mcp.Content{&mcp.TextContent{Text: text}},
		}, nil, nil
	}
}
