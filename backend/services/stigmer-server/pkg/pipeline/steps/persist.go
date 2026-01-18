package steps

import (
	"context"
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/pipeline"
	"google.golang.org/protobuf/proto"
)

// PersistStep saves a resource to the database
//
// This step calls store.SaveResource() to persist the resource.
// It requires:
//   - metadata.id must be set
//   - kind must be provided to the constructor
//
// The step uses the SQLite store to save the resource as JSON.
type PersistStep[T proto.Message] struct {
	store *sqlite.Store
	kind  string
}

// NewPersistStep creates a new PersistStep
//
// Parameters:
//   - store: The SQLite store instance
//   - kind: The resource kind (e.g., "Agent", "Workflow")
func NewPersistStep[T proto.Message](store *sqlite.Store, kind string) *PersistStep[T] {
	return &PersistStep[T]{
		store: store,
		kind:  kind,
	}
}

// Name returns the step name
func (s *PersistStep[T]) Name() string {
	return "Persist"
}

// Execute saves the resource to the database
func (s *PersistStep[T]) Execute(ctx *pipeline.RequestContext[T]) pipeline.StepResult {
	resource := ctx.NewState()

	// Type assertion to access metadata
	metadataResource, ok := any(resource).(HasMetadata)
	if !ok {
		return pipeline.StepResult{
			Error: pipeline.StepError(s.Name(), fmt.Errorf("resource does not implement HasMetadata interface")),
		}
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return pipeline.StepResult{
			Error: pipeline.StepError(s.Name(), fmt.Errorf("resource metadata is nil")),
		}
	}

	// Verify ID is set
	if metadata.Id == "" {
		return pipeline.StepResult{
			Error: pipeline.StepError(s.Name(), fmt.Errorf("resource ID is empty, cannot persist")),
		}
	}

	// Save to database
	// Use the context from the pipeline context
	err := s.store.SaveResource(ctx.Context(), s.kind, metadata.Id, resource)
	if err != nil {
		return pipeline.StepResult{
			Error: pipeline.StepError(s.Name(), fmt.Errorf("failed to save resource to store: %w", err)),
		}
	}

	return pipeline.StepResult{Success: true}
}
