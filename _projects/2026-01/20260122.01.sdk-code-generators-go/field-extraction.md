# Task Config Field Extraction

**Source**: `sdk/go/workflow/_legacy/task.go` and `task_agent_call.go`  
**Purpose**: Extract all fields to create complete JSON schemas  
**Date**: 2026-01-22

---

## Common Pattern

**All task configs have**:
```go
ImplicitDependencies map[string]bool
```

This tracks TaskFieldRef usage for automatic dependency detection.

---

## Task Configs

### 1. SetTaskConfig (Line 254)

```go
type SetTaskConfig struct {
	// Variables to set in workflow state
	Variables map[string]string
	
	// Implicit dependencies
	ImplicitDependencies map[string]bool
}
```

**Fields**:
- `Variables` - map[string]string - Required
- `ImplicitDependencies` - map[string]bool - Internal tracking

---

### 2. HttpCallTaskConfig (Line 409)

```go
type HttpCallTaskConfig struct {
	Method         string            // HTTP method (GET, POST, PUT, DELETE, PATCH)
	URI            string            // HTTP endpoint URI
	Headers        map[string]string // HTTP headers
	Body           map[string]any    // Request body (JSON)
	TimeoutSeconds int32             // Request timeout in seconds
	
	ImplicitDependencies map[string]bool
}
```

**Fields**:
- `Method` - string - Required - Enum: GET, POST, PUT, DELETE, PATCH
- `URI` - string - Required
- `Headers` - map[string]string - Optional
- `Body` - map[string]any - Optional
- `TimeoutSeconds` - int32 - Optional - Default: 30
- `ImplicitDependencies` - map[string]bool - Internal

---

### 3. GrpcCallTaskConfig (Line 628)

Need to extract...

### 4. SwitchTaskConfig (Line 702)

Need to extract...

### 5. ForTaskConfig (Line 790)

Need to extract...

### 6. ForkTaskConfig (Line 853)

Need to extract...

### 7. TryTaskConfig (Line 915)

Need to extract...

### 8. ListenTaskConfig (Line 990)

Need to extract...

### 9. WaitTaskConfig (Line 1038)

Need to extract...

### 10. CallActivityTaskConfig (Line 1165)

Need to extract...

### 11. RaiseTaskConfig (Line 1224)

Need to extract...

### 12. RunTaskConfig (Line 1297)

Need to extract...

### 13. AgentCallTaskConfig

Need to extract from task_agent_call.go...

---

## Status

- ✅ SetTaskConfig extracted
- ✅ HttpCallTaskConfig extracted
- ⏳ Remaining 11 configs pending extraction
