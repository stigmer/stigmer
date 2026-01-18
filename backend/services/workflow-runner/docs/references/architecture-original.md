# Zigflow Architecture Guide

**Last Updated**: 2026-01-08  
**Audience**: Stigmer Engineering Team  
**Purpose**: Internal reference for understanding and extending Zigflow

---

## High-Level Architecture

Zigflow is a **dynamic workflow interpreter** that translates CNCF Serverless Workflow YAML into Temporal workflow executions without requiring code deployment.

### Conceptual Model

```
User YAML Definition
      ↓
 [Parser] - Validates YAML against CNCF spec
      ↓
 [State Machine Builder] - Constructs internal graph
      ↓
 [Temporal Workflow] - Executes as durable workflow
      ↓
 [Activities] - Invokes registered functions
      ↓
 Results
```

### Key Innovation: The Interpreter Pattern

Traditional workflows require compiling code (Temporal SDKs generate Go/Java workflow code).

Zigflow **interprets** YAML at runtime:
1. Parse YAML into internal representation
2. Traverse state machine dynamically
3. Make execution decisions in workflow code
4. Maintain state in Temporal-managed variables

**Advantage**: Change workflow logic without redeploying workers.

**Trade-off**: Slight overhead from interpretation vs. compiled code.

---

## Code Structure

```
pkg/zigflow/
├── parser.go              # YAML → Internal AST
├── validator.go           # CNCF spec compliance checks
├── state_machine.go       # State graph construction
├── executor.go            # Main Temporal workflow logic
├── activity_registry.go   # Maps CNCF functions → Temporal activities
├── expressions.go         # JSONPath expression evaluator
├── retry_policy.go        # Error handling & retry logic
└── types/
    ├── workflow.go        # CNCF Serverless Workflow structs
    └── states.go          # State definitions (Operation, Switch, etc.)
```

### Critical Files Deep Dive

#### 1. `executor.go` - The Heart of Zigflow

**Function**: `ExecuteServerlessWorkflow(ctx workflow.Context, input WorkflowInput)`

This is the **single Temporal workflow** that executes all CNCF workflows.

**Pseudocode**:
```go
func ExecuteServerlessWorkflow(ctx workflow.Context, input WorkflowInput) error {
    // Parse YAML
    workflowDef := parser.Parse(input.YAML)
    
    // Build state machine
    stateMachine := NewStateMachine(workflowDef)
    
    // Start at initial state
    currentState := workflowDef.Start
    workflowState := make(map[string]interface{})
    
    // Traverse state machine
    for currentState != nil {
        state := stateMachine.GetState(currentState)
        
        switch state.Type {
        case "operation":
            result := executeOperation(ctx, state, workflowState)
            workflowState = updateState(workflowState, result)
            currentState = state.Transition
            
        case "switch":
            nextState := evaluateConditions(state.DataConditions, workflowState)
            currentState = nextState
            
        case "foreach":
            for _, item := range state.InputCollection {
                executeActions(ctx, state.Actions, item)
            }
            currentState = state.Transition
            
        // ... other state types
        }
        
        // Check for end
        if state.End {
            break
        }
    }
    
    return nil
}
```

**Key Challenge: Deterministic Replay**

Temporal requires workflow code to be **deterministic** (same inputs → same execution path).

Zigflow solves this by:
- Storing state machine in workflow variables (not reloading from DB)
- Using `workflow.ExecuteActivity` for any non-deterministic operations
- Avoiding random numbers, timestamps, or external calls in workflow code

#### 2. `activity_registry.go` - Activity Binding

Maps CNCF function names to Temporal activities.

**Example**:
```go
// CNCF YAML references function:
functionRef: "http_call"

// Registry maps to Temporal activity:
registry.Register("http_call", activities.HTTPCallActivity)
```

**Extension Point for Phase 3**: Add AI-specific activities here.

```go
// Future Phase 3 code:
registry.Register("agent.execute", ai_activities.ExecuteAgentActivity)
registry.Register("vectordb.query", ai_activities.VectorDBQueryActivity)
```

#### 3. `expressions.go` - Data Manipulation

Evaluates JSONPath expressions in CNCF workflows.

**Example**:
```yaml
# CNCF YAML:
arguments:
  value: "${ .previous_state.output.result + 10 }"

# Expression evaluator:
# - Extracts ".previous_state.output.result" from workflow state
# - Applies "+ 10" operation
# - Returns computed value
```

**Security Note**: Expression evaluator must be sandboxed (no system calls, file access, or network).

---

## How Zigflow Integrates with Temporal

### Temporal Concepts Refresher

- **Workflow**: Durable function (survives worker crashes)
- **Activity**: Non-deterministic operation (API calls, DB queries)
- **Task Queue**: Named queue where workers poll for tasks
- **Signal**: External message sent to running workflow

### Zigflow's Temporal Integration

1. **Single Workflow Type**: `zigflow_workflow`
   - Input: CNCF YAML (as string or reference)
   - Output: Workflow results (JSON)

2. **Activity Registration**: On worker startup, register all activities
   ```go
   func main() {
       c, _ := client.Dial(temporalHost)
       w := worker.New(c, "zigflow-tasks", worker.Options{})
       
       // Register the single workflow
       w.RegisterWorkflow(ExecuteServerlessWorkflow)
       
       // Register all activities
       w.RegisterActivity(activities.HTTPCall)
       w.RegisterActivity(activities.LogMessage)
       // ... more activities
       
       w.Run()
   }
   ```

