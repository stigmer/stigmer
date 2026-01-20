package steps

import (
	"github.com/stigmer/stigmer/backend/libs/go/apiresource"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// Context key for storing loaded target resource
const TargetResourceKey = "targetResource"

// HasIdValue is an interface for ID wrapper types (e.g., AgentId, WorkflowId)
// These types wrap a single string value representing the resource ID.
type HasIdValue interface {
	proto.Message
	GetValue() string
}

// LoadTargetStep loads a resource by ID from the database
//
// This step is used in Get operations where the input is an ID wrapper type (e.g., AgentId).
// It:
//  1. Extracts the ID from the input wrapper (e.g., AgentId.value)
//  2. Loads the resource from the database
//  3. Stores the loaded resource in context with key "targetResource"
//  4. Returns NotFound error if resource doesn't exist
//
// Usage in handlers:
//
//	pipeline.NewPipeline[*pb.AgentId]("agent-get").
//	    AddStep(steps.NewLoadTargetStep[*pb.AgentId, *pb.Agent](store)).
//	    Build()
//
// After execution, retrieve the loaded resource from context:
//
//	agent := reqCtx.Get(steps.TargetResourceKey).(*pb.Agent)
type LoadTargetStep[I HasIdValue, T proto.Message] struct {
	store store.Store
}

// NewLoadTargetStep creates a new LoadTargetStep
//
// Type Parameters:
//   - I: The input type (must implement HasIdValue, e.g., *AgentId)
//   - T: The target resource type (e.g., *Agent)
//
// Parameters:
//   - store: The store instance (implements store.Store interface)
//
// The api_resource_kind is automatically extracted from the request context
// by the apiresource interceptor during request handling.
func NewLoadTargetStep[I HasIdValue, T proto.Message](s store.Store) *LoadTargetStep[I, T] {
	return &LoadTargetStep[I, T]{
		store: s,
	}
}

// Name returns the step name
func (s *LoadTargetStep[I, T]) Name() string {
	return "LoadTarget"
}

// Execute loads the target resource from the database
func (s *LoadTargetStep[I, T]) Execute(ctx *pipeline.RequestContext[I]) error {
	input := ctx.Input()

	// Extract ID from wrapper type
	resourceID := input.GetValue()
	if resourceID == "" {
		return grpclib.InvalidArgumentError("resource id is required")
	}

	// Get api_resource_kind from request context (injected by interceptor)
	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	// Create a new instance of the target type
	var target T
	target = target.ProtoReflect().New().Interface().(T)

	// Load from database
	err := s.store.GetResource(ctx.Context(), kind, resourceID, target)
	if err != nil {
		// Extract kind name for error message
		kindName, _ := apiresource.GetKindName(kind)
		// Convert store error to NotFound gRPC error
		return grpclib.NotFoundError(kindName, resourceID)
	}

	// Store loaded resource in context for handler to return
	ctx.Set(TargetResourceKey, target)

	return nil
}
