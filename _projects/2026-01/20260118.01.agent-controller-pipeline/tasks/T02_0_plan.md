# T02: Implement Common Pipeline Steps - PLAN

**Created:** 2026-01-18  
**Status:** 🔵 PLANNING  
**Estimated Effort:** 3-4 hours

## Goal

Implement common reusable pipeline steps that match the patterns from Stigmer Cloud (Java). These steps will be used across all resource controllers (Agent, Workflow, etc.) and will establish the standard processing flow for API resources.

## Background

**T01 completed:** Generic pipeline framework with fluent API, context passing, error handling, and OpenTelemetry integration.

**Current state:** Agent controller uses monolithic inline logic in `Create()` method (~65 lines).

**Java reference:** AgentCreateHandler uses common steps from `RequestOperationCommonSteps` and `CreateOperationSteps`.

## Steps to Implement

### 1. ResolveSlugStep ⏳

**Purpose:** Generate URL-friendly slug from resource name

**Pattern from Java:**
```java
.addStep(commonSteps.resolveSlug)  // 3. Resolve slug from name
```

**Go implementation:**
- Input: Resource with `metadata.name` set
- Output: Sets `metadata.slug` (lowercase, hyphens, no special chars)
- Location: `pkg/pipeline/steps/slug.go`
- Size target: 40-60 lines

**Slug generation rules:**
- Lowercase all characters
- Replace spaces with hyphens
- Remove special characters except hyphens
- Trim leading/trailing hyphens
- Example: "My Cool Agent" → "my-cool-agent"

**Considerations:**
- Should be idempotent (if slug already set, leave it)
- Must handle Unicode characters (Go strings are UTF-8)
- Should validate slug length (max 63 chars for K8s compatibility)

---

### 2. CheckDuplicateStep ⏳

**Purpose:** Verify no resource with same slug exists in the same scope

**Pattern from Java:**
```java
.addStep(createSteps.checkDuplicate)  // 4. Check duplicate (needs resolved slug)
```

**Go implementation:**
- Input: Resource with `metadata.slug` and `metadata.org` set
- Output: Error if duplicate found, success otherwise
- Location: `pkg/pipeline/steps/duplicate.go`
- Size target: 60-80 lines
- Dependency: Needs access to `sqlite.Store`

**Duplicate check logic:**
- Search by slug + org (organization-scoped resources)
- Search by slug only (platform-scoped resources)
- Return `ALREADY_EXISTS` error with clear message

**Design consideration:**
- Step needs store dependency - use constructor injection
- Generic step `CheckDuplicateStep[T]` that works with any resource
- Store lookup uses `findByName()` pattern from current controller

---

### 3. SetAuditFieldsStep ⏳

**Purpose:** Set created_at, updated_at, version fields for audit trail

**Pattern from Java:**
```java
// Part of buildNewState in CreateOperationSteps
agent.setMetadata(agent.getMetadata().toBuilder()
    .setCreatedAt(timestamp)
    .setUpdatedAt(timestamp)
    .setVersion(1)
    .build());
```

**Go implementation:**
- Input: Resource with metadata
- Output: Sets audit fields in metadata
- Location: `pkg/pipeline/steps/audit.go`
- Size target: 40-60 lines

**Fields to set:**
- `metadata.created_at` (protobuf Timestamp)
- `metadata.updated_at` (protobuf Timestamp)
- `metadata.version` (int32, always 1 for create)

**Considerations:**
- Generic step `SetAuditFieldsStep[T]` 
- Works with any resource that has `ApiResourceMetadata`
- Uses `timestamppb.Now()` for timestamps
- Should be idempotent (check if already set)

---

### 4. SetDefaultsStep ⏳

**Purpose:** Set default values like ID, kind, apiVersion

**Pattern from Java:**
```java
// Part of buildNewState
.setId(generateId())
.setKind("Agent")
.setApiVersion("ai.stigmer.agentic.agent/v1")
```

**Go implementation:**
- Input: Resource (may have partial data)
- Output: Resource with all defaults set
- Location: `pkg/pipeline/steps/defaults.go`
- Size target: 60-80 lines

**Defaults to set:**
- `metadata.id` (generate if empty: "agent-{timestamp}")
- `kind` (e.g., "Agent")
- `api_version` (e.g., "ai.stigmer.agentic.agent/v1")

**Design challenge:**
- Kind and apiVersion are resource-specific
- Solution: Pass kind and apiVersion to step constructor
- Generic: `NewSetDefaultsStep[T](kind, apiVersion string)`

**ID generation:**
- Use timestamp-based for now (TODO: UUID later)
- Format: `{kind-prefix}-{unix-nano}` (e.g., "agent-1705678901234")
- Prefix extracted from kind (Agent → agent)

---

### 5. PersistStep ⏳

**Purpose:** Save resource to SQLite database

**Pattern from Java:**
```java
.addStep(createSteps.persist)  // 6. Persist agent to repository
```

