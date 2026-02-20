// Package skills provides the MCP tools and resource templates for the Skill
// domain, backed by the SkillQueryController and SkillCommandController RPCs.
//
// Skills support versioning: the caller can optionally request a specific
// version by tag name (e.g. "stable") or exact SHA-256 hash. When the
// version is omitted, the latest version is returned.
package skills

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/stigmer/stigmer/mcp-server/internal/domains"
)

// --- get_skill ---

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

// Handler returns the typed tool handler. serverAddress is captured at
// registration time; the API key is read from context at call time.
func Handler(serverAddress string) func(context.Context, *mcp.CallToolRequest, *GetSkillInput) (*mcp.CallToolResult, any, error) {
	return func(ctx context.Context, _ *mcp.CallToolRequest, input *GetSkillInput) (*mcp.CallToolResult, any, error) {
		text, err := Fetch(ctx, serverAddress, input.Org, input.Slug, input.Version)
		if err != nil {
			return nil, nil, err
		}
		return domains.TextResult(text)
	}
}

// --- delete_skill ---

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
		return domains.CallFetch(Delete, ctx, serverAddress, input.Org, input.Slug)
	}
}
