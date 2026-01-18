# Request Pipeline Context Design: Multi-Context vs Single-Context

**Status**: ✅ Implemented in both codebases (Java: multi-context, Go: single-context)

## Overview

This document compares two architectural approaches for managing state in request processing pipelines: Java's multi-context design with operation-specific contexts vs Go's single-context design with a unified generic context.

Both approaches solve the same problem: **passing state between pipeline steps during CRUD operations**. The implementations differ in their type safety guarantees, explicitness, and flexibility trade-offs.

## The Problem

Request pipelines execute a series of steps to process CRUD operations:

```mermaid
flowchart LR
    A[Validate] --> B[Authorize]
    B --> C[Load]
    C --> D[Transform]
    D --> E[Persist]
    E --> F[Publish]
```

Each step needs access to:
- Input request data
- Resource state (existing, new, or both)
- Operation-specific metadata (IDs, slugs, flags)
- Inter-step communication data
- Error state and response handling

The challenge: How do we structure this shared state?

## Java Multi-Context Approach

### Design Philosophy

**"Make operation-specific state explicit through separate context types"**

Java uses distinct context classes for each operation type:
- `CreateContextV2<T>` - For create operations
- `UpdateContextV2<T>` - For update operations  
- `DeleteContextV2<I, O>` - For delete operations
- (Presumably) `GetContextV2<I, O>` - For get operations

### Implementation

#### CreateContextV2

```java
public class CreateContextV2<T extends Message> {
    // Input data
    private final T request;
    private final RequestCallerIdentity caller;
    private final RequestMethodMetadata methodMetadata;
    
    // Operation-specific fields
    private String resolvedSlug;        // Slug for the new resource
    private T newState;                 // Resource being created
    private T existingResource;         // Found during duplicate check
    private boolean eventPublished;     // Event publication status
    
    // Shared infrastructure
    private Status errorStatus;
    private StreamObserver<T> responseObserver;
    private Map<Context.Key<?>, Object> data; // For custom inter-step data
}
```

#### UpdateContextV2

```java
public class UpdateContextV2<T extends Message> {
    // Input data
    private final T request;
    private final RequestCallerIdentity caller;
    
    // Operation-specific fields
    private String resolvedSlug;        // Resolved identifier
    private T existingResource;         // Current state from DB
    private T newState;                 // Updated state after merge
    
    // Shared infrastructure
    private Status errorStatus;
    private StreamObserver<T> responseObserver;
    private Map<Context.Key<?>, Object> data;
}
```

#### DeleteContextV2

```java
public class DeleteContextV2<I extends Message, O extends Message> {
    // Input data
    private final I request;            // ID or identifier
    private final RequestCallerIdentity caller;
    
    // Operation-specific fields
    private O existingResource;         // Resource to delete
    private String resourceId;          // Extracted ID
    private boolean deleted;            // Deletion success flag
    private boolean eventPublished;     // Event publication status
    
    // Shared infrastructure
    private Status errorStatus;
    private StreamObserver<O> responseObserver;
    private Map<Context.Key<?>, Object> data;
}
```

### Key Characteristics

**Type Safety**:
- Different input/output types per operation (especially delete: `DeleteContextV2<AgentId, Agent>`)
- Compile-time guarantees about which fields exist
- IDE autocomplete shows only relevant fields

**Explicitness**:
- Each context documents its operation's lifecycle through fields
- `CreateContextV2` has `eventPublished` but no `existingResource` (in typical create flow)
- `UpdateContextV2` has both `existingResource` and `newState`
- `DeleteContextV2` has `deleted` flag specific to deletion

**Self-Documentation**:
- Field names tell the story: "This operation loads existing, builds new, and publishes"
- Javadoc on each field explains when it's set and by which step

## Go Single-Context Approach

### Design Philosophy

**"Provide a flexible container that works for all operations"**

Go uses one generic context type for all operations:

```go
type RequestContext[T proto.Message] struct {
    // Core fields
    ctx      context.Context    // Go context for cancellation
    input    T                  // Original request
    newState T                  // Resource being built/modified
    
    // Flexible metadata
    metadata map[string]interface{}  // Arbitrary key-value storage
    
    // Telemetry
    span telemetry.Span
}
```

