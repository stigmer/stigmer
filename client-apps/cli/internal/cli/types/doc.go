// Package types provides a proto-driven type registry for CLI commands.
//
// The registry is the foundation for verb-first CLI commands, providing:
//   - Resource type definitions derived from proto ApiResourceKind metadata
//   - Algorithmically generated aliases for flexible user input
//   - Verb support matrix for command routing
//   - YAML kind detection for file-based operations
//
// # Design Principle
//
// The [api_resource_kind.proto] is the single source of truth for resource kinds.
// This package reads proto metadata and derives CLI-specific information:
//
//   - Kind names, display names, and ID prefixes come from proto
//   - Aliases are generated algorithmically (no manual duplication)
//   - Verb support is CLI-specific (defined in this package)
//
// # Usage
//
// Get the default registry:
//
//	reg := types.DefaultRegistry()
//
// Look up a type by user input (case-insensitive, supports aliases):
//
//	info, ok := reg.GetByAlias("mcp-server")  // or "mcpserver", "MCP", etc.
//	if ok {
//	    fmt.Println(info.Name)  // "McpServer"
//	}
//
// Check verb support:
//
//	if reg.SupportsVerb(apiresourcekind.ApiResourceKind_agent, types.VerbRun) {
//	    // Agent supports the "run" verb
//	}
//
// Detect YAML kind from a file:
//
//	result, err := types.Detect("agent.yaml")
//	if err == nil {
//	    fmt.Println(result.Kind)  // "Agent"
//	}
package types
