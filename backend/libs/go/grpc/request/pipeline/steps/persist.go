package steps

import (
	"fmt"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// PersistStep saves a resource to the database
//
// This step calls store.SaveResource() to persist the resource.
// It requires:
//   - metadata.id must be set
//   - api_resource_kind is extracted from request context (injected by interceptor)
//
// The step uses the configured store (SQLite, BadgerDB, etc.) to save the resource.
type PersistStep[T proto.Message] struct {
	store store.Store
}

// NewPersistStep creates a new PersistStep
//
// Parameters:
//   - store: The store instance (implements store.Store interface)
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewPersistStep[T proto.Message](s store.Store) *PersistStep[T] {
	return &PersistStep[T]{
		store: s,
	}
}

// Name returns the step name
func (s *PersistStep[T]) Name() string {
	return "Persist"
}

// Execute saves the resource to the database
func (s *PersistStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
	resource := ctx.NewState()

	// Type assertion to access metadata
	metadataResource, ok := any(resource).(HasMetadata)
	if !ok {
		return fmt.Errorf("resource does not implement HasMetadata interface")
	}

	metadata := metadataResource.GetMetadata()
	if metadata == nil {
		return fmt.Errorf("resource metadata is nil")
	}

	// Verify ID is set
	if metadata.Id == "" {
		return fmt.Errorf("resource ID is empty, cannot persist")
	}

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// Extract kind name from the enum's proto options
	kindName, err := apiresource.GetKindName(kind)
	if err != nil {
		return fmt.Errorf("failed to get kind name: %w", err)
	}

	// Save to database
	// Use the context from the pipeline context
	err = s.store.SaveResource(ctx.Context(), kindName, metadata.Id, resource)
	if err != nil {
		return fmt.Errorf("failed to save resource to store: %w", err)
	}

	return nil
}
