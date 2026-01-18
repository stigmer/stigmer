# YAML Format Reference

## Overview

Zigflow executes CNCF Serverless Workflow DSL 1.0.0 format. This is the ONLY supported format.

**Supported:** CNCF DSL 1.0.0  
**Not Supported:** CNCF Serverless Workflow 0.8  
**Future:** Stigmer simplified DSL (Phase 5, not implemented)

---

## DSL 1.0.0 Format

### Basic Structure

```yaml
document:
  dsl: '1.0.0'                 # Required version identifier
  namespace: my-namespace       # Workflow namespace
  name: my-workflow            # Workflow name
  version: '1.0.0'             # Workflow version
  description: What it does    # Optional description
do:
  - taskName:
      # task definition
```

### Required Fields

- `document.dsl` - Must be `'1.0.0'`
- `document.namespace` - Logical grouping
- `document.name` - Workflow identifier
- `document.version` - Workflow version

### Task Types

#### Set Task

Manipulates workflow state without external calls.

```yaml
do:
  - setValue:
      set:
        message: "Hello"
        status: "running"
        count: 42
```

**Use cases:**
- Initialize variables
- Transform data
- Update state

#### Call HTTP

Makes HTTP requests (requires activity registration).

```yaml
do:
  - callAPI:
      call: http
      with:
        method: GET
        uri: https://api.example.com/data
```

**Requirements:**
- `CallHTTP` activity must be registered in worker
- Endpoint must be accessible
- Requires activity options (timeout, retry)

#### For Loop

Iterates over collections.

```yaml
do:
  - processItems:
      for:
        each: item
        in: ${ .items }
        do:
          - handleItem:
              set:
                processed: ${ .item }
```

#### Switch

Conditional branching.

```yaml
do:
  - checkValue:
      switch:
        - when: ${ .value > 10 }
          then:
            - handleHigh:
                set:
                  category: "high"
        - when: ${ .value <= 10 }
          then:
            - handleLow:
                set:
                  category: "low"
```

#### Fork

Parallel execution.

```yaml
do:
  - parallelTasks:
      fork:
        branches:
          - branch1:
              do:
                - task1:
                    set:
                      result1: "done"
          - branch2:
              do:
                - task2:
                    set:
                      result2: "done"
```

---

## Format Evolution

### CNCF 0.8 (Not Supported)

Old format with state-based execution:

```yaml
id: workflow-id
specVersion: "0.8"     # ← Old format identifier
start: startState
states:
  - name: startState
    type: operation
    actions: [...]
```

**Why not supported:**
- Different schema (`specVersion` vs `document.dsl`)
- State-based vs task-based execution
- Incompatible with Zigflow loader

**Conversion required:** See [conversion guide](#converting-from-08)

### DSL 1.0.0 (Current)

Task-based execution with document metadata:

```yaml
document:
  dsl: '1.0.0'        # ← New format identifier
  namespace: default
  name: my-workflow
do:
  - task1: {...}
```

**Advantages:**
- More concise syntax
- Clearer task structure
- Better tooling support
- Active development

### Stigmer DSL (Planned, Phase 5)

Simplified user-facing syntax that compiles to DSL 1.0.0:

```yaml
# Conceptual - not implemented yet
workflow: my-workflow
steps:
  - get: https://api.example.com/data
  - if: response.status == "success"
    then:
      - notify: "Success!"
```

**Status:** Not implemented  
**Timeline:** Phase 5 (future)  
**Architecture:** Compiler converts to DSL 1.0.0 before execution

---

## Converting from 0.8

### State-Based to Task-Based

**0.8 Format:**
```yaml
states:
  - name: myState
    type: operation
    actions:
      - functionRef:
          refName: myFunction
          arguments:
            key: value
```

**DSL 1.0.0:**
```yaml
do:
  - myState:
      set:
        key: value
```

### Operation State → Set Task

**0.8:**
```yaml
states:
  - name: processData
    type: operation
    actions:
      - functionRef:
          refName: process
          arguments:
            data: ${ .input }
```

**DSL 1.0.0:**
```yaml
do:
  - processData:
      set:
        data: ${ .input }
        processed: true
```

### Switch State → Switch Task

**0.8:**
```yaml
states:
  - name: checkValue
    type: switch
    dataConditions:
      - condition: ${ .value > 10 }
        transition: highValue
      - condition: ${ .value <= 10 }
        transition: lowValue
```

**DSL 1.0.0:**
```yaml
do:
  - checkValue:
      switch:
        - when: ${ .value > 10 }
          then:
            - highValue: {...}
        - when: ${ .value <= 10 }
          then:
            - lowValue: {...}
```

---

## Validation

### Code Enforcement

From `pkg/zigflow/loader.go`:

```go
// Validates DSL version must be >= 1.0.0 and < 2.0.0
c, err := semver.NewConstraint(">= 1.0.0, <2.0.0")
v, err := semver.NewVersion(wf.Document.DSL)

if !c.Check(v) {
    return nil, fmt.Errorf("%w: %s", ErrUnsupportedDSL, wf.Document.DSL)
}
```

**Requirement:** `document.dsl` field with version `1.x.x`

### Common Errors

**Missing document section:**
```
Error: invalid memory address or nil pointer dereference
Cause: No document.dsl field (likely 0.8 format)
Fix: Add document section with dsl: '1.0.0'
```

**Wrong version:**
```
Error: unsupported DSL version: 0.8
Cause: specVersion instead of document.dsl
Fix: Use document.dsl: '1.0.0'
```

**Invalid task structure:**
```
Error: failed to build workflow
Cause: Incorrect task syntax
Fix: Check task type matches DSL 1.0.0 spec
```

---

## Working Examples

### Minimal Workflow

```yaml
document:
  dsl: '1.0.0'
  namespace: test
  name: minimal
  version: '1.0.0'
do:
  - hello:
      set:
        message: "Hello, World!"
```

### Multi-Task Workflow

```yaml
document:
  dsl: '1.0.0'
  namespace: examples
  name: multi-task
  version: '1.0.0'
do:
  - initialize:
      set:
        started: true
  - processData:
      set:
        data: ${ .input }
        processed: true
  - finalize:
      set:
        completed: true
```

### HTTP Call Example

```yaml
document:
  dsl: '1.0.0'
  namespace: api-calls
  name: github-api
  version: '1.0.0'
do:
  - fetchRepo:
      call: http
      with:
        method: GET
        uri: https://api.github.com/repos/leftbin/stigmer
```

**Note:** Requires `CallHTTP` activity registered in worker

---

## References

**Working examples in codebase:**
- `test/simple-http-workflow.yaml` - HTTP call example
- `example-workflow.yaml` - Set task example
- `test/golden/01-operation-basic.yaml` - Multi-task example

**CNCF Specification:**
- [DSL 1.0.0 Spec](https://github.com/serverlessworkflow/specification)
- [Task Types](https://github.com/serverlessworkflow/specification/blob/main/dsl-reference)

**Code References:**
- `pkg/zigflow/loader.go` - YAML parsing and validation
- `pkg/zigflow/tasks/` - Task type implementations
- `pkg/executor/temporal_workflow.go` - Workflow execution
