# Complete Task Config Field Extraction

**Source**: Legacy manual implementations  
**Purpose**: Reference for creating complete JSON schemas  
**Date**: 2026-01-22

---

## Field Summary

### 1. SetTaskConfig ✅
- `Variables` - map[string]string - Required  
- `ImplicitDependencies` - map[string]bool - Internal (skip in schema)

### 2. HttpCallTaskConfig ✅
- `Method` - string - Required - Enum: GET, POST, PUT, DELETE, PATCH
- `URI` - string - Required
- `Headers` - map[string]string - Optional
- `Body` - map[string]any - Optional
- `TimeoutSeconds` - int32 - Optional - Default: 30
- `ImplicitDependencies` - map[string]bool - Internal (skip)

### 3. GrpcCallTaskConfig
- `Service` - string - Required
- `Method` - string - Required
- `Body` - map[string]any - Optional

### 4. SwitchTaskConfig
- `Cases` - []SwitchCase - Required
- `DefaultTask` - string - Optional

**SwitchCase** (nested type):
- `Condition` - string - Required
- `Then` - string - Required

### 5. ForTaskConfig
- `In` - string - Required (collection expression)
- `Do` - []Task - Required

### 6. ForkTaskConfig
- `Branches` - []ForkBranch - Required

**ForkBranch** (nested type):
- `Name` - string - Required
- `Tasks` - []Task - Required

### 7. TryTaskConfig
- `Tasks` - []Task - Required
- `Catch` - []CatchBlock - Required

**CatchBlock** (nested type):
- `Errors` - []string - Required
- `As` - string - Required
- `Tasks` - []Task - Required

### 8. ListenTaskConfig
- `Event` - string - Required

### 9. WaitTaskConfig
- `Duration` - string - Required (e.g., "5s", "1m", "1h")

### 10. CallActivityTaskConfig
- `Activity` - string - Required
- `Input` - map[string]any - Optional

### 11. RaiseTaskConfig
- `Error` - string - Required (error type)
- `Message` - string - Required (error message)
- `Data` - map[string]any - Optional

### 12. RunTaskConfig
- `WorkflowName` - string - Required
- `Input` - map[string]any - Optional

### 13. AgentCallTaskConfig
- `Agent` - AgentRef - Required (complex type)
- `Message` - string - Required
- `Env` - map[string]string - Optional
- `Config` - *AgentExecutionConfig - Optional (nested)

**AgentExecutionConfig** (nested type):
- `Model` - string - Optional
- `Timeout` - int32 - Optional (1-3600, default: 300)
- `Temperature` - float32 - Optional (0.0-1.0, default: 0.7)

---

## Notes

**ImplicitDependencies**:
- Present in SetTaskConfig and HttpCallTaskConfig in legacy code
- Used for internal dependency tracking
- **Decision**: Don't include in schemas (generated code doesn't need it for now)

**Complex Types**:
- AgentRef: Skip for now (use string slug instead)
- Task arrays: Need to decide how to represent in schemas
- Nested messages: Need proper schema structure

**Default Values**:
- HttpCallTaskConfig.TimeoutSeconds: 30
- AgentExecutionConfig.Timeout: 300
- AgentExecutionConfig.Temperature: 0.7

---

## Implementation Strategy

For simpler migration, we'll:

1. **Start simple**: Create schemas without ImplicitDependencies
2. **Add later if needed**: Can enhance generated code post-migration
3. **Focus on core fields**: Get basic functionality working first
4. **Complex types**: Simplify where possible (e.g., AgentRef → string)

---

**Status**: Field extraction complete ✅
**Next**: Create JSON schemas for all 13 task types
