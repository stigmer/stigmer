# Auto-Extract API Resource Kind from Proto Service Descriptors

**Date**: 2026-01-18  
**Type**: Refactor  
**Impact**: Framework Enhancement - Eliminates Boilerplate in Controllers  
**Components**: gRPC Interceptor, Pipeline Steps, Controllers

## Summary

Implemented automatic extraction of `api_resource_kind` from proto service descriptors using a gRPC interceptor, eliminating the need to manually pass `kind` parameters throughout controller and pipeline code. This mirrors the Java implementation's `RequestMethodMetadataRegistry` approach.

## Problem

Previously, every controller had to manually specify the `ApiResourceKind` enum value:

```go
// ❌ Before: Manual kind specification (boilerplate)
kind := apiresourcekind.ApiResourceKind_agent

pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, kind)).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent](kind)).
    AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, kind)).
    Build()
```

This approach:
- Required manual kind specification in every controller
- Created potential for copy-paste errors
- Didn't match Java's automatic extraction approach
- Violated DRY principle (kind already defined in proto service options)

## Solution

Created a **gRPC interceptor** that extracts `api_resource_kind` from proto service descriptors and injects it into the request context:

### 1. gRPC Interceptor (`backend/libs/go/grpc/interceptors/apiresource/`)

**What it does**:
- Extracts service name from gRPC method path
- Uses protobuf reflection to find service descriptor
- Reads `api_resource_kind` extension from service options
- Caches results to minimize reflection overhead
- Injects kind into request context

**How it works**:
```go
// Interceptor extracts kind from proto service descriptor
func UnaryServerInterceptor() grpc.UnaryServerInterceptor {
    return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) {
        kind := extractApiResourceKind(info.FullMethod)
        if kind != apiresourcekind.ApiResourceKind_api_resource_kind_unknown {
            ctx = context.WithValue(ctx, ApiResourceKindKey, kind)
        }
        return handler(ctx, req)
    }
}

// Example proto service option (from command.proto):
service AgentCommandController {
  option (ai.stigmer.commons.apiresource.api_resource_kind) = agent;
  ...
}
```

**Key features**:
- ✅ **Reflection-based extraction** - Reads from `ServiceDescriptor.Options()`
- ✅ **Caching** - Kind extracted once per service, then cached
- ✅ **Context injection** - Available to all pipeline steps
- ✅ **Graceful fallback** - Returns `unknown` for services without option

### 2. Updated Pipeline Steps

Modified steps to get kind from context instead of constructor parameters:

**Before**:
```go
func NewPersistStep[T proto.Message](s store.Store, kind apiresourcekind.ApiResourceKind) *PersistStep[T]
```

**After**:
```go
func NewPersistStep[T proto.Message](s store.Store) *PersistStep[T]

func (s *PersistStep[T]) Execute(ctx *pipeline.RequestContext[T]) error {
    // Get kind from request context (injected by interceptor)
    kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
    // ...
}
```

**Steps updated**:
- `SetDefaultsStep` - Generates IDs with correct prefix
- `CheckDuplicateStep` - Checks duplicates for correct resource type  
- `PersistStep` - Saves to correct resource collection

### 3. Controller Simplification

Controllers no longer need to specify kind:

**Before**:
```go
kind := apiresourcekind.ApiResourceKind_agent

return pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store, kind)).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent](kind)).
    AddStep(steps.NewPersistStep[*agentv1.Agent](c.store, kind)).
    Build()
```

**After**:
```go
// ✅ No kind parameter needed - extracted automatically
return pipeline.NewPipeline[*agentv1.Agent]("agent-create").
    AddStep(steps.NewCheckDuplicateStep[*agentv1.Agent](c.store)).
    AddStep(steps.NewSetDefaultsStep[*agentv1.Agent]()).
    AddStep(steps.NewPersistStep[*agentv1.Agent](c.store)).
    Build()
```

### 4. Server Registration

Interceptor registered at server startup:

```go
server := grpclib.NewServer(
    grpclib.WithUnaryInterceptor(apiresourceinterceptor.UnaryServerInterceptor()),
)
```

## Architecture Alignment

This implementation matches Java's `RequestMethodMetadataRegistry` approach:

**Java**:
```java
// Extracts api_resource_kind during service registration
apiResourceKind = serviceDescriptor.getOptions()
    .getExtension(RpcServiceOptionsProto.apiResourceKind);
```

**Go (now)**:
```go
// Extracts api_resource_kind during request handling
kind := serviceDesc.Options().(*descriptorpb.ServiceOptions)
proto.GetExtension(opts, apiresource.E_ApiResourceKind)
```

Both approaches:
- ✅ Extract from proto service descriptor
- ✅ Use protobuf reflection
- ✅ Cache results to minimize overhead
- ✅ Make kind available to pipeline/handler steps automatically

