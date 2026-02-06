// Package ref provides factory functions for creating API resource references.
//
// This package mirrors the proto commons/apiresource structure and provides
// type-safe construction of ApiResourceReference messages for different
// resource kinds (skills, MCP servers, environments, etc.).
//
// # Skills (versioned resources)
//
// Skills support versioning via tags, hashes, or "latest":
//
//	ref.Skill("stigmer", "web-search")
//	ref.Skill("stigmer", "code-review", ref.WithVersion("v1.0"))
//	ref.Skill("acme", "internal-docs", ref.WithVersion("stable"))
//
// Parse skill references from strings:
//
//	ref, err := ref.ParseSkill("stigmer/web-search")
//	ref, err := ref.ParseSkill("stigmer/code-review@v1.0")
//	ref := ref.MustParseSkill("stigmer/web-search@stable")  // panics on error
//
// # MCP Servers (non-versioned resources)
//
// MCP servers do not support versioning:
//
//	ref.McpServer("stigmer", "github")
//	ref.McpServer("acme", "internal-tools")
//
// Parse MCP server references from strings:
//
//	ref, err := ref.ParseMcpServer("stigmer/github")
//	ref := ref.MustParseMcpServer("acme/internal-tools")  // panics on error
//
// # Environments (non-versioned resources)
//
// Environments are first-class API resources holding actual env var values.
// They are referenced by AgentInstance and WorkflowInstance:
//
//	ref.Environment("acme", "production-aws")
//	ref.Environment("acme", "staging-gcp")
//
// Parse environment references from strings:
//
//	ref, err := ref.ParseEnvironment("acme/production-aws")
//	ref := ref.MustParseEnvironment("acme/staging")  // panics on error
//
// # Error Handling
//
// All Parse* functions return *ParseError on failure. ParseError wraps
// sentinel errors (ErrInvalidFormat, ErrEmptyOrg, ErrEmptySlug) and
// supports errors.Is/errors.As for inspection:
//
//	ref, err := ref.ParseSkill("invalid")
//	if errors.Is(err, ref.ErrInvalidFormat) {
//	    // handle invalid format
//	}
//
//	var parseErr *ref.ParseError
//	if errors.As(err, &parseErr) {
//	    fmt.Printf("kind: %s, input: %s\n", parseErr.Kind, parseErr.Input)
//	}
//
// # Reference Format
//
// References follow the "org/slug" format:
//   - org: Organization identifier (e.g., "stigmer", "acme-corp")
//   - slug: Resource identifier within the org (e.g., "web-search", "github")
//   - version: Optional version suffix for versioned resources (e.g., "@v1.0", "@stable")
//
// Examples:
//   - "stigmer/web-search" - skill without version
//   - "stigmer/web-search@v1.0" - skill with version tag
//   - "acme/internal-tools" - MCP server (no version support)
//   - "acme/production-aws" - environment (no version support)
package ref
