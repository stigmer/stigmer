// Package organization provides the controller implementation for Organization resources.
//
// Organization is the top-level container for all Stigmer resources.
// Similar to GitHub organizations, all agents, workflows, sessions, and other
// resources are scoped under an organization. This enables multi-tenancy and
// proper resource isolation.
//
// # Usage
//
// The controller implements both OrganizationCommandController and
// OrganizationQueryController gRPC services. It uses the pipeline pattern for
// request processing, ensuring consistent validation, slug resolution, and
// persistence across all operations.
//
// Example:
//
//	controller := organization.NewOrganizationController(store)
//	organizationv1.RegisterOrganizationCommandControllerServer(grpcServer, controller)
//	organizationv1.RegisterOrganizationQueryControllerServer(grpcServer, controller)
package organization

import (
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// OrganizationController implements OrganizationCommandController and OrganizationQueryController.
//
// This controller provides CRUD operations for Organization resources in the local
// Stigmer OSS environment. Unlike the cloud version, this controller does not
// implement multi-tenancy, FGA authorization, or platform-managed org features,
// as the OSS version is designed for single-user local usage.
//
// Operations:
//   - Create: Creates a new organization with validation and slug generation
//   - Update: Updates an existing organization
//   - Delete: Deletes an organization by ID
//   - Apply: Idempotent create-or-update (Kubernetes-style)
//   - Get: Retrieves an organization by ID
//   - Find: Lists organizations with pagination
//   - FindMyOrganizations: Returns all organizations (no IAM filtering in OSS)
type OrganizationController struct {
	organizationv1.UnimplementedOrganizationCommandControllerServer
	organizationv1.UnimplementedOrganizationQueryControllerServer
	store store.Store
}

// NewOrganizationController creates a new OrganizationController with the given store.
//
// The store is used for all persistence operations. In the OSS version,
// this is typically a SQLite-backed store.
func NewOrganizationController(store store.Store) *OrganizationController {
	return &OrganizationController{
		store: store,
	}
}
