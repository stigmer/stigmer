// Package mcpserver provides the controller implementation for McpServer resources.
//
// McpServer is a first-class API resource that encapsulates MCP (Model Context Protocol)
// server configurations. MCP servers provide tools and capabilities to AI agents.
// This controller enables local management of MCP server definitions that can be
// referenced by agents.
//
// # Supported Server Types
//
// McpServer supports three server transport types:
//   - Stdio: Subprocess-based communication via stdin/stdout (most common)
//   - HTTP: Remote HTTP endpoints with SSE for responses
//   - Docker: Containerized MCP servers with volume mounts and port mappings
//
// # Usage
//
// The controller implements both McpServerCommandController and McpServerQueryController
// gRPC services. It uses the pipeline pattern for request processing, ensuring
// consistent validation, slug resolution, and persistence across all operations.
//
// Example:
//
//	controller := mcpserver.NewMcpServerController(store)
//	mcpserverv1.RegisterMcpServerCommandControllerServer(grpcServer, controller)
//	mcpserverv1.RegisterMcpServerQueryControllerServer(grpcServer, controller)
package mcpserver

import (
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"go.temporal.io/sdk/client"
)

// McpServerController implements McpServerCommandController and McpServerQueryController.
//
// This controller provides CRUD operations for MCP server resources in the local
// Stigmer OSS environment. Unlike the cloud version, this controller does not
// implement multi-tenancy or FGA authorization, as the OSS version is designed
// for single-user local usage.
//
// Operations:
//   - Create: Creates a new MCP server with validation and slug generation
//   - Get: Retrieves an MCP server by ID
//   - GetByReference: Retrieves an MCP server by slug
//   - Update: Updates an existing MCP server
//   - Delete: Deletes an MCP server
//   - Apply: Idempotent create-or-update (Kubernetes-style)
//   - DiscoverCapabilities: Trigger server-side MCP discovery via Temporal
type McpServerController struct {
	mcpserverv1.UnimplementedMcpServerCommandControllerServer
	mcpserverv1.UnimplementedMcpServerQueryControllerServer
	store store.Store

	// Optional dependencies for discovery. Nil when Temporal is unavailable.
	temporalClient client.Client
	runnerQueue    string
}

// NewMcpServerController creates a new McpServerController with the given store.
//
// The store is used for all persistence operations. In the OSS version,
// this is typically a SQLite-backed store.
func NewMcpServerController(store store.Store) *McpServerController {
	return &McpServerController{
		store: store,
	}
}

// SetDiscoveryDependencies injects the Temporal client needed for server-side
// MCP discovery. This is called after the Temporal connection is established.
//
// Credential resolution is handled inside the Python Temporal activity (JIT
// via OBO gRPC), so the Go handler no longer needs an environment client.
//
// When these dependencies are not set, DiscoverCapabilities returns
// FAILED_PRECONDITION indicating that server-side discovery is unavailable.
func (c *McpServerController) SetDiscoveryDependencies(
	temporalClient client.Client,
	runnerQueue string,
) {
	c.temporalClient = temporalClient
	c.runnerQueue = runnerQueue
}
