// Package project provides the controller implementation for Project resources.
//
// Project is the aggregate root for SDK-based deployments. It contains embedded
// resources (agents, workflows, mcp_servers, skills) in its spec and uses a
// reconciliation engine to align actual state with desired state.
//
// # Architecture
//
// The Project entity serves as the deployment unit for the CLI's "Project Track"
// (SDK synthesis). When a user runs `stigmer apply` with a stigmer.yaml file,
// the CLI synthesizes the SDK project into a Project proto and sends it to this
// controller's Apply method.
//
// # Reconciliation (Phase E)
//
// The reconciliation engine (implemented in later phases) will:
//  1. Parse desired state from Project.Spec (embedded agents, workflows, etc.)
//  2. Fetch actual state from repositories (resources owned by this project)
//  3. Build a dependency graph using proto reflection
//  4. Compute a diff (creates, updates, deletes)
//  5. Execute changes in topological order
//
// # Usage
//
// The controller implements both ProjectCommandController and ProjectQueryController
// gRPC services. It uses the pipeline pattern for request processing, ensuring
// consistent validation, slug resolution, and persistence across all operations.
//
// Example:
//
//	controller := project.NewProjectController(store)
//	projectv1.RegisterProjectCommandControllerServer(grpcServer, controller)
//	projectv1.RegisterProjectQueryControllerServer(grpcServer, controller)
package project

import (
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// ProjectController implements ProjectCommandController and ProjectQueryController.
//
// This controller provides CRUD operations for Project resources in the local
// Stigmer OSS environment. Unlike the cloud version, this controller does not
// implement multi-tenancy or FGA authorization, as the OSS version is designed
// for single-user local usage.
//
// Operations:
//   - Create: Creates a new project with validation and slug generation
//   - Get: Retrieves a project by ID
//   - GetByReference: Retrieves a project by slug
//   - Update: Updates an existing project
//   - Delete: Deletes a project
//   - Apply: Idempotent create-or-update with reconciliation
type ProjectController struct {
	projectv1.UnimplementedProjectCommandControllerServer
	projectv1.UnimplementedProjectQueryControllerServer
	store store.Store
}

// NewProjectController creates a new ProjectController with the given store.
//
// The store is used for all persistence operations. In the OSS version,
// this is typically a SQLite-backed store.
func NewProjectController(store store.Store) *ProjectController {
	return &ProjectController{
		store: store,
	}
}
