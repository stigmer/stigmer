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
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/mcpserver/oauth"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/environment"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/executioncontext"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/runnerauth"
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
//   - Connect: Trigger server-side MCP discovery and tool approval classification via Temporal
type McpServerController struct {
	mcpserverv1.UnimplementedMcpServerCommandControllerServer
	mcpserverv1.UnimplementedMcpServerQueryControllerServer
	store store.Store

	// Optional dependencies for connect. Nil when Temporal is unavailable.
	temporalClient     client.Client
	temporalConfig     *agentexecutiontemporal.Config
	environmentClient  *environment.Client
	executionCtxClient *executioncontext.Client

	// Mints the execution-scoped token the discovery activity presents to
	// read the connect ExecutionContext's decrypted credentials (oss#535).
	// Nil/keyless degrades to a tokenless read, which the redacting EC RPC
	// answers with markers and discovery refuses fail-closed.
	runnerAuth *runnerauth.Service

	// Managed environment service for OAuth token storage. Initialized
	// alongside connect dependencies since it depends on environmentClient.
	managedEnvService *oauth.ManagedEnvironmentService

	// Optional dependencies for OAuth Connect. Nil when not configured.
	oauthGrantStore        *oauth.OAuthGrantStore
	pendingOAuthStateStore *oauth.PendingOAuthStateStore
	encryptionService      *encryption.SecretService
	oauthRedirectURI       string
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

// SetConnectDependencies injects the dependencies needed for the connect RPC
// (server-side MCP discovery + tool approval classification). Called after the
// Temporal connection and in-process gRPC clients are established.
//
// The Go handler creates an ephemeral ExecutionContext with the resolved
// environment variables and passes its ID to the Temporal workflow. The
// Python activity reads from the scoped ExecutionContext (least-privilege).
//
// When these dependencies are not set, Connect returns FAILED_PRECONDITION
// indicating that the connect flow is unavailable.
func (c *McpServerController) SetConnectDependencies(
	temporalClient client.Client,
	temporalConfig *agentexecutiontemporal.Config,
	environmentClient *environment.Client,
	executionCtxClient *executioncontext.Client,
	runnerAuth *runnerauth.Service,
) {
	c.temporalClient = temporalClient
	c.temporalConfig = temporalConfig
	c.environmentClient = environmentClient
	c.executionCtxClient = executionCtxClient
	c.runnerAuth = runnerAuth
	c.managedEnvService = oauth.NewManagedEnvironmentService(environmentClient)
}

// SetOAuthDependencies injects the dependencies needed for the OAuth Connect
// RPCs (initiateOAuthConnect / completeOAuthConnect). Called after the SQLite
// stores and encryption service are initialized.
func (c *McpServerController) SetOAuthDependencies(
	grantStore *oauth.OAuthGrantStore,
	pendingStateStore *oauth.PendingOAuthStateStore,
	encryptionService *encryption.SecretService,
	redirectURI string,
) {
	c.oauthGrantStore = grantStore
	c.pendingOAuthStateStore = pendingStateStore
	c.encryptionService = encryptionService
	c.oauthRedirectURI = redirectURI
}
