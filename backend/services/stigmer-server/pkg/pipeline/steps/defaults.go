package steps

import (
	"fmt"
	"strings"
	"time"

	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/pipeline"
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
// Example:
//
//	For kind="agent"
//	Generated ID: "agent-1705678901234567890"
type SetDefaultsStep[T proto.Message] struct {
	idPrefix string
}

// NewSetDefaultsStep creates a new SetDefaultsStep
//
// Parameters:
//   - idPrefix: The prefix for generated IDs (e.g., "agent", "workflow")
//     This is typically the lowercase version of the resource kind
func NewSetDefaultsStep[T proto.Message](idPrefix string) *SetDefaultsStep[T] {
	return &SetDefaultsStep[T]{
		idPrefix: idPrefix,
	}
}

// Name returns the step name
func (s *SetDefaultsStep[T]) Name() string {
	return "SetDefaults"
}

// Execute sets default values on the resource
func (s *SetDefaultsStep[T]) Execute(ctx *pipeline.RequestContext[T]) pipeline.StepResult {
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

	// Set ID if not already set (idempotent)
	if metadata.Id == "" {
		metadata.Id = generateID(s.idPrefix)
	}

	return pipeline.StepResult{Success: true}
}

// generateID generates a unique ID for a resource
//
// Format: {prefix}-{unix-nano-timestamp}
// Example: agent-1705678901234567890
func generateID(prefix string) string {
	// Ensure prefix is lowercase
	prefix = strings.ToLower(prefix)

	// Use Unix nanoseconds for uniqueness
	timestamp := time.Now().UnixNano()

	return fmt.Sprintf("%s-%d", prefix, timestamp)
}
