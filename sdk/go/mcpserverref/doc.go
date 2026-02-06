// Package mcpserverref provides helpers for creating MCP server references.
//
// This package creates VALUE OBJECTS that reference existing MCP servers.
// For DEFINING new MCP servers, use the mcpserver package instead.
//
// # Domain Concept
//
// mcpserverref creates ApiResourceReference value objects - lightweight pointers
// to MCP servers identified by org/slug. These are used when agents need to
// declare which MCP servers they want to use.
//
// # Reference Format
//
// All MCP servers follow the "org/slug" format:
//   - "stigmer/github" - MCP server owned by stigmer org
//   - "acme/internal-tools" - MCP server owned by acme org
//
// Note: Unlike skills, MCP servers do not support versioning.
//
// # Creating References
//
// There are three ways to create MCP server references:
//
// 1. Using New() for explicit org/slug:
//
//	ref := mcpserverref.New("stigmer", "github")
//	ref := mcpserverref.New("acme", "internal-tools")
//
// 2. Using Parse() for string parsing (returns error):
//
//	ref, err := mcpserverref.Parse("stigmer/github")
//	ref, err := mcpserverref.Parse("acme/internal-tools")
//
// 3. Using MustParse() for string parsing (panics on error):
//
//	ref := mcpserverref.MustParse("stigmer/github")  // For init or tests
//
// # Usage with Agents
//
// When adding MCP server references to agents:
//
//	import (
//	    "github.com/stigmer/stigmer/sdk/go/agent"
//	    "github.com/stigmer/stigmer/sdk/go/mcpserverref"
//	)
//
//	reviewer, _ := agent.New(ctx, "code-reviewer", &agent.AgentArgs{...})
//	reviewer.AddMcpServerUsage(mcpserverref.New("stigmer", "github"))
//
// # Error Handling
//
// Parse() returns a *ParseError that wraps one of these sentinel errors:
//   - ErrInvalidFormat: Missing "/" separator or empty input
//   - ErrEmptyOrg: Organization part is empty (e.g., "/slug")
//   - ErrEmptySlug: Slug part is empty (e.g., "org/")
//
// Use errors.Is to check for specific errors:
//
//	ref, err := mcpserverref.Parse(input)
//	if errors.Is(err, mcpserverref.ErrInvalidFormat) {
//	    // Handle invalid format
//	}
package mcpserverref
