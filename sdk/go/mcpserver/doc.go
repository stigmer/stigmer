// Package mcpserver provides helpers for creating MCP server references in agent definitions.
//
// When building agents, you add MCP servers to give them access to external tools and services.
// MCP servers are managed separately (via CLI: stigmer mcpserver apply) - this package
// creates references to those servers.
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
//	ref := mcpserver.New("stigmer", "github")
//	ref := mcpserver.New("acme", "internal-tools")
//
// 2. Using Parse() for string parsing (returns error):
//
//	ref, err := mcpserver.Parse("stigmer/github")
//	ref, err := mcpserver.Parse("acme/internal-tools")
//
// 3. Using MustParse() for string parsing (panics on error):
//
//	ref := mcpserver.MustParse("stigmer/github")  // For init or tests
//
// # Usage with Agents
//
// When using with agents, prefer the agent's UseMCPServer method for convenience:
//
//	agent, _ := agent.New("code-reviewer", agent.InOrg("acme"))
//	agent.UseMCPServer("stigmer/github")           // Uses string parsing
//	agent.UseMCPServer("internal-tools")           // Uses agent's org (acme)
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
//	ref, err := mcpserver.Parse(input)
//	if errors.Is(err, mcpserver.ErrInvalidFormat) {
//	    // Handle invalid format
//	}
package mcpserver
