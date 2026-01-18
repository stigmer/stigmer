# Workflow Validation Temporal Integration

This package contains the Temporal workflow infrastructure for serverless workflow validation during workflow creation.

## Architecture

The implementation follows a **polyglot pattern** (like InvokeWorkflowExecutionWorkflow):

- **Go (stigmer-server)**: ValidateWorkflowWorkflow (thin orchestration)
- **Go (workflow-runner)**: ValidateWorkflow activity (all business logic)
- **Task Queues**: 
  - `workflow_validation_stigmer` - Go workflows
  - `workflow_validation_runner` - Go activities

```
┌─────────────────────────────────────────────────────────────────┐
│                        Temporal Server                           │
├──────────────────────────────┬──────────────────────────────────┤
│ Queue: workflow_validation_  │ Queue: workflow_validation_      │
│        stigmer               │        runner                    │
└───────────┬──────────────────┴──────────────┬───────────────────┘
            │                                  │
            │ Workflow Tasks                   │ Activity Tasks
            ▼                                  ▼
┌──────────────────────────┐      ┌──────────────────────────────┐
│  Go Worker               │      │  Go Worker                    │
│  (stigmer-server)        │      │  (workflow-runner)            │
│                          │      │                               │
│  - ValidateWorkflow      │      │  - ValidateWorkflow (activity)│
│    Workflow (thin)       │      │    • Convert proto → YAML     │
│                          │      │    • Validate using Zigflow   │
│                          │      │    • Return validation result │
└──────────────────────────┘      └──────────────────────────────┘
            ▲
            │ Synchronous call during workflow creation
            │
┌──────────────────────────┐
│  Pipeline Step           │
│  ValidateWorkflowSpecStep│
│                          │
│  - ServerlessWorkflow    │
│    Validator (client)    │
└──────────────────────────┘
```

## Components

### ServerlessWorkflowValidator

- **Purpose**: Go client for starting ValidateWorkflowWorkflow
- **Location**: `temporal.ServerlessWorkflowValidator`
- **Usage**: Called by `ValidateWorkflowSpecStep` during workflow creation
- **Behavior**: Synchronous - blocks until validation completes (50-200ms)

**Flow:**
1. Create unique workflow ID
2. Start ValidateWorkflowWorkflow on `workflow_validation_stigmer` queue
3. Pass activity queue via memo (`workflow_validation_runner`)
4. Block until validation completes
5. Return ServerlessWorkflowValidation result

### Config

- **Purpose**: Configuration for workflow validation task queues
- **Location**: `temporal.Config`
- **Pattern**: Environment variables with defaults
- **Properties**:
  - `StigmerQueue`: Go workflow queue (default: `workflow_validation_stigmer`)
  - `RunnerQueue`: Go activity queue (default: `workflow_validation_runner`)

### ValidateWorkflowWorkflow (Function)

- **Type**: `ValidateWorkflowWorkflow` function type
- **Implementation**: `ValidateWorkflowWorkflowImpl`
- **Pattern**: Thin orchestration (like `InvokeWorkflowExecutionWorkflow`)

**Key Design:**
- Gets activity queue from workflow memo (`getActivityTaskQueue()`)
- Configures activity options pointing to Go worker
- Calls ONE activity (`validateWorkflow`)
- Returns result directly

**NO business logic in workflow** - just orchestration!

### ValidateWorkflowActivity (Interface)

- **Interface**: `activities.ValidateWorkflowActivity`
- **Implementation**: Go (`workflow-runner/worker/activities/validate_workflow_activity.go`)
- **Method**: `ValidateWorkflow(spec *WorkflowSpec) (*ServerlessWorkflowValidation, error)`

**Go activity does ALL the work:**
1. Convert WorkflowSpec proto → Serverless Workflow YAML
2. Validate YAML structure using Zigflow parser
3. Return ServerlessWorkflowValidation with state (VALID/INVALID/FAILED)

## Integration with ValidateWorkflowSpecStep

The validator is used in the workflow creation pipeline:

```go
// ValidateWorkflowSpecStep in create pipeline
func (s *ValidateWorkflowSpecStep) Execute(ctx context.Context, req *Request) error {
    // Layer 1: Proto validation (already done by previous step)
    
    // Layer 2: Comprehensive validation via Temporal (SINGLE SOURCE OF TRUTH)
    // Go activity converts proto → YAML + validates structure
    validation, err := s.validator.Validate(ctx, spec)
    if err != nil {
        return fmt.Errorf("failed to validate workflow: %w", err)
    }
    
    // Store result in context for later use
    ctx.Value("serverless_validation").(*ServerlessWorkflowValidation) = validation
    
    // Check validation state and return success/failure
    return handleValidationResult(validation)
}
```

## Validation Layers

### Layer 1: Proto Validation (Go)
- **Where**: `ValidateFieldConstraintsStep` (common step)
- **What**: Buf Validate rules on proto fields
- **Performance**: <50ms

