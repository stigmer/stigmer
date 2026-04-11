// Package oauthapp provides the controller implementation for OAuthApp resources.
//
// OAuthApp is an organization-scoped resource in the IAM bounded context that
// holds vendor OAuth client credentials (client_id, client_secret, endpoint URLs).
// It enables Stigmer to authenticate with external services (Slack, Salesforce,
// Figma, etc.) on behalf of users via the OAuth authorization code flow.
//
// OAuthApp is the outbound counterpart to IdentityProvider (inbound auth).
// While IdentityProvider configures how external platforms authenticate
// *into* Stigmer, OAuthApp configures how Stigmer authenticates *outward*
// to external services.
//
// Security:
//   - client_secret is encrypted at rest using AES-256-GCM
//   - client_secret is redacted (***REDACTED***) in all API responses
//   - Deletion is blocked if any McpServer references the OAuthApp
//
// # Usage
//
// The controller implements both OAuthAppCommandController and
// OAuthAppQueryController gRPC services.
//
// Example:
//
//	controller := oauthapp.NewOAuthAppController(store, secretService)
//	oauthappv1.RegisterOAuthAppCommandControllerServer(grpcServer, controller)
//	oauthappv1.RegisterOAuthAppQueryControllerServer(grpcServer, controller)
package oauthapp

import (
	oauthappv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/oauthapp/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/encryption"
)

// OAuthAppController implements OAuthAppCommandController and OAuthAppQueryController.
//
// This controller provides CRUD operations for OAuthApp resources in the local
// Stigmer OSS environment. Unlike the cloud version, this controller does not
// implement FGA authorization or event publishing, as the OSS version is
// designed for single-user local usage.
//
// Operations:
//   - Create: Creates a new OAuthApp with encryption of client_secret
//   - Update: Updates an existing OAuthApp, preserving secret if redacted
//   - Delete: Deletes an OAuthApp (blocked if referenced by MCP servers)
//   - Apply: Idempotent create-or-update (Kubernetes-style)
//   - Get: Retrieves an OAuthApp by ID with redacted client_secret
//   - GetByReference: Retrieves an OAuthApp by org/slug with redacted client_secret
//   - ListByOrg: Lists all OAuthApps in an organization with redacted secrets
type OAuthAppController struct {
	oauthappv1.UnimplementedOAuthAppCommandControllerServer
	oauthappv1.UnimplementedOAuthAppQueryControllerServer
	store         store.Store
	secretService *encryption.SecretService
}

// NewOAuthAppController creates a new OAuthAppController with the given store
// and encryption service.
//
// The store is used for all persistence operations. In the OSS version,
// this is typically a SQLite-backed store.
//
// The secretService encrypts client_secret values before persistence
// and is the same instance used by the EnvironmentController.
func NewOAuthAppController(store store.Store, secretService *encryption.SecretService) *OAuthAppController {
	return &OAuthAppController{
		store:         store,
		secretService: secretService,
	}
}
