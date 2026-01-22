# TODO: Java Implementation for Callback Token Handling

**Status**: 🟡 PENDING  
**Priority**: High  
**Repository**: stigmer-cloud (Java backend)  
**Created**: 2026-01-22  
**Related**: Phase 3 - Stigmer Service (Java)

---

## Overview

The Go implementation (Stigmer OSS) now supports the `callback_token` field for async activity completion. This TODO tracks the equivalent implementation needed in the Java backend (stigmer-cloud).

**Go Implementation Completed**: ✅  
**Java Implementation**: ⏳ Pending

---

## What Was Done in Go (Stigmer OSS)

### 1. Proto Definition ✅
- Added `callback_token` field to `AgentExecutionSpec` in `spec.proto`
- Field number: 6
- Type: `bytes`
- Location: `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto`

### 2. Proto Code Generation ✅
- Go stubs regenerated successfully
- `CallbackToken []byte` field available
- `GetCallbackToken()` accessor method available

### 3. Create Handler Logging ✅
- File: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go`
- Added logging in `startWorkflowStep.Execute()` method
- Logs token presence, preview (Base64, truncated), and length
- Token automatically persisted as part of `AgentExecutionSpec`
- Token automatically passed to workflow via full `AgentExecution` object

### 4. No Workflow Changes Needed ✅
- Workflow already receives full `AgentExecution` object
- Token accessible via `execution.GetSpec().GetCallbackToken()`
- No code changes needed in workflow creator

---

## What Needs to Be Done in Java (stigmer-cloud)

### Phase 3: Stigmer Service (Java) - Backend Integration

#### Step 1: Regenerate Java Proto Stubs
**File**: `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/agentexecution/v1/AgentExecutionSpec.java`

**Action**:
```bash
cd /Users/suresh/scm/github.com/leftbin/stigmer-cloud
make protos
```

**Expected Result**:
- `AgentExecutionSpec` class will have `getCallbackToken()` method
- Returns `com.google.protobuf.ByteString`

**Current Status**: ❌ Java proto stubs DO NOT have callback_token field yet  
**Blocker**: Proto generation server timeout (observed during Phase 3 attempt)

**Alternative**: Manual proto generation or fix server issue

---

#### Step 2: Add Logging in AgentExecutionCreateHandler

**File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionCreateHandler.java`

**Location**: In the `StartWorkflowStep.execute()` method (around line 525)

**Code to Add** (before `workflowCreator.create(execution)` call):

```java
// Log callback token if present (for async activity completion pattern)
// See: docs/adr/20260122-async-agent-execution-temporal-token-handshake.md
ByteString callbackToken = execution.getSpec().getCallbackToken();
if (callbackToken != null && !callbackToken.isEmpty()) {
    // Log token for debugging (Base64 encoded, truncated for security)
    String tokenBase64 = Base64.getEncoder().encodeToString(callbackToken.toByteArray());
    String tokenPreview = tokenBase64.length() > 20 
        ? tokenBase64.substring(0, 20) + "..." 
        : tokenBase64;
    
    log.info("📝 Callback token present for execution: {} - token_preview: {}, token_length: {} - workflow will complete external activity on finish",
        executionId, tokenPreview, callbackToken.size());
}
```

**Required Import**:
```java
import com.google.protobuf.ByteString;
import java.util.Base64;
```

---

#### Step 3: Verify Token Flow

**No code changes needed** - Token is automatically handled:

1. ✅ **Received**: Token arrives in `AgentExecutionSpec.callback_token` field
2. ✅ **Persisted**: Token saved to MongoDB as part of `AgentExecution.spec`
3. ✅ **Passed to Workflow**: Full `AgentExecution` object passed to workflow
4. ✅ **Accessible in Workflow**: Workflow can access via `execution.getSpec().getCallbackToken()`

---

### Phase 4: Stigma Workflow (Java) - Completion Logic