### Layer 2: Comprehensive Validation (Go - SINGLE SOURCE OF TRUTH)
- **Where**: `ValidateWorkflow` activity in workflow-runner
- **What**: 
  - Converts WorkflowSpec proto → Serverless Workflow YAML
  - Validates YAML structure using Zigflow parser
- **Validates**:
  - YAML syntax
  - DSL version compatibility
  - Task types and structure
  - Required fields
  - Runtime expression syntax
- **Performance**: 50-200ms

**Why Go is the SSOT:**
- Workflow-runner with Zigflow is the authoritative validator
- No duplication of validation logic
- When Serverless Workflow DSL evolves, update only one place
- Simpler maintenance and guaranteed consistency

## Queue Naming Convention

**Format**: `{domain}_{feature}_{service}`

- **domain**: `workflow` (top-level domain)
- **feature**: `validation` (specific feature)
- **service**: `stigmer` or `runner` (which service)

**Result**: 
- `workflow_validation_stigmer` (Go workflows)
- `workflow_validation_runner` (Go activities)

## Configuration

### Environment Variables

**Go Service (stigmer-server):**
```bash
TEMPORAL_WORKFLOW_VALIDATION_STIGMER_TASK_QUEUE=workflow_validation_stigmer
TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner
```

**Go Worker (workflow-runner):**
```bash
TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner
```

## Validation States

The validation activity returns one of three states:

### VALID
- Workflow structure passed all validation layers
- May include warnings (non-blocking)
- Workflow creation proceeds

### INVALID
- User error (bad structure, missing fields, invalid task types, conversion failure)
- Validation errors are returned to user
- Workflow creation is rejected

### FAILED
- System error (converter crashed, activity timeout, Temporal failure)
- Internal server error returned to user
- Workflow creation is rejected

## Performance

- **Expected latency**: 50-200ms
- **Timeout**: 30 seconds (generous)
- **Acceptable for UX**: Yes (workflow creation is infrequent)

## Design Decisions

### 1. Polyglot Pattern (Go-Only, not Java+Go)
- **Why?** Open source is all Go, no need for Java layer
- **Trade-off**: Simpler than cloud version, consistent with OSS stack

### 2. Single Activity (Not Multiple)
- **Why?** Keeps workflow thin, all business logic in Go activity
- **Trade-off**: Activity does more work, but simpler interface

### 3. No Multiple Converters
- **Why?** Maintain single source of truth in workflow-runner
- **Trade-off**: No early validation, but eliminates inconsistency risk

### 4. Activity Queue via Memo
- **Why?** Allows configurable routing between stigmer-server and workflow-runner
- **Trade-off**: Slightly more complex setup, but follows established pattern

## Comparison with InvokeWorkflowExecutionWorkflow

Both follow the same polyglot pattern:

| Aspect | InvokeWorkflowExecution | ValidateWorkflow |
|--------|------------------------|------------------|
| Go Workflow | Thin orchestration | Thin orchestration |
| Go Activity | ExecuteWorkflow | ValidateWorkflow |
| Activity Queue | Via memo | Via memo |
| Business Logic | All in activity | All in activity |
| Task Queues | stigmer + runner | stigmer + runner |

**Consistency is key!** Both follow the same architectural patterns.

## Testing

To test the integration:

1. **Start Temporal server** (local or cloud)
2. **Configure task queues** via environment variables
3. **Start Go worker** (stigmer-server with temporal config)
4. **Start Go worker** (workflow-runner with validation activities)
5. **Create workflow** via gRPC
6. **Verify validation** executes and returns result

## Troubleshooting

### "Unknown workflow type" error
- **Cause**: Workflow type mismatch
- **Fix**: Ensure workflow name "ValidateWorkflow" matches in registration

### "Activity not registered" error
- **Cause**: Go worker not running or wrong queue
- **Fix**: Check Go worker logs, verify queue names match

### Validation timeout
- **Cause**: Go worker not running or activity takes too long
- **Fix**: Check worker logs, verify YAML conversion works

### Activity returns null
- **Cause**: Activity registration mismatch
- **Fix**: Ensure activity name is "validateWorkflow" (lowercase 'v')

## Files in this Package

- `config.go` - Configuration for task queues
- `workflow_types.go` - Workflow type constants
- `workflow.go` - ValidateWorkflowWorkflow implementation
- `validator.go` - ServerlessWorkflowValidator client
- `worker.go` - Worker configuration and registration
- `activities/validate_workflow.go` - Activity interface

## References

- **Agent Execution**: `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/` (same pattern!)
- **Workflow Runner**: `backend/services/workflow-runner/`
- **Validation Activity**: `backend/services/workflow-runner/worker/activities/validate_workflow_activity.go`
- **Temporal Documentation**: https://docs.temporal.io/
- **Polyglot Pattern**: https://docs.temporal.io/encyclopedia/polyglot-worker