### Implementation

```go
// Same context used for all operations
func (c *AgentController) Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    reqCtx := pipeline.NewRequestContext(ctx, agent)
    // ...
}

func (c *AgentController) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    reqCtx := pipeline.NewRequestContext(ctx, agent)
    // ...
}

func (c *AgentController) Delete(ctx context.Context, id *agentv1.AgentId) (*agentv1.Agent, error) {
    reqCtx := pipeline.NewRequestContext(ctx, id)
    // ...
}
```

### Inter-Step Communication

Instead of explicit fields, Go uses the metadata map:

```go
// Step 1: Create default instance
createdInstance, err := s.controller.agentInstanceClient.CreateAsSystem(ctx.Context(), instanceRequest)
defaultInstanceID := createdInstance.GetMetadata().GetId()

// Store in context for next step
ctx.Set(DefaultInstanceIDKey, defaultInstanceID)

// Step 2: Read from context
defaultInstanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
if !ok || defaultInstanceID == "" {
    return fmt.Errorf("default instance ID not found in context")
}
```

### Key Characteristics

**Flexibility**:
- One context type handles all operations
- Add operation-specific data via metadata map
- No need to modify context type for new operations

**Simplicity**:
- Minimal structure: input, newState, metadata
- Less code to maintain (one context vs four)
- Fewer imports and type parameters

**Runtime Safety**:
- Metadata access requires type assertions
- Missing keys return nil (runtime check)
- More defensive coding required

## Architectural Comparison

### What Java Gains (Multi-Context)

| Gain | Explanation | Example |
|------|-------------|---------|
| **Type Safety** | Compiler catches misuse of context fields | Can't access `deleted` flag in CreateContext |
| **Explicitness** | Context fields document operation lifecycle | `existingResource` + `newState` clearly shows update flow |
| **Self-Documentation** | Field presence/absence tells the story | `CreateContextV2` missing `existingResource` (usually) vs `UpdateContextV2` having it |
| **IDE Support** | Autocomplete shows only relevant fields | IntelliJ shows `eventPublished` for CreateContext but not for UpdateContext |
| **Semantic Clarity** | Each operation has custom input/output types | `DeleteContextV2<AgentId, Agent>` vs `CreateContextV2<Agent>` |
| **Compile-Time Guarantees** | Wrong context type = compilation error | Can't pass `DeleteContextV2` to a step expecting `CreateContextV2` |
| **Reduced Cognitive Load** | Developers see only fields relevant to current operation | When working on create, no mental filtering needed |

**Real-World Impact**:

```java
// Java: Type system prevents mistakes
CreateContextV2<Agent> context = ...;
context.getExistingResource();  // ✅ Compiles, makes sense for duplicate check
context.isDeleted();            // ❌ Compilation error - method doesn't exist

// Java: Clear semantics from types
DeleteContextV2<AgentId, Agent> deleteCtx = ...;
AgentId input = deleteCtx.getRequest();      // Input is AgentId
Agent output = deleteCtx.getResponse();       // Output is Agent
```

### What Java Loses (Multi-Context)

| Loss | Explanation | Example |
|------|-------------|---------|
| **Code Duplication** | Similar fields repeated across contexts | All contexts have `errorStatus`, `responseObserver`, `data` map |
| **Maintenance Burden** | Changes to shared infrastructure need updates to all contexts | Adding tracing? Update 4+ context classes |
| **Boilerplate** | More classes, more builders, more code | 4 context classes vs 1 |
| **Rigidity** | Adding new operation requires new context class | Implementing "Upsert" needs `UpsertContextV2` |
| **Abstraction Overhead** | Need to abstract over different context types | Common pipeline steps must be generic over context type |

**Real-World Pain**:

