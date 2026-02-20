// Package domains provides the shared infrastructure for all MCP domain
// implementations (agents, workflows, skills, mcpservers).
//
// It includes:
//   - Authenticated gRPC connection lifecycle (conn.go)
//   - Proto/JSON serialization for MCP wire format (marshal.go)
//   - gRPC-to-user error translation (rpcerr.go)
//   - The stigmer:// resource URI scheme (resourceuri.go)
//   - MCP tool result construction (toolresult.go)
//   - MCP resource handler factories (resourcehandler.go)
//
// Domain subdirectories (agents/, workflows/, etc.) import this package
// for shared infrastructure and implement the domain-specific tool logic,
// resource templates, and RPC calls.
package domains
