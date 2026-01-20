# Learning: Temporal Controller Integration Patterns

**Date**: 2026-01-20  
**Context**: Fixing missing Temporal integration in Workflow and AgentExecution controllers  
**Impact**: CRITICAL - Prevents silent failures where infrastructure exists but isn't called

---

## Problem Discovered

**Symptom**: Infrastructure fully implemented but not working

**Specific Case**:
- ✅ Temporal workers implemented and running
- ✅ Workflows and activities implemented
- ✅ Queue configuration correct
- ❌ **Controllers NOT calling the infrastructure**

**Three Missing Integrations**:
1. **Workflow Validation**: `ValidateWorkflowSpec` step missing from Workflow Create/Update pipelines
2. **Agent Execution**: `StartWorkflow` step missing from AgentExecution Create pipeline
3. **Workflow Execution**: Already integrated (used as reference)

**Root Cause**: Infrastructure implementation (Task 7) completed workers, but controller integration was overlooked.

**Impact**: 
- Workflows created WITHOUT validation (invalid workflows persisted)
- Agent executions stuck in PENDING forever (workflows never started)
- Silent failure (no errors, just not working)

---

## Pattern 1: Integration Gap Detection

**Integration Gap**: Infrastructure exists but business logic doesn't call it.

**How It Happens**:
1. Infrastructure implemented separately (workers, workflows, activities)
2. Controllers implemented separately (pipelines, steps)
3. **Missing**: The glue code that connects them (pipeline step that calls infrastructure)

**Detection**:
```
✅ Worker running? YES
✅ Workflow implemented? YES
✅ Activities implemented? YES
❌ Controller calling workflow? NO ← INTEGRATION GAP
```

**Verification Checklist** (for ANY Temporal integration):
- [ ] Worker initialized in main.go
- [ ] Worker started after gRPC server ready
- [ ] Workflow creator/validator created
- [ ] **Creator/validator passed to controller** ← OFTEN MISSED
- [ ] **Pipeline step calls creator/validator** ← OFTEN MISSED
- [ ] Error handling for nil (graceful degradation)

**Example** (Workflow Validation Integration):

**Infrastructure** (Task 7 - Completed):
```go
// main.go
var workflowValidator *temporal.ServerlessWorkflowValidator

if temporalClient != nil {
    workflowValidator = temporal.NewServerlessWorkflowValidator(temporalClient, config)
}
```

**Controller Creation** (MISSING - Fixed):
```go
// main.go
// Before: validator not passed
workflowController := workflow.NewWorkflowController(store, nil)

// After: validator passed
workflowController := workflow.NewWorkflowController(store, nil, workflowValidator)
```

**Controller Integration** (MISSING - Fixed):
```go
// workflow/controller/create.go

// Before: validation step missing
pipeline.NewPipeline("workflow-create").
    AddStep(steps.NewValidateProtoStep()).
    // ... missing validation step
    AddStep(steps.NewResolveSlugStep()).
    Build()

// After: validation step added
pipeline.NewPipeline("workflow-create").
    AddStep(steps.NewValidateProtoStep()).          // Layer 1
    AddStep(newValidateWorkflowSpecStep(validator)). // Layer 2 ← NEW
    AddStep(steps.NewResolveSlugStep()).
    Build()
```

**Lesson**: Infrastructure alone isn't enough - verify controllers actually call it.

---

## Pattern 2: Nil-Safe Temporal Integration

**Problem**: Temporal may not be available (dev mode, Temporal down, network issues)

**Solution**: All Temporal integration steps must be nil-safe

**Pattern**:
```go
type validateWorkflowSpecStep struct {
    validator *temporal.ServerlessWorkflowValidator
}

func (s *validateWorkflowSpecStep) Execute(ctx *pipeline.RequestContext) error {
    // Skip if Temporal not available (graceful degradation)
    if s.validator == nil {
        log.Warn().Msg("Skipping workflow validation - Temporal validator not available")
        return nil  // ← Continue pipeline, just skip validation
    }
    
    // Execute validation
    validation, err := s.validator.Validate(ctx.Context(), spec)
    // ... handle result
}
```

**Key Elements**:
1. **Nil Check**: First line of Execute checks if Temporal client available
2. **Warning Log**: Clear indication that step was skipped
3. **Return nil**: Pipeline continues (graceful degradation, not failure)
4. **User Impact**: Operations work without Temporal (limited functionality)

**Benefits**:
- stigmer-server can run without Temporal dependency
- Development/testing easier (no Temporal required)
- Service remains available if Temporal goes down
- Clear logs indicate what's missing

**Applied To**:
- `validateWorkflowSpecStep` - Skip validation if no validator
- `startWorkflowStep` (AgentExecution) - Skip workflow start if no creator
- `startWorkflowStep` (WorkflowExecution) - Skip workflow start if no creator

---

## Pattern 3: Pipeline Step Timing (Before vs After Persist)

**Critical Decision**: When does a pipeline step run relative to database persistence?

**Two Strategies**:

### Strategy 1: Before Persist (Validation)