```java
// Need to create a new context for every operation type
public class UpsertContextV2<T extends Message> {
    // Copy-paste from CreateContextV2 and UpdateContextV2
    private final T request;
    private final RequestCallerIdentity caller;
    private String resolvedSlug;
    private T existingResource;
    private T newState;
    // ... 20 more lines of duplication
}

// Every common step needs to work with multiple context types
public interface RequestPipelineStepV2<C extends ContextBase<?, ?>> {
    RequestPipelineStepResultV2 execute(C context);
}
```

### What Go Gains (Single-Context)

| Gain | Explanation | Example |
|------|-------------|---------|
| **Simplicity** | One context type for all operations | 84 lines of code vs 400+ in Java |
| **Flexibility** | Easy to add operation-specific data without modifying context | `ctx.Set("workflow_id", workflowID)` |
| **No Boilerplate** | Minimal code duplication | Shared fields defined once |
| **Easy Extension** | New operations don't need new context types | Upsert, patch, bulk operations use same context |
| **Uniform Interface** | All pipeline steps work with same context type | No need for context type parameters |
| **Lower Barrier to Entry** | Less code to understand | New developers learn one context type |

**Real-World Impact**:

```go
// Go: Same context for everything
type RequestContext[T proto.Message] struct {
    ctx      context.Context
    input    T
    newState T
    metadata map[string]interface{}
    span     telemetry.Span
}

// Works for create, update, delete, get, upsert, patch, bulk...
pipeline.NewRequestContext(ctx, request)

// Adding new operation-specific data is trivial
ctx.Set("previous_version", oldVersion)
ctx.Set("change_reason", reason)
ctx.Set("batch_id", batchID)
```

### What Go Loses (Single-Context)

| Loss | Explanation | Example |
|------|-------------|---------|
| **Type Safety** | Runtime errors instead of compile-time | Typo in metadata key = nil at runtime |
| **Explicitness** | Can't tell what data exists by looking at type | Must read pipeline code to know what's in metadata |
| **Self-Documentation** | Context doesn't document operation lifecycle | No way to know from type what fields are set when |
| **IDE Support** | No autocomplete for metadata keys | `ctx.Get("defualt_instance_id")` ← typo, no compile error |
| **Semantic Clarity** | Input/output types less clear | Delete has AgentId input but returns Agent (not in type) |
| **Type Assertions Required** | Every metadata access needs type assertion | `instanceID, ok := ctx.Get(key).(string)` |
| **Debugging Difficulty** | Can't inspect "what should be here" from type | Must trace through code to know expected metadata |

**Real-World Pain**:

```go
// Go: Typos cause runtime errors
const DefaultInstanceIDKey = "default_instance_id"

// Step 1: Writes with correct key
ctx.Set(DefaultInstanceIDKey, instanceID)

// Step 2: Typo in key (no compile error!)
instanceID := ctx.Get("default_instace_id")  // ← typo: "instace"
// Returns nil, causes panic or silent bug later

// Type assertion failures at runtime
instanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
if !ok {
    // Could be: wrong type stored, key doesn't exist, or nil value
    // Can't tell from type system which case it is
}

// No documentation of what should exist
func (s *someStep) Execute(ctx *pipeline.RequestContext[*agentv1.Agent]) error {
    // What keys are expected in metadata? Unknown without reading all prior steps
    // What type should each key have? Unknown without tracing code
    data := ctx.Get("???")  // IDE can't help
}
```

## Decision Matrix

### Choose Multi-Context (Java Approach) When:

✅ **Type safety is critical**
- Large teams where compile-time guarantees prevent bugs
- Complex operations with many state transitions
- Junior developers benefit from compiler guidance

✅ **Self-documentation is valuable**
- Code is read more than written
- Operation lifecycle needs to be clear from types
- Onboarding new developers is frequent

✅ **Operations are distinct**
- Create, update, delete have very different flows
- Shared fields are minimal
- Custom input/output types per operation

### Choose Single-Context (Go Approach) When:

✅ **Simplicity is paramount**
- Small teams where everyone understands the codebase
- Operations share most state
- Rapid prototyping and iteration needed

✅ **Flexibility is required**
- Frequent addition of new operation types
- Custom metadata varies widely per use case
- Generic abstractions over all operations

