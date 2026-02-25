---
name: Fix WaitTask test assertion
overview: Fix the single failing test `TestProtoToYAML_WaitTask` by updating its assertion to match the actual converter output format.
todos:
  - id: fix-assertion
    content: "Update the assert on line 295 of proto_to_yaml_test.go from `\"wait: 5\"` to `\"seconds: 5\"`"
    status: completed
  - id: verify
    content: Re-run `make check` to confirm all tests pass
    status: completed
isProject: false
---

# Fix TestProtoToYAML_WaitTask Assertion

## Problem

`make check` exits with code 2 due to **one test failure**:

- **Test:** `TestProtoToYAML_WaitTask`  
- **File:** [backend/services/workflow-runner/pkg/converter/proto_to_yaml_test.go](backend/services/workflow-runner/pkg/converter/proto_to_yaml_test.go), line 295
- **Error:** The generated YAML contains `wait:\n    seconds: 5` but the assertion expects `"wait: 5"`

The converter `convertWaitTask` in [task_converters.go](backend/services/workflow-runner/pkg/converter/task_converters.go) (line 195) correctly produces a nested duration map (`wait: { seconds: 5 }`). The test assertion is stale.

## Fix

In `proto_to_yaml_test.go` line 295, change:

```go
assert.Contains(t, yaml, "wait: 5")
```

to:

```go
assert.Contains(t, yaml, "seconds: 5")
```

This aligns with the converter's structured duration output and is consistent with the passing `TestProtoToYAML_ComplexWorkflow` test which also validates the `seconds: N` format.

## Verification

Re-run `make check` (or just the converter package tests) to confirm all tests pass.