**Use Case**: Validation that should prevent resource creation

**Example**: Workflow validation
```go
pipeline.NewPipeline("workflow-create").
    AddStep(ValidateProtoStep).        // 1. Layer 1 validation
    AddStep(ValidateWorkflowSpecStep).  // 2. Layer 2 validation ← BEFORE persist
    AddStep(ResolveSlugStep).
    AddStep(CheckDuplicateStep).
    AddStep(BuildNewStateStep).
    AddStep(PersistStep).               // 3. Persist ← After validation passes
    Build()
```

**Rationale**:
- Validation errors should prevent persistence
- Don't store invalid data
- Fast feedback (error before DB write)

**Error Behavior**: Validation fails → pipeline aborts → resource NOT created

### Strategy 2: After Persist (Triggering)

**Use Case**: Starting workflows that depend on persisted data

**Example**: Agent/Workflow execution triggering
```go
pipeline.NewPipeline("execution-create").
    AddStep(ValidateProtoStep).
    AddStep(BuildNewStateStep).
    AddStep(SetInitialPhaseStep).       // Set to PENDING
    AddStep(PersistStep).                // 1. Persist ← Must be first
    AddStep(StartWorkflowStep).          // 2. Trigger ← After persist
    Build()
```

**Rationale**:
- Temporal activities query database for execution details
- Execution must exist before workflow queries it
- Prevents race condition (query before write completes)

**Error Behavior**: 
- Workflow start fails → execution already persisted
- Mark execution as FAILED → persist updated state
- User sees FAILED execution (not lost/missing)

**Critical Mistake** (prevented by this pattern):
```go
// ❌ WRONG ORDER - Race condition
pipeline.
    AddStep(BuildNewStateStep).
    AddStep(StartWorkflowStep).  // ← Workflow starts, activities query DB
    AddStep(PersistStep).         // ← Persist happens AFTER query (race!)
```

**Why This Fails**:
1. Workflow starts immediately
2. Activity tries to query execution from database
3. Execution not persisted yet
4. Activity fails with "execution not found"

**Decision Framework**:
```
Does the step validate or modify the resource?
    YES → BEFORE persist (prevent invalid data)
    
Does the step depend on persisted data?
    YES → AFTER persist (ensure data exists)
    
Does the step start async operations that query the resource?
    YES → AFTER persist (prevent race condition)
```

**Examples**:
- ✅ **Before Persist**: ValidateWorkflowSpec, CheckDuplicate, BuildNewState
- ✅ **After Persist**: StartWorkflow, CreateDefaultInstance (queries parent)

---

## Pattern 4: Error Handling for Failed Workflow Starts

**Problem**: If workflow start fails, what happens to the execution?

**Bad Approach** (execution lost):
```go
// ❌ BAD - Execution persisted but workflow failed, user sees nothing
func (s *startWorkflowStep) Execute(ctx) error {
    execution := ctx.NewState()
    
    if err := s.workflowCreator.Create(execution); err != nil {
        return err  // ← Execution stays PENDING, never transitions
    }
}
```

**Good Approach** (execution visible as FAILED):
```go
// ✅ GOOD - Execution marked FAILED, user sees error
func (s *startWorkflowStep) Execute(ctx) error {
    execution := ctx.NewState()
    executionID := execution.GetMetadata().GetId()
    
    if err := s.workflowCreator.Create(execution); err != nil {
        log.Error().Err(err).Str("execution_id", executionID).
            Msg("Failed to start Temporal workflow - marking execution as FAILED")
        
        // 1. Mark execution as FAILED
        execution.Status.Phase = EXECUTION_FAILED
        execution.Status.Error = fmt.Sprintf("Failed to start Temporal workflow: %v", err)
        
        // 2. Persist FAILED state
        kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
        if updateErr := s.store.SaveResource(ctx.Context(), kind, executionID, execution); updateErr != nil {
            return grpclib.InternalError(updateErr, "failed to start workflow and update status")
        }
        
        // 3. Return error (gRPC will return error to user)
        return grpclib.InternalError(err, "failed to start workflow")
    }
    
    return nil
}
```

**Why This Pattern?**
- **User Visibility**: User sees execution in FAILED state (not stuck PENDING)
- **Error Message**: Clear indication of what went wrong
- **Debugging**: Failed executions queryable in database
- **Observability**: Can track workflow start failure rate

**Error Handling Steps**:
1. Log error with context (execution ID, error details)
2. Update execution status to FAILED with error message
3. Persist updated execution to database
4. Return gRPC error to user

**Applied To**:
- `startWorkflowStep` (AgentExecution)
- `startWorkflowStep` (WorkflowExecution)

---

## Pattern 5: Validator vs Creator Injection

**Two Types of Temporal Integration**:

### 1. Validator (Synchronous)

**Use Case**: Validating data before creation

**Injection**:
```go
type WorkflowController struct {
    store     *badger.Store
    validator *temporal.ServerlessWorkflowValidator  // ← Validator
}

func NewWorkflowController(store, client, validator) *WorkflowController {
    return &WorkflowController{
        validator: validator,  // Injected from main.go
    }
}
```