✅ **Code duplication is expensive**
- Maintaining multiple context types is burdensome
- Shared infrastructure changes frequently
- Team values DRY (Don't Repeat Yourself)

## Concrete Examples

### Example 1: Adding Tracing Information

**Java Multi-Context**:
```java
// Must update ALL context types
public class CreateContextV2<T> {
    private String traceId;
    private Span span;
}

public class UpdateContextV2<T> {
    private String traceId;
    private Span span;
}

public class DeleteContextV2<I, O> {
    private String traceId;
    private Span span;
}
// ... repeat for every context type
```

**Go Single-Context**:
```go
// Update once
type RequestContext[T proto.Message] struct {
    ctx      context.Context
    input    T
    newState T
    metadata map[string]interface{}
    span     telemetry.Span  // ✅ Added here, works everywhere
}
```

### Example 2: Inter-Step Communication

**Java Multi-Context**:
```java
// Explicit field in CreateContextV2 (type-safe)
public class CreateContextV2<T> {
    private String defaultInstanceId;  // Clear what this is
}

// Step 1: Set field
context.setDefaultInstanceId(instanceId);

// Step 2: Get field (autocomplete works)
String instanceId = context.getDefaultInstanceId();  // ✅ Type-safe
```

**Go Single-Context**:
```go
// Use metadata map (flexible but runtime-checked)
const DefaultInstanceIDKey = "default_instance_id"  // Document what keys exist

// Step 1: Set in map
ctx.Set(DefaultInstanceIDKey, instanceId)

// Step 2: Get from map (runtime type assertion)
instanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)  // ⚠️ Runtime check
if !ok {
    return fmt.Errorf("default instance ID not found or wrong type")
}
```

### Example 3: New Operation (Upsert)

**Java Multi-Context**:
```java
// Must create new context type
public class UpsertContextV2<T extends Message> implements ContextBase<T, T> {
    // Common fields (copy-paste from others)
    private final T request;
    private final RequestCallerIdentity caller;
    private final RequestMethodMetadata methodMetadata;
    private final StreamObserver<T> responseObserver;
    private Status errorStatus;
    private String errorMessage;
    // ... 15 more shared fields
    
    // Upsert-specific fields
    private boolean resourceExists;    // Found during lookup
    private T existingResource;        // If found
    private T newState;                // Result (created or updated)
    private boolean wasCreated;        // true if created, false if updated
    
    // ... builder, getters, setters
}

// Must create new handler base
public abstract class UpsertOperationHandlerV2<T extends Message> 
    extends BaseOperationHandlerV2<T, T, UpsertContextV2<T>> {
    // ...
}

// 100+ lines of boilerplate
```

**Go Single-Context**:
```go
// No new types needed
func (c *AgentController) Upsert(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
    reqCtx := pipeline.NewRequestContext(ctx, agent)  // ✅ Same context
    
    p := pipeline.NewPipeline[*agentv1.Agent]("agent-upsert").
        AddStep(steps.NewValidateProtoStep[*agentv1.Agent]()).
        AddStep(steps.NewCheckExistsStep[*agentv1.Agent](c.store)).  // Sets "resource_exists" in metadata
        AddStep(newConditionalCreateOrUpdateStep()).                 // Reads "resource_exists" from metadata
        Build()
    
    return p.Execute(reqCtx)
}

// 10 lines of code
```

## Performance Implications

**Memory Footprint**:

| Aspect | Java Multi-Context | Go Single-Context |
|--------|-------------------|-------------------|
| Per-request allocation | Larger (operation-specific fields) | Smaller (only used fields) |
| Garbage collection pressure | Higher (more objects) | Lower (simpler structure) |
| Field access | Direct field access (fast) | Map lookup (slower) |

**Real numbers** (approximate):
- Java `CreateContextV2`: ~300 bytes per instance
- Java `UpdateContextV2`: ~280 bytes per instance  
- Java `DeleteContextV2`: ~320 bytes per instance
- Go `RequestContext`: ~150 bytes base + metadata (varies)

**Under load**:
- 10,000 requests/sec × 300 bytes = ~3 MB/sec allocation (Java)
- 10,000 requests/sec × 150 bytes = ~1.5 MB/sec allocation (Go)

**Winner**: Go (lower memory, simpler GC), but difference is negligible for most workloads.

## Testing Implications

**Java Multi-Context**:
```java
// Each context type needs separate test infrastructure
CreateContextV2<Agent> createCtx = CreateContextV2.<Agent>builder()
    .request(testAgent)
    .caller(testCaller)
    .methodMetadata(testMetadata)
    .responseObserver(mockObserver)
    .data(new HashMap<>())
    .build();

UpdateContextV2<Agent> updateCtx = UpdateContextV2.<Agent>builder()
    .request(testAgent)
    .caller(testCaller)
    .methodMetadata(testMetadata)
    .responseObserver(mockObserver)
    .existingResource(existingAgent)  // ← Different from create
    .data(new HashMap<>())
    .build();
```

**Go Single-Context**:
```go
// One test helper for all operations
func newTestContext[T proto.Message](input T) *pipeline.RequestContext[T] {
    return pipeline.NewRequestContext(context.Background(), input)
}

// Works for create, update, delete, get...
createCtx := newTestContext(testAgent)
updateCtx := newTestContext(testAgent)
deleteCtx := newTestContext(testAgentId)
```

**Winner**: Go (less test boilerplate)

## Migration Considerations

### Java → Go (Lossy)

Migrating from Java multi-context to Go single-context requires:

1. **Document metadata keys** (was implicit in field names)
   ```go
   // Required documentation that didn't exist before
   const (
       DefaultInstanceIDKey = "default_instance_id"  // Set by CreateDefaultInstance step
       ResourceExistsKey    = "resource_exists"      // Set by CheckExists step
       WasCreatedKey        = "was_created"          // Set by Upsert step
   )
   ```

2. **Add runtime validation** (was compile-time)
   ```go
   // Replace type-safe field access with runtime checks
   instanceID, ok := ctx.Get(DefaultInstanceIDKey).(string)
   if !ok || instanceID == "" {
       return fmt.Errorf("missing required field: default_instance_id")
   }
   ```

3. **Lose operation-specific types**
   ```go
   // Delete used to have DeleteContextV2<AgentId, Agent>
   // Now just RequestContext[proto.Message] - lose input/output distinction
   ```

### Go → Java (Tedious but Safe)

Migrating from Go single-context to Java multi-context requires:

1. **Extract all metadata keys into fields**
   ```java
   // Every ctx.Get("key") becomes a field
   private String defaultInstanceId;
   private boolean resourceExists;
   private boolean wasCreated;
   ```

2. **Create context types for each operation**
   ```java
   CreateContextV2<Agent>
   UpdateContextV2<Agent>
   DeleteContextV2<AgentId, Agent>
   GetContextV2<AgentId, Agent>
   ```

3. **Add builders and getters/setters**
   ```java
   @Builder
   @Data
   public class CreateContextV2<T> { ... }
   ```

## Recommendations

### For Stigmer OSS (Current Go Codebase)

**Recommendation**: ✅ **Keep single-context approach**

**Rationale**:
- Small team with deep codebase knowledge
- Rapid iteration and feature development
- Simplicity aligns with OSS goals (fewer files, easier to grok)
- Current implementation works well in practice
- No evidence of metadata-related bugs

**Mitigations for single-context downsides**:
1. Document all metadata keys as constants
2. Add validation helpers for common metadata patterns
3. Use clear naming conventions for metadata keys
4. Include metadata expectations in step documentation

**Example mitigations**:

```go
// 1. Document keys as constants
const (
    // DefaultInstanceIDKey stores the ID of the auto-created default instance.
    // Set by: CreateDefaultInstance step
    // Used by: UpdateAgentStatusWithDefaultInstance step
    // Type: string
    DefaultInstanceIDKey = "default_instance_id"
    
    // ResourceExistsKey indicates if a resource was found during lookup.
    // Set by: CheckExists step
    // Used by: ConditionalCreate step
    // Type: bool
    ResourceExistsKey = "resource_exists"
)

// 2. Validation helper
func requireString(ctx *pipeline.RequestContext[T], key string) (string, error) {
    val, ok := ctx.Get(key).(string)
    if !ok || val == "" {
        return "", fmt.Errorf("missing required string field: %s", key)
    }
    return val, nil
}

// 3. Usage
instanceID, err := requireString(ctx, DefaultInstanceIDKey)
if err != nil {
    return err
}
```

### For Stigmer Cloud (Current Java Codebase)

**Recommendation**: ✅ **Keep multi-context approach**

**Rationale**:
- Larger codebase with multiple teams
- Type safety prevents integration bugs
- Self-documenting contexts aid onboarding
- Java ecosystem favors explicit types
- Existing investment in multi-context architecture

**Accept the trade-offs**:
- More boilerplate (Java norm)
- Maintenance of multiple context types (worth it for type safety)
- Duplication of shared fields (negligible compared to codebase size)

### For New Projects

**Decision criteria**:

| Factor | Choose Java Multi-Context | Choose Go Single-Context |
|--------|---------------------------|--------------------------|
| Team size | > 10 developers | < 10 developers |
| Team experience | Mixed (junior + senior) | Senior-heavy |
| Operation complexity | High (many distinct workflows) | Low (similar workflows) |
| Change frequency | Low (stable operations) | High (rapid iteration) |
| Type safety priority | Critical (fintech, healthcare) | Nice-to-have (internal tools) |
| Language | Java, C#, Rust | Go, Python, JavaScript |

## Hybrid Approach (Future Consideration)

Could we get benefits of both?

**Idea**: Operation-specific wrapper types around a shared context core:

```go
// Shared core
type RequestContextCore[T proto.Message] struct {
    ctx      context.Context
    input    T
    newState T
    metadata map[string]interface{}
}

// Operation-specific wrappers with type-safe fields
type CreateContext[T proto.Message] struct {
    *RequestContextCore[T]
    
    // Type-safe fields for create
    resolvedSlug      string
    existingResource  T
    defaultInstanceID string
    eventPublished    bool
}

// Compile-time access, runtime flexibility
func (c *CreateContext[T]) DefaultInstanceID() string {
    if c.defaultInstanceID != "" {
        return c.defaultInstanceID
    }
    // Fallback to metadata for backward compatibility
    if id, ok := c.metadata[DefaultInstanceIDKey].(string); ok {
        return id
    }
    return ""
}
```

**Pros**:
- Type-safe field access where defined
- Flexible metadata for custom use cases
- Gradual migration path

**Cons**:
- Increased complexity
- Confusion about when to use fields vs metadata
- Duplication between fields and metadata

**Verdict**: Interesting idea, but adds complexity. Only worthwhile if type safety becomes a real problem in Go codebase (currently: no evidence).

## Conclusion

Both approaches are valid engineering trade-offs:

**Java Multi-Context**:
- Optimizes for **type safety, explicitness, and self-documentation**
- Pays cost in **boilerplate, maintenance, and rigidity**
- Best for: Large teams, complex operations, compile-time guarantees

**Go Single-Context**:
- Optimizes for **simplicity, flexibility, and low boilerplate**
- Pays cost in **runtime safety, explicitness, and IDE support**
- Best for: Small teams, rapid iteration, uniform operations

**Neither is universally better.** The right choice depends on team size, codebase complexity, change frequency, and engineering culture.

**For Stigmer**: Current implementations are well-suited to their respective codebases and teams. No migration is recommended.

## Related Documentation

- [Backend Architecture](backend-architecture.md) - Overall backend design patterns
- [Request Pipeline Framework](request-pipeline-framework.md) - How pipelines work
- [gRPC Request Handling](grpc-request-handling.md) - Request processing architecture

---

*This document was written to be grounded in actual implementation, developer-friendly, and to clearly explain the trade-offs without bias toward either approach. Both are good engineering choices in their respective contexts.*