## Files Modified

**New files**:
- `backend/libs/go/grpc/interceptors/apiresource/interceptor.go` - Interceptor implementation
- `backend/libs/go/grpc/interceptors/apiresource/interceptor_test.go` - Unit tests

**Modified files**:
- `backend/libs/go/grpc/request/pipeline/steps/persist.go` - Get kind from context
- `backend/libs/go/grpc/request/pipeline/steps/defaults.go` - Get kind from context
- `backend/libs/go/grpc/request/pipeline/steps/duplicate.go` - Get kind from context
- `backend/services/stigmer-server/cmd/server/main.go` - Register interceptor
- `backend/services/stigmer-server/pkg/controllers/agent/create.go` - Remove hardcoded kind
- `backend/services/stigmer-server/pkg/controllers/agent/update.go` - Remove hardcoded kind
- `backend/services/stigmer-server/pkg/controllers/agentinstance/create.go` - Remove hardcoded kind

## Benefits

### 1. Zero Boilerplate in Controllers
Controllers no longer need to:
- Import `apiresourcekind` package
- Declare `kind` variable
- Pass `kind` to every pipeline step

### 2. Reduced Copy-Paste Errors
No risk of:
- Using wrong kind enum (e.g., `agent` instead of `agent_instance`)
- Forgetting to update kind when copying controller code

### 3. Single Source of Truth
- Kind defined **once** in proto file service option
- Automatically extracted and propagated
- No duplication or drift

### 4. Framework-Level Solution
- Works for **all** controllers automatically
- No per-controller configuration needed
- Consistent with Java implementation approach

### 5. Performance Optimized
- Reflection happens **once per service** (cached)
- Context lookup in steps is negligible overhead
- Cache is thread-safe with RWMutex

## Testing

Created comprehensive unit tests:

```go
func TestUnaryServerInterceptor(t *testing.T) {
    tests := []struct {
        name           string
        fullMethod     string
        expectedKind   apiresourcekind.ApiResourceKind
        shouldHaveKind bool
    }{
        {
            name:           "Agent command controller",
            fullMethod:     "/ai.stigmer.agentic.agent.v1.AgentCommandController/create",
            expectedKind:   apiresourcekind.ApiResourceKind_agent,
            shouldHaveKind: true,
        },
        {
            name:           "AgentInstance command controller",
            fullMethod:     "/ai.stigmer.agentic.agentinstance.v1.AgentInstanceCommandController/create",
            expectedKind:   apiresourcekind.ApiResourceKind_agent_instance,
            shouldHaveKind: true,
        },
        // ...
    }
}
```

**Build verification**:
```bash
$ go build ./backend/services/stigmer-server/cmd/server
# Success - all controllers compile with new signature
```

## Migration Path for Future Controllers

**Step 1**: Define service option in proto
```proto
service MyResourceCommandController {
  option (ai.stigmer.commons.apiresource.api_resource_kind) = my_resource;
  // ...
}
```

**Step 2**: Build pipeline (no kind parameter needed)
```go
return pipeline.NewPipeline[*MyResource]("my-resource-create").
    AddStep(steps.NewValidateProtoStep[*MyResource]()).
    AddStep(steps.NewCheckDuplicateStep[*MyResource](c.store)).
    AddStep(steps.NewPersistStep[*MyResource](c.store)).
    Build()
```

**That's it!** The interceptor handles the rest.

## Rationale

This change addresses the user's original question:
> "Why don't we use [the proto service option] to extract [the kind]? ... can't we incorporate the same here?"

**Answer**: Yes, we can and now we do! This implementation:
- ✅ Extracts `api_resource_kind` from proto service options (like Java)
- ✅ Eliminates manual kind specification in controllers  
- ✅ Provides framework-level solution (interceptor + context)
- ✅ Maintains backward compatibility (existing proto options work)
- ✅ Improves developer experience (less boilerplate)

## Impact

**Lines of code eliminated per controller**:
- 1 import statement (`apiresourcekind`)
- 1 variable declaration (`kind :=`)
- 3-5 kind parameter passes (one per step)

**Total**: ~5-7 lines of boilerplate per controller

**Controllers updated**: 2 (Agent, AgentInstance)  
**Immediate savings**: ~10-14 lines

**Future benefit**: Every new controller saves 5-7 lines automatically.

## Notes

- Interceptor follows Go best practices (caching, context keys, thread-safety)
- Compatible with all existing proto service definitions
- No changes needed to proto files (already had the option)
- Gracefully handles services without `api_resource_kind` option
- Cache prevents repeated reflection overhead
- Aligned with Java's `RequestMethodMetadataRegistry` approach

---

**Related ADRs**: None (framework enhancement, not architectural decision)  
**Related Issues**: User question about eliminating kind boilerplate  
**Migration Required**: None (automatic for all controllers)
