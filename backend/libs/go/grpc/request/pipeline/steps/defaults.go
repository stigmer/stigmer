package steps

import (
	"fmt"
	"time"

	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/protobuf/proto"
)

// SetDefaultsStep sets default values for a resource
//
// This step sets:
//   - metadata.id: Generated from kind prefix + timestamp (if not set)
//
// The step is idempotent - if ID is already set, it will not override it.
//
// Note: kind and api_version should be set by the controller before entering
// the pipeline, as they are resource-specific and cannot be set generically
// without proto reflection.
//
// The api_resource_kind is extracted from request context (injected by interceptor).
//
// Example:
//
//	For kind=ApiResourceKind_agent
//	Generated ID: "agt-1705678901234567890"
type SetDefaultsStep[T proto.Message] struct {
}

// NewSetDefaultsStep creates a new SetDefaultsStep
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewSetDefaultsStep[T proto.Message]() *SetDefaultsStep[T] {
	return &SetDefaultsStep[T]{}
}

// Name returns the step name
func (s *SetDefaultsStep[T]) Name() string {
	return "SetDefaults"
}

// Execute sets default values on the resource
func (s *SetDefaultsStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
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

	// Set ID if not already set (idempotent)
	if metadata.Id == "" {
		// Get api_resource_kind from request context (injected by interceptor)
		kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

		// Extract ID prefix from the kind's proto options
		idPrefix, err := apiresource.GetIdPrefix(kind)
		if err != nil {
			return fmt.Errorf("failed to get ID prefix from kind: %w", err)
		}
		metadata.Id = generateID(idPrefix)
	}

	return nil
}

// generateID generates a unique ID for a resource
//
// Format: {prefix}-{unix-nano-timestamp}
// Example: agt-1705678901234567890
func generateID(prefix string) string {
	// Use Unix nanoseconds for uniqueness
	timestamp := time.Now().UnixNano()

	return fmt.Sprintf("%s-%d", prefix, timestamp)
}
