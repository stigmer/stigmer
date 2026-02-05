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
// # Reconciliation
//
// The reconciliation engine:
//  1. Parses desired state from Project.Spec (embedded agents, workflows, etc.)
//  2. Fetches actual state from repositories (resources owned by this project)
//  3. Builds a dependency graph using proto reflection
//  4. Computes a diff (creates, updates, deletes)
//  5. Executes changes in topological order
//
// # Usage
//
// The controller implements both ProjectCommandController and ProjectQueryController
// gRPC services. It uses the pipeline pattern for request processing, ensuring
// consistent validation, slug resolution, and persistence across all operations.
//
// Example:
//
//	reconciliationService := reconcile.NewReconciliationService(store)
//	controller := project.NewProjectController(store, reconciliationService)
//	projectv1.RegisterProjectCommandControllerServer(grpcServer, controller)
//	projectv1.RegisterProjectQueryControllerServer(grpcServer, controller)
package project

import (
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/project/reconcile"
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
	store                 store.Store
	reconciliationService reconcile.ReconciliationService
}

// NewProjectController creates a new ProjectController with the given dependencies.
//
// Parameters:
//   - store: Used for all persistence operations. In the OSS version,
//     this is typically a SQLite-backed store.
//   - reconciliationService: Orchestrates resource reconciliation during Apply.
//     Pass nil to use a default implementation created from the store.
func NewProjectController(store store.Store, reconciliationService reconcile.ReconciliationService) *ProjectController {
	if reconciliationService == nil {
		reconciliationService = reconcile.NewReconciliationService(store, nil)
	}
	return &ProjectController{
		store:                 store,
		reconciliationService: reconciliationService,
	}
}

// SetReconciliationService replaces the controller's reconciliation service.
//
// This method enables late binding of the reconciliation service, which is
// necessary because the ExecutionEngine requires downstream gRPC clients that
// are only available after the in-process gRPC server is fully initialized.
//
// The server startup sequence is:
//  1. Create ProjectController with a stub reconciliation service
//  2. Register all controllers with the gRPC server
//  3. Create in-process gRPC connection
//  4. Create downstream clients using that connection
//  5. Create ExecutionEngine with downstream clients
//  6. Create full ReconciliationService with ExecutionEngine
//  7. Call SetReconciliationService to inject the real implementation
func (c *ProjectController) SetReconciliationService(service reconcile.ReconciliationService) {
	c.reconciliationService = service
}