3. **State Persistence**: Temporal automatically persists workflow state
   - Zigflow doesn't need a database for running workflows
   - State survives worker restarts, deployments, crashes

4. **Signals for Events**: CNCF event states map to Temporal signals
   ```yaml
   # CNCF YAML event state
   - name: wait_approval
     type: event
     onEvents:
       - eventRefs: ["approval_signal"]
   
   # Zigflow uses Temporal signal:
   workflow.GetSignalChannel(ctx, "approval_signal").Receive(ctx, &approvalData)
   ```

---

## Extension Points for Future Phases

### Phase 2: Claim Check Pattern

**Where to Hook In**: `executor.go` - after `workflow.ExecuteActivity` completes

**Pseudocode**:
```go
// After activity execution:
activityResult := workflow.ExecuteActivity(ctx, ...)

// NEW: Check result size
if len(activityResult) > 50KB {
    // Upload to S3
    s3Key := uploadToS3(activityResult)
    
    // Replace result with reference
    activityResult = ClaimCheckRef{Type: "s3_ref", Key: s3Key}
}

// Store in workflow state
workflowState["last_result"] = activityResult
```

**Files to Create**:
- `backend/services/workflow-runner/pkg/zigflow/claimcheck/manager.go`
- `backend/services/workflow-runner/pkg/zigflow/claimcheck/s3_store.go`

### Phase 3: AI Task Primitives

**Where to Hook In**: `activity_registry.go` - register new activity types

**Pseudocode**:
```go
// Register AI activities
registry.Register("agent.execute", ai_activities.ExecuteAgent)
registry.Register("vectordb.query", ai_activities.VectorDBQuery)
registry.Register("prompt.resolve", ai_activities.ResolvePrompt)
```

**Files to Create**:
- `backend/services/workflow-runner/pkg/zigflow/tasks/agent.go`
- `backend/services/workflow-runner/pkg/zigflow/tasks/vectordb.go`
- `backend/services/workflow-runner/pkg/zigflow/prompts/resolver.go`

### Phase 4: Stigmer Compiler Integration

**Where to Hook In**: Workflow start - fetch compiled CNCF YAML from MongoDB

**Current Flow**:
```
User submits YAML → Zigflow executes directly
```

**Phase 4 Flow**:
```
User submits Stigmer DSL → Compiler translates → MongoDB stores → Zigflow fetches → Execute
```

**Pseudocode**:
```go
func ExecuteServerlessWorkflow(ctx workflow.Context, input WorkflowInput) error {
    var cncfYAML string
    
    if input.WorkflowID != "" {
        // Fetch pre-compiled CNCF YAML from MongoDB
        cncfYAML = fetchFromMongoDB(input.WorkflowID)
    } else {
        // Direct YAML provided (backward compatibility)
        cncfYAML = input.YAML
    }
    
    // Rest of execution logic unchanged
    workflowDef := parser.Parse(cncfYAML)
    // ...
}
```

---

## Design Patterns Used

### 1. Interpreter Pattern
Zigflow interprets YAML state machines at runtime rather than generating code.

### 2. Strategy Pattern
Different state types (Operation, Switch, ForEach) implement common `State` interface.

### 3. Registry Pattern
Activity functions registered by name, allowing dynamic lookup.

### 4. Builder Pattern
State machine constructed incrementally as YAML is parsed.

---

## Performance Considerations

### Workflow History Size
Temporal stores complete execution history (for replay). Large workflows can hit 50MB history limit.

**Mitigation** (Phase 2): Claim Check pattern offloads large payloads.

### Expression Evaluation Overhead
JSONPath expressions evaluated on every state transition.

**Potential Optimization**: Cache expression ASTs (parse once, evaluate many times).

### Activity Execution Latency
Each activity call has ~10-50ms overhead (Temporal scheduling).

**Acceptable Trade-off**: Durable execution guarantees worth the latency.

---

## Debugging Guide

### Common Issues

**Issue**: Workflow stuck in "Running" state  
**Cause**: Waiting for signal that never arrives  
**Debug**: Check Temporal UI → Workflow Details → Pending Activities  
**Fix**: Send signal manually or update workflow definition

**Issue**: `BlobSizeExceeded` error  
**Cause**: Activity returned payload >2MB  
**Debug**: Check activity output size in logs  
**Fix**: Implement Claim Check pattern (Phase 2)

**Issue**: Non-deterministic error on replay  
**Cause**: Workflow code changed incompatibly  
**Debug**: Compare workflow history to current code  
**Fix**: Use versioning (`workflow.GetVersion`) for workflow changes

### Temporal UI Navigation

1. **Workflows Tab**: See all running/completed workflows
2. **Workflow Details**: Execution history (state transitions)
3. **Task Queues Tab**: Worker health, pending tasks
4. **Workers Tab**: Registered workers and activities

### Logging Best Practices

```go
// DO: Use workflow logger (recorded in history)
workflow.GetLogger(ctx).Info("Executing state", "state", stateName)

// DON'T: Use standard logger (lost on replay)
log.Println("Executing state:", stateName)
```

---

## References

- [CNCF Serverless Workflow Spec](https://github.com/serverlessworkflow/specification)
- [Temporal Go SDK Docs](https://docs.temporal.io/dev-guide/go)
- [Upstream Zigflow Repository](https://github.com/mrsimonemms/zigflow)
- [Stigmer Fork Notes](../UPSTREAM-NOTES.md)

---

**Next Steps**: Use this guide as reference for Phase 2-5 development