**Usage**:
```go
// In pipeline step
validation, err := s.validator.Validate(ctx, spec)  // Blocks until complete
```

**Characteristics**:
- **Synchronous**: Blocks until validation complete (50-200ms)
- **Returns result**: Validation state, errors, warnings
- **Used in pipeline**: Validation step in create/update pipelines

### 2. Creator (Asynchronous)

**Use Case**: Starting workflows for long-running operations

**Injection**:
```go
type AgentExecutionController struct {
    store           *badger.Store
    workflowCreator *temporal.InvokeAgentExecutionWorkflowCreator  // ← Creator
}

// Setter pattern (controller created before Temporal client available)
func (c *AgentExecutionController) SetWorkflowCreator(creator) {
    c.workflowCreator = creator
}
```

**Usage**:
```go
// In pipeline step
err := s.workflowCreator.Create(execution)  // Returns immediately
```

**Characteristics**:
- **Asynchronous**: Returns immediately, workflow runs in background
- **Fire and forget**: No return value (status updates via separate mechanism)
- **Used in pipeline**: StartWorkflow step after persist

**Decision Framework**:
```
Need validation result before proceeding?
    YES → Use Validator (synchronous)
    
Starting long-running background operation?
    YES → Use Creator (asynchronous)
```

---

## Reusable Checklist: Adding Temporal Integration to Controller

When adding Temporal integration to ANY controller:

### Phase 1: Infrastructure (Workers)
- [ ] Worker implemented in main.go
- [ ] Worker config with task queues
- [ ] Workflows registered
- [ ] Activities registered (on correct workers)
- [ ] Worker started after gRPC server ready

### Phase 2: Controller Integration ← **CRITICAL**
- [ ] Validator or Creator created in main.go
- [ ] Validator/Creator passed to controller constructor
- [ ] Controller field added for validator/creator
- [ ] Pipeline step created that calls validator/creator
- [ ] Pipeline step added to pipeline (correct position)
- [ ] Nil-safe check in pipeline step
- [ ] Error handling implemented
- [ ] Tests updated with nil validator/creator

### Phase 3: Verification
- [ ] Code compiles
- [ ] Manual test with Temporal running
- [ ] Manual test without Temporal (graceful degradation)
- [ ] Check Temporal UI (workflows visible)
- [ ] Verify error messages clear and actionable

**Common Mistake**: Completing Phase 1 and thinking you're done. **Phase 2 is critical** - controllers must call the infrastructure!

---

## Examples in Codebase

### Example 1: Workflow Validation (Validator Pattern)

**Infrastructure**: `backend/services/stigmer-server/pkg/domain/workflow/temporal/validator.go`

**Controller Integration**: `backend/services/stigmer-server/pkg/domain/workflow/controller/validate_spec_step.go`

**Pipeline**: `backend/services/stigmer-server/pkg/domain/workflow/controller/create.go` (line ~58)

### Example 2: Agent Execution (Creator Pattern)

**Infrastructure**: `backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflow_creator.go`

**Controller Integration**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go` (lines ~430-520)

**Pipeline**: Same file (line ~71)

### Example 3: Workflow Execution (Creator Pattern - Reference)

**Infrastructure**: `backend/services/stigmer-server/pkg/domain/workflowexecution/temporal/workflows/workflow_creator.go`

**Controller Integration**: `backend/services/stigmer-server/pkg/domain/workflowexecution/controller/create.go` (lines ~410-480)

**Pipeline**: Same file (line ~76)

---

## When to Apply These Patterns

**Future Temporal Integrations** (if any):
- New validation workflows (e.g., agent validation, session validation)
- New execution workflows (e.g., batch execution, scheduled execution)
- New activity integrations (e.g., external API calls, data processing)

**Other Infrastructure Integrations** (general lesson):
- Message queue workers (Kafka, RabbitMQ)
- Background job processors
- External service clients
- Any "infrastructure exists but controllers don't call it" scenario

---

## Key Takeaway

**Infrastructure alone is not enough. Controllers must call it.**

When implementing any infrastructure:
1. ✅ Build the infrastructure (workers, clients, services)
2. ✅ **Integrate into business logic** (controllers, handlers, pipelines)
3. ✅ Verify end-to-end (infrastructure called and working)

**The integration gap is easy to miss** - especially when infrastructure and business logic are implemented separately or by different people/sessions.

**Prevention**: Always ask after infrastructure work: "Where/how is this called from the business logic?"

---

**Files Changed** (for reference):
```
M backend/services/stigmer-server/pkg/domain/workflow/controller/workflow_controller.go
A backend/services/stigmer-server/pkg/domain/workflow/controller/validate_spec_step.go (NEW)
M backend/services/stigmer-server/pkg/domain/workflow/controller/create.go
M backend/services/stigmer-server/pkg/domain/workflow/controller/update.go
M backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go
M backend/services/stigmer-server/cmd/server/main.go
```

**Changelog**: `_changelog/2026-01/2026-01-20-222214-integrate-temporal-validation-and-execution.md`
