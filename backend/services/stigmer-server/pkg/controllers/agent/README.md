# Agent Controller Package

**Purpose**: Implements gRPC handlers for Agent resource CRUD operations using the pipeline framework.

## Package Structure

```
agent/
├── agent_controller.go              # Controller struct + constructor (18 lines)
├── create.go                        # Create handler + pipeline (56 lines)
├── update.go                        # Update handler (25 lines)
├── delete.go                        # Delete handler (28 lines)
├── query.go                         # Query handlers: Get, GetByReference (76 lines)
├── agent_controller_test.go         # Tests (197 lines)
└── steps/                           # Custom pipeline steps
    ├── create_default_instance.go   # Creates default agent instance (63 lines)
    └── update_agent_status.go       # Updates agent status with instance ID (60 lines)
```

## Architecture

### Design Philosophy

This package follows **industry-standard Go practices**:

1. **Single Responsibility Principle**: Each file has ONE clear purpose
2. **Domain Package Pattern**: All agent-related code in one package (like Kubernetes, Docker)
3. **Flat Structure**: Handlers at package root, only custom steps in sub-package
4. **Small Files**: All files < 100 lines (ideal: 50-150 lines)

### Why This Structure?

**Comparison with Java Pattern:**

| Aspect | Java (Stigmer Cloud) | Go (Stigmer OSS) |
|--------|---------------------|------------------|
| **Organization** | Inner static classes | Separate files in same package |
| **File Size** | 369 lines (acceptable in Java) | 8 files, all < 100 lines |
| **Navigation** | Nested classes in one file | File-per-handler pattern |
| **Testing** | Inline test classes | Separate test file |

**Go doesn't have nested classes**, so we use files to achieve the same separation of concerns.

### Pipeline Architecture

The Create handler uses a composable pipeline pattern:

```go
func (c *AgentController) Create(ctx, agent) (*Agent, error) {
    pipeline.NewPipeline("agent-create").
        AddStep(ResolveSlug).              // 3. Generate slug
        AddStep(CheckDuplicate).           // 4. Verify uniqueness
        AddStep(SetDefaults).              // 5. Set ID, timestamps
        AddStep(Persist).                  // 6. Save to BadgerDB
        AddStep(CreateDefaultInstance).    // 8. Create default instance (TODO)
        AddStep(UpdateAgentStatus).        // 9. Update status (TODO)
        Build().Execute(ctx)
}
```

**Step Types:**

- **Common Steps** (from `backend/libs/go/grpc/request/pipeline/steps/`):
  - `ResolveSlugStep` - Generate slug from name
  - `CheckDuplicateStep` - Verify no duplicate exists
  - `SetDefaultsStep` - Set ID, kind, api_version, timestamps
  - `PersistStep` - Save to BadgerDB

- **Agent-Specific Steps** (from `steps/`):
  - `CreateDefaultInstanceStep` - Create default agent instance (TODO)
  - `UpdateAgentStatusWithDefaultInstanceStep` - Update status (TODO)

## Handler Patterns

### Create (Pipeline Pattern)
- **Why**: Complex multi-step operation with validation, duplicate checking, defaults
- **Pattern**: Pipeline with reusable + custom steps
- **File**: `create.go`

### Update (Simple Pipeline)
- **Why**: Consistent with Create, easy to extend
- **Pattern**: Pipeline with just Persist step
- **File**: `update.go`

### Delete (Direct Pattern)
- **Why**: Simple load-and-delete flow
- **Pattern**: Direct implementation (no pipeline overhead)
- **File**: `delete.go`

### Query Handlers (Direct Pattern)
- **Why**: Simple database lookups
- **Pattern**: Direct implementation
- **File**: `query.go`

## Context Keys

For inter-step communication, use constants defined in `create.go`:

```go
const (
    DefaultInstanceIDKey = "default_instance_id"
)
```

## Future Work

**TODO Steps** (when dependencies are ready):

1. **CreateDefaultInstance** - Create default agent instance
   - Requires: AgentInstance controller implementation
   - Location: `steps/create_default_instance.go`

2. **UpdateAgentStatusWithDefaultInstance** - Update agent status with instance ID
   - Requires: AgentInstance controller implementation
   - Location: `steps/update_agent_status.go`

3. **CreateIamPolicies** - Establish ownership relationships
   - Requires: IAM system implementation
   - Location: TBD (new file in `steps/`)

4. **Publish** - Publish agent creation event
   - Requires: Event system implementation
   - Location: TBD (new file in `steps/`)

## Benefits of This Architecture

### ✅ Maintainability
- Easy to find code (file names match responsibilities)
- Small files = easier to understand
- Clear separation of concerns

### ✅ Testability
- Each step can be tested independently
- Handler logic separated from pipeline construction
- Custom steps isolated in their own files

### ✅ Reusability
- Common steps shared across all resources
- Custom steps can be extracted to common library if reused

### ✅ Extensibility
- Adding new steps = just add to pipeline builder
- No need to modify existing step implementations
- Pipeline order explicit and easy to change

### ✅ Scalability
- Easy to add more agents (just create `workflow/`, `task/` packages)
- Each domain isolated in its own package
- No risk of merge conflicts (different files)

## File Size Guidelines

All files follow Go community best practices:

- ✅ **18-76 lines**: Perfect range (all handler files)
- ✅ **60-63 lines**: Ideal for step implementations
- ✅ **< 100 lines**: All files well below threshold
- ✅ **< 300 lines**: Excellent (threshold is for consideration)

**Previous**: 311 lines in one file  
**Current**: 8 files, largest is 76 lines

## Real-World Examples

This structure mirrors industry-standard Go projects:

**Kubernetes:**
```
pkg/controller/
├── deployment/
│   ├── deployment_controller.go
│   ├── sync.go
│   ├── rollback.go
│   └── util.go
```

**Our Pattern:**
```
pkg/controllers/
├── agent/
│   ├── agent_controller.go
│   ├── create.go
│   ├── update.go
│   ├── delete.go
│   └── query.go
```

## Import Usage

```go
import (
    // Import the agent package
    agentctrl "github.com/stigmer/stigmer/.../controllers/agent"
)

// Use the controller
controller := agentctrl.NewAgentController(store)
```

## Related Documentation

- **Pipeline Framework**: `backend/libs/go/grpc/request/pipeline/README.md`
- **Common Steps**: `backend/libs/go/grpc/request/pipeline/steps/README.md`
- **Implementation Guide**: `backend/services/stigmer-server/_rules/implement-stigmer-oss-handlers/`
- **ADR BadgerDB**: `docs/adr/20260118-181912-local-backend-to-use-badgerdb.md`