**Go implementation:**
- Input: Resource with all fields set
- Output: Resource saved to database
- Location: `pkg/pipeline/steps/persist.go`
- Size target: 50-70 lines
- Dependency: Needs `sqlite.Store`

**Persistence logic:**
- Call `store.SaveResource(ctx, kind, id, resource)`
- Wrap errors with context
- Return success result

**Considerations:**
- Generic step `PersistStep[T]`
- Store injected via constructor
- Kind extracted from resource or passed in constructor

---

## File Structure

```
backend/services/stigmer-server/pkg/pipeline/steps/
├── validation.go (✅ exists from T01)
├── validation_test.go (✅ exists)
├── slug.go (⏳ new)
├── slug_test.go (⏳ new)
├── duplicate.go (⏳ new)
├── duplicate_test.go (⏳ new)
├── audit.go (⏳ new)
├── audit_test.go (⏳ new)
├── defaults.go (⏳ new)
├── defaults_test.go (⏳ new)
├── persist.go (⏳ new)
├── persist_test.go (⏳ new)
└── README.md (📝 update)
```

**Total new files:** 10 (5 implementation + 5 test)

---

## Implementation Order

### Phase 1: Basic Steps (no dependencies)
1. ✅ **ResolveSlugStep** - Pure logic, no external dependencies
2. ✅ **SetAuditFieldsStep** - Pure logic, timestamp generation
3. ✅ **SetDefaultsStep** - Pure logic, ID generation

### Phase 2: Store-Dependent Steps
4. ✅ **PersistStep** - Needs sqlite.Store
5. ✅ **CheckDuplicateStep** - Needs sqlite.Store + findByName logic

### Phase 3: Testing & Documentation
6. ✅ Write comprehensive tests for all steps
7. ✅ Update README with all step documentation
8. ✅ Integration test with agent controller

---

## Design Patterns

### Generic Step Pattern

All steps will be generic and work with any protobuf message:

```go
// Step with no dependencies
type ResolveSlugStep[T proto.Message] struct {}

func NewResolveSlugStep[T proto.Message]() *ResolveSlugStep[T] {
    return &ResolveSlugStep[T]{}
}

func (s *ResolveSlugStep[T]) Name() string {
    return "ResolveSlug"
}

func (s *ResolveSlugStep[T]) Execute(ctx *pipeline.RequestContext[T]) pipeline.StepResult {
    // Implementation
}
```

### Step with Dependencies

```go
// Step with store dependency
type PersistStep[T proto.Message] struct {
    store *sqlite.Store
    kind  string
}

func NewPersistStep[T proto.Message](store *sqlite.Store, kind string) *PersistStep[T] {
    return &PersistStep[T]{
        store: store,
        kind:  kind,
    }
}
```

### Accessing Proto Fields

All steps need to work with `ApiResourceMetadata`. Use type assertions:

```go
func (s *ResolveSlugStep[T]) Execute(ctx *pipeline.RequestContext[T]) pipeline.StepResult {
    resource := ctx.NewState()
    
    // Type assertion to access metadata
    type HasMetadata interface {
        GetMetadata() *apiresource.ApiResourceMetadata
    }
    
    metadataResource, ok := any(resource).(HasMetadata)
    if !ok {
        return pipeline.StepResult{
            Error: pipeline.NewPipelineError(
                pipeline.ErrStepExecutionFailed,
                "ResolveSlug",
                fmt.Errorf("resource does not have metadata"),
            ),
        }
    }
    
    metadata := metadataResource.GetMetadata()
    // Work with metadata...
}
```

---

## Testing Strategy

### Unit Tests (per step)

Each step gets comprehensive test coverage:

```go
// slug_test.go
func TestResolveSlugStep(t *testing.T) {
    tests := []struct {
        name     string
        input    string
        expected string
    }{
        {"simple", "My Agent", "my-agent"},
        {"special chars", "Agent@123!", "agent-123"},
        {"unicode", "Agent 你好", "agent"},
        // ... more cases
    }
    // Run table-driven tests
}
```

### Integration Test

Create end-to-end test that runs multiple steps in pipeline:

```go
// integration_test.go
func TestAgentCreatePipeline(t *testing.T) {
    // Setup
    store := setupTestStore(t)
    agent := &agentv1.Agent{
        Metadata: &apiresource.ApiResourceMetadata{
            Name: "Test Agent",
            Org:  "test-org",
        },
    }
    
    // Build pipeline
    pipeline := pipeline.NewPipeline[*agentv1.Agent]("test").
        AddStep(NewResolveSlugStep[*agentv1.Agent]()).
        AddStep(NewCheckDuplicateStep(store, "Agent")).
        AddStep(NewSetAuditFieldsStep[*agentv1.Agent]()).
        AddStep(NewSetDefaultsStep("Agent", "ai.stigmer.agentic.agent/v1")).
        AddStep(NewPersistStep(store, "Agent")).
        Build()
    
    // Execute
    ctx := pipeline.NewRequestContext(context.Background(), agent)
    err := pipeline.Execute(ctx)
    
    // Verify
    assert.NoError(t, err)
    assert.NotEmpty(t, agent.Metadata.Id)
    assert.Equal(t, "test-agent", agent.Metadata.Slug)
}
```

