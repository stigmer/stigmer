---
name: ISO 8601 Wait Semantics
overview: Replace the primitive `int32 seconds` field in WaitTaskConfig with a structured Duration message and absolute timestamp support, enabling human-readable wait specifications like "wait 1 week" or "wait until March 1st".
todos:
  - id: proto-duration
    content: Create Duration message and update WaitTaskConfig with oneof in wait.proto
    status: completed
  - id: regenerate-stubs
    content: Run make generate-proto to regenerate Go and Python stubs
    status: completed
  - id: go-converter
    content: Update convertWaitTask in task_converters.go to handle duration and until cases
    status: completed
  - id: duration-util
    content: Add ProtoToSDKDuration helper if needed for direct proto-to-SDK conversion
    status: completed
  - id: update-tests
    content: Update/add tests for duration conversion and wait task builder
    status: completed
  - id: verify-build
    content: Run make build and fix any compilation errors
    status: completed
isProject: false
---

# Gap B6: ISO 8601 Wait Semantics

## Problem

The current `WaitTaskConfig` uses `int32 seconds`, forcing users to calculate:

- "Wait 1 week" → 604800 seconds
- "Wait 2 hours" → 7200 seconds

This violates ubiquitous language and doesn't match the platform's "weeks/months" positioning.

## Solution

Replace with structured Duration message + absolute timestamp support.

## Files to Modify

### 1. Proto Definition

**File:** `[apis/ai/stigmer/agentic/workflow/v1/tasks/wait.proto](apis/ai/stigmer/agentic/workflow/v1/tasks/wait.proto)`

**Current:**

```protobuf
message WaitTaskConfig {
  int32 seconds = 1;
}
```

**New:**

```protobuf
import "google/protobuf/timestamp.proto";

// Duration represents a relative time period.
// Fields are additive: { days: 1, hours: 12 } = 36 hours total.
// At least one field must be non-zero.
message Duration {
  uint32 days = 1;
  uint32 hours = 2;
  uint32 minutes = 3;
  uint32 seconds = 4;
  uint32 milliseconds = 5;
}

message WaitTaskConfig {
  oneof wait_type {
    // Relative duration from now.
    Duration duration = 1;
    
    // Absolute timestamp to wait until.
    google.protobuf.Timestamp until = 2;
  }
}
```

### 2. Go Converter

**File:** `[backend/services/workflow-runner/pkg/converter/task_converters.go](backend/services/workflow-runner/pkg/converter/task_converters.go)`

Update `convertWaitTask` to handle both duration and until cases:

```go
func (c *Converter) convertWaitTask(cfg *tasksv1.WaitTaskConfig) map[string]interface{} {
    switch w := cfg.WaitType.(type) {
    case *tasksv1.WaitTaskConfig_Duration:
        return map[string]interface{}{
            "wait": map[string]interface{}{
                "days":         w.Duration.Days,
                "hours":        w.Duration.Hours,
                "minutes":      w.Duration.Minutes,
                "seconds":      w.Duration.Seconds,
                "milliseconds": w.Duration.Milliseconds,
            },
        }
    case *tasksv1.WaitTaskConfig_Until:
        return map[string]interface{}{
            "wait": w.Until.AsTime().Format(time.RFC3339),
        }
    default:
        return map[string]interface{}{"wait": 0}
    }
}
```

### 3. Duration Utility (if needed)

**File:** `[backend/services/workflow-runner/pkg/utils/duration.go](backend/services/workflow-runner/pkg/utils/duration.go)`

May need a new function to convert proto Duration to SDK Duration:

```go
func ProtoToSDKDuration(d *tasksv1.Duration) *model.Duration {
    if d == nil {
        return nil
    }
    return &model.Duration{
        Value: model.DurationInline{
            Days:         int(d.Days),
            Hours:        int(d.Hours),
            Minutes:      int(d.Minutes),
            Seconds:      int(d.Seconds),
            Milliseconds: int(d.Milliseconds),
        },
    }
}
```

### 4. Regenerate Stubs

```bash
make generate-proto
```

This regenerates Go and Python stubs in:

- `apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks/`
- `apis/stubs/python/stigmer/ai/stigmer/agentic/workflow/v1/tasks/`

### 5. Update Tests

**File:** `[backend/services/workflow-runner/pkg/utils/duration_test.go](backend/services/workflow-runner/pkg/utils/duration_test.go)`

Add tests for the new proto-to-SDK conversion if added.

## Validation Rules

### Duration Validation

- At least one field must be non-zero
- All fields must be non-negative (uint32 handles this)
- Use `buf.validate` CEL expression:

```protobuf
message Duration {
  option (buf.validate.message).cel = {
    id: "duration.non_zero",
    message: "at least one duration field must be non-zero",
    expression: "this.days > 0 || this.hours > 0 || this.minutes > 0 || this.seconds > 0 || this.milliseconds > 0"
  };
  // ... fields
}
```

### Until Validation

- Timestamp validation happens at runtime (Temporal handles past timestamps gracefully - immediate completion)

## YAML Output Examples

After conversion, the YAML consumed by the Serverless Workflow SDK:

```yaml
# Relative: wait 1 week
- waitForApproval:
    wait:
      days: 7

# Relative: wait 2 hours 30 minutes
- cooldownPeriod:
    wait:
      hours: 2
      minutes: 30

# Absolute: wait until specific time
- waitUntilMarketOpen:
    wait: "2026-03-02T09:30:00Z"
```

## Risk Mitigation

- **Breaking Change**: Acceptable per user confirmation (no existing users)
- **SDK Compatibility**: Serverless Workflow SDK already supports both duration structs and ISO 8601 timestamp strings in the `wait` field
- **Temporal**: `workflow.Sleep()` accepts any `time.Duration`; `time.Until(timestamp)` handles absolute times

## Out of Scope

- Business calendars ("next business day") - deferred to Phase 2
- Timeout fields in other protos (http_call, agent_call) - different semantic, not part of B6

