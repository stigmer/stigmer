# Extract StripRuntimeEnv Into a Dedicated Pipeline Step

**Date**: March 25, 2026

## Summary

Extracted the hidden `runtime_env` clearing side-effect from `CreateExecutionContextStep` into a dedicated, separately visible `StripRuntimeEnvStep` for both `AgentExecution` and `WorkflowExecution` create pipelines. This makes the security-critical secret stripping visible at the pipeline level without requiring readers to inspect step internals.

## Problem Statement

Both `CreateExecutionContextStep` implementations (agent execution and workflow execution) silently cleared `runtime_env` from the execution state after consuming it into the `ExecutionContext`. This was a compound step doing two distinct things: creating the execution context and stripping secrets.

### Pain Points

- Reading the pipeline definition gave no indication that `runtime_env` was being cleared -- you had to read the step's source code to discover this
- The pipeline comment `// Create ExecutionContext + clear runtime_env` was the only hint, and it buried a security-critical operation behind a `+` suffix
- Violated single-responsibility: environment merge/persist is a different concern than secret stripping

## Solution

Created a new `StripRuntimeEnvStep` pipeline step for each domain (agent execution, workflow execution) and inserted it between `CreateExecutionContext` and `Persist` in both handler pipelines. Removed the clearing logic from the existing `CreateExecutionContextStep`.

## Implementation Details

### New Files

- `agentexecution/request/step/StripRuntimeEnvStep.java` -- typed for `AgentExecution`
- `workflowexecution/request/step/StripRuntimeEnvStep.java` -- typed for `WorkflowExecution`

Both steps:
- Check `execution.getSpec().getRuntimeEnvCount() > 0`
- Build a stripped copy via `.clearRuntimeEnv()` and update the pipeline context
- No-op when `runtime_env` is already empty
- Annotated with `@StepName("StripRuntimeEnv")` for tracing visibility

### Modified Files

- `CreateExecutionContextStep.java` (both domains) -- removed the clearing block, updated Javadoc to reference `StripRuntimeEnvStep` as the successor step
- `AgentExecutionCreateHandler.java` -- injected and wired `StripRuntimeEnvStep` into pipeline
- `WorkflowExecutionCreateHandler.java` -- same wiring

### Pipeline Before vs After

Before:
```
.addStep(createExecutionContextStep)  // Create ExecutionContext + clear runtime_env
.addStep(createSteps.persist)         // Persist (secrets already stripped)
```

After:
```
.addStep(createExecutionContextStep)  // Create ExecutionContext
.addStep(stripRuntimeEnvStep)         // Strip runtime_env (secrets consumed into ExecutionContext)
.addStep(createSteps.persist)         // Persist (runtime_env already stripped)
```

## Benefits

- **Pipeline transparency**: The security-critical clearing is now visible at the handler level without inspecting step internals
- **Single responsibility**: Each step does exactly one thing
- **Tracing visibility**: `StripRuntimeEnv` appears as a distinct span in OpenTelemetry traces
- **Maintainability**: Future developers can see the full execution flow by reading the pipeline builder alone

## Impact

- Both `AgentExecutionCreateHandler` and `WorkflowExecutionCreateHandler` pipelines
- No behavioral change -- the same clearing happens at the same point in the pipeline, it's just in its own step now
- No Go changes needed -- the Go workflow-runner is a client of the Java server; `runtime_env` clearing is a server-side concern

## Related Work

- [Execution Context Pipeline Step](2026-03-07-021631-execution-context-pipeline-step.md) -- original introduction of `CreateExecutionContextStep`
- [Slim Workflow Input / Runtime Env Stripping](2026-03-07-025122-slim-workflow-input-runtime-env-stripping.md) -- the security model that motivates stripping

---

**Status**: Production Ready