**File**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/temporal/workflow/InvokeAgentExecutionWorkflowImpl.java`

**Current Status**: ⏳ Not yet implemented

**What Needs to Be Done**:

1. **Success Path**: At the end of successful execution, check if token exists and complete the external activity
2. **Failure Path**: In exception handler, check if token exists and fail the external activity
3. **Delegate to System Activity**: Use deterministic system activity to call `ActivityCompletionClient`

**Implementation Notes**:
- Token is available via `execution.getSpec().getCallbackToken()`
- Must delegate completion to System Activity (for determinism)
- Handle null/empty token gracefully (backward compatibility)

**Reference**: See Phase 4 implementation plan in `tasks/T01_0_plan.md` lines 160-213

---

### Phase 5: System Activity (Java) - ActivityCompletionClient

**Files**:
- Interface: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/activities/SystemActivities.java`
- Implementation: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/activities/SystemActivitiesImpl.java`

**Current Status**: ⏳ Not yet implemented

**What Needs to Be Done**:

1. Create `SystemActivities` interface with completion methods
2. Implement using `io.temporal.client.ActivityCompletionClient`
3. Register activity worker
4. Add error handling and logging

**Reference**: See Phase 5 implementation plan in `tasks/T01_0_plan.md` lines 215-266

---

## Architecture Comparison

### Go Implementation (Stigmer OSS)

```go
// In create.go - startWorkflowStep.Execute()
callbackToken := execution.GetSpec().GetCallbackToken()
if len(callbackToken) > 0 {
    tokenBase64 := base64.StdEncoding.EncodeToString(callbackToken)
    tokenPreview := tokenBase64
    if len(tokenPreview) > 20 {
        tokenPreview = tokenPreview[:20] + "..."
    }
    
    log.Info().
        Str("execution_id", executionID).
        Str("token_preview", tokenPreview).
        Int("token_length", len(callbackToken)).
        Msg("📝 Callback token present - workflow will complete external activity on finish")
}

// Workflow receives full execution
workflowCreator.Create(execution)
```

### Java Implementation (stigmer-cloud) - TO BE DONE

```java
// In AgentExecutionCreateHandler.StartWorkflowStep.execute()
ByteString callbackToken = execution.getSpec().getCallbackToken();
if (callbackToken != null && !callbackToken.isEmpty()) {
    String tokenBase64 = Base64.getEncoder().encodeToString(callbackToken.toByteArray());
    String tokenPreview = tokenBase64.length() > 20 
        ? tokenBase64.substring(0, 20) + "..." 
        : tokenBase64;
    
    log.info("📝 Callback token present for execution: {} - token_preview: {}, token_length: {} - workflow will complete external activity on finish",
        executionId, tokenPreview, callbackToken.size());
}

// Workflow receives full execution
workflowCreator.create(execution);
```

---

## Testing Checklist (After Java Implementation)

- [ ] Proto stubs regenerated successfully
- [ ] Java code compiles without errors
- [ ] Logging appears when token is present
- [ ] Token is persisted to MongoDB
- [ ] Token is accessible in workflow via `execution.getSpec().getCallbackToken()`
- [ ] Backward compatibility: executions without token work normally
- [ ] Integration test: Full flow with token handshake

---

## References

- **ADR**: `/Users/suresh/scm/github.com/stigmer/stigmer/docs/adr/20260122-async-agent-execution-temporal-token-handshake.md`
- **Go Implementation**: `backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go`
- **Java Handler**: `backend/services/stigmer-service/src/main/java/ai/stigmer/domain/agentic/agentexecution/request/handler/AgentExecutionCreateHandler.java`
- **Proto Definition**: `apis/ai/stigmer/agentic/agentexecution/v1/spec.proto`

---

## Timeline

**Phase 3 (Java Backend)**:
- Estimated Time: 2-3 hours
- Blocker: Proto generation server timeout
- Workaround: Manual proto generation or server fix

**Phase 4 (Java Workflow)**:
- Estimated Time: 4-6 hours
- Dependencies: Phase 3 complete

**Phase 5 (System Activity)**:
- Estimated Time: 3-4 hours
- Dependencies: Phase 4 complete

**Total Estimated Time**: 9-13 hours

---

## Action Items

1. **Immediate**:
   - [ ] Resolve proto generation server timeout issue
   - [ ] Regenerate Java proto stubs
   - [ ] Add logging in `AgentExecutionCreateHandler`
   - [ ] Verify token flow

2. **Next**:
   - [ ] Implement workflow completion logic (Phase 4)
   - [ ] Implement system activity (Phase 5)
   - [ ] Write integration tests

3. **Final**:
   - [ ] Documentation updates
   - [ ] Production deployment

---

**Last Updated**: 2026-01-22  
**Next Review**: After proto generation issue is resolved  
**Owner**: Backend Team (stigmer-cloud)