---

## Success Criteria

### Functional ✅

- [ ] All 5 steps implement `PipelineStep[T]` interface
- [ ] ResolveSlugStep generates valid slugs from names
- [ ] CheckDuplicateStep detects duplicates correctly
- [ ] SetAuditFieldsStep sets timestamps and version
- [ ] SetDefaultsStep sets ID, kind, apiVersion
- [ ] PersistStep saves resources to database
- [ ] All steps are generic and work with any proto message
- [ ] Steps can be chained in pipeline

### Code Quality ✅

- [ ] All files under 100 lines (target: 40-80)
- [ ] All functions under 50 lines
- [ ] Single Responsibility Principle enforced
- [ ] Proper error wrapping with context
- [ ] Clean interfaces, dependency injection
- [ ] No hard-coded values (use constructor params)

### Testing ✅

- [ ] Unit tests for each step (>80% coverage)
- [ ] Table-driven tests for slug generation
- [ ] Mock store for duplicate check tests
- [ ] Integration test with full pipeline
- [ ] Error case handling verified
- [ ] All tests passing

### Documentation ✅

- [ ] README.md updated with all new steps
- [ ] Each step has godoc comments
- [ ] Example usage for each step
- [ ] Integration example in README

---

## Technical Considerations

### 1. Generic Type Constraints

Steps must work with `proto.Message` interface:

```go
import "google.golang.org/protobuf/proto"

type ResolveSlugStep[T proto.Message] struct {}
```

### 2. Metadata Access Pattern

Since Go doesn't have inheritance, use interface checking:

```go
type HasMetadata interface {
    GetMetadata() *apiresource.ApiResourceMetadata
}

// In Execute():
if metadataResource, ok := any(resource).(HasMetadata); ok {
    metadata := metadataResource.GetMetadata()
    // ...
}
```

### 3. Store Abstraction

Current store interface:
```go
type Store struct {
    SaveResource(ctx, kind, id string, resource proto.Message) error
    GetResource(ctx, id string, resource proto.Message) error
    ListResources(ctx, kind string) ([][]byte, error)
    ListResourcesByOrg(ctx, kind, org string) ([][]byte, error)
}
```

Steps will use these methods directly.

### 4. Slug Generation Library

Go has no built-in slug generation. Implement manually:

```go
import (
    "strings"
    "unicode"
)

func generateSlug(name string) string {
    // Lowercase
    slug := strings.ToLower(name)
    
    // Replace spaces with hyphens
    slug = strings.ReplaceAll(slug, " ", "-")
    
    // Remove non-alphanumeric except hyphens
    slug = removeNonAlphanumeric(slug)
    
    // Collapse multiple hyphens
    slug = collapseHyphens(slug)
    
    // Trim hyphens
    slug = strings.Trim(slug, "-")
    
    return slug
}
```

---

## Dependencies

### Required Imports

```go
import (
    "context"
    "fmt"
    "strings"
    "time"
    
    "github.com/stigmer/stigmer/backend/libs/go/sqlite"
    "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/pipeline"
    "github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"
    "google.golang.org/protobuf/proto"
    "google.golang.org/protobuf/types/known/timestamppb"
)
```

### No New Dependencies

All steps use existing dependencies:
- ✅ `sqlite` - already exists
- ✅ `pipeline` - created in T01
- ✅ `timestamppb` - standard protobuf library

---

## Timeline Estimate

- **Phase 1 (Basic Steps):** 1.5 hours
  - ResolveSlugStep: 30 min
  - SetAuditFieldsStep: 30 min
  - SetDefaultsStep: 30 min

- **Phase 2 (Store Steps):** 1 hour
  - PersistStep: 30 min
  - CheckDuplicateStep: 30 min

- **Phase 3 (Testing):** 1.5 hours
  - Unit tests: 1 hour
  - Integration test: 30 min

**Total:** ~4 hours

---

## Next Task (T03)

After T02 completes, we'll implement agent-specific steps:
- CreateDefaultInstanceStep (calls AgentInstance controller)
- UpdateAgentStatusStep (updates agent with default_instance_id)

These steps are resource-specific (not common) and will go in:
- `backend/services/stigmer-server/pkg/controllers/steps/`

---

## References

- **Java Common Steps:** `backend/services/stigmer-service/.../RequestOperationCommonSteps.java`
- **Java Create Steps:** `backend/services/stigmer-service/.../CreateOperationSteps.java`
- **Java Agent Handler:** `backend/services/stigmer-service/.../AgentCreateHandler.java`
- **Current Go Controller:** `backend/services/stigmer-server/pkg/controllers/agent_controller.go`
- **T01 Completion:** `_projects/2026-01/20260118.01.agent-controller-pipeline/tasks/T01_1_completed.md`

---

**Status:** READY TO IMPLEMENT 🚀

This plan provides clear guidance for implementing all 5 common pipeline steps with proper testing and documentation.
