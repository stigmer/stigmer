// Package project provides the controller implementation for Project resources.
//
// Project is the aggregate root for managing groups of Stigmer resources. Its spec
// contains a list of ApiResourceReference members — lightweight references to the
// resources that belong to the project. Resources are applied individually by the
// CLI; the project tracks membership and handles orphan pruning.
//
// # Architecture
//
// The Project entity supports three tracks:
//   - Atomic: `stigmer apply -f file.yaml` applies a single resource (no project involved)
//   - Declarative: `stigmer apply` in a directory with `stigmer.yaml` + YAML files scans,
//     applies each resource individually, then updates the project with member references
//   - SDK: `stigmer apply` in a directory with `stigmer.yaml` + entry_point synthesizes
//     resources via SDK, applies each individually, then updates the project
//
// # Reconciliation
//
// The reconciliation engine compares two membership lists:
//  1. Previous members (from the existing project in the database)
//  2. Current members (from the newly applied project's spec.members)
//
// Members in previous but not in current are orphans. When pruning is enabled,
// orphaned resources are deleted via downstream controllers.
//
// # Usage
//
// The controller implements both ProjectCommandController and ProjectQueryController
// gRPC services. It uses the pipeline pattern for request processing, ensuring
// consistent validation, slug resolution, and persistence across all operations.
package project

import (
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/project/reconcile"
)

// ProjectController implements ProjectCommandController and ProjectQueryController.
//
// Operations:
//   - Create: Creates a new project with validation and slug generation
//   - Get: Retrieves a project by ID
//   - GetByReference: Retrieves a project by slug
//   - Update: Updates an existing project
//   - Delete: Deletes a project
//   - Apply: Idempotent create-or-update with membership reconciliation
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
//   - reconciliationService: Handles membership reconciliation during Apply.
//     Pass nil to use a default implementation (stub mode, no orphan deletion).
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
// This enables late binding because the ResourceDeleter requires downstream
// gRPC clients that are only available after the in-process gRPC server is
// fully initialized.
//
// The server startup sequence is:
//  1. Create ProjectController with stub reconciliation service
//  2. Register all controllers with the gRPC server
//  3. Create in-process gRPC connection
//  4. Create downstream clients using that connection
//  5. Create ResourceDeleterAdapter with downstream clients
//  6. Create full ReconciliationService with the deleter
//  7. Call SetReconciliationService to inject the real implementation
func (c *ProjectController) SetReconciliationService(service reconcile.ReconciliationService) {
	c.reconciliationService = service
}
