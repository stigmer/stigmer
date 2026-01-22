# Fix: Temporal Connection Resilience for Production-Grade Local Development

**Problem ID**: Temporal connection drops silently, causing all agent executions to fail indefinitely  
**Severity**: HIGH - Breaks all agent/workflow execution functionality  
**Status**: Root cause identified, fixes proposed  
**Date**: 2026-01-23

---

## Problem Summary

The stigmer server's Temporal connection is established **once at startup** and never reconnected. If:
- Temporal is unavailable at server startup
- Temporal restarts after the server has started
- Network blip causes connection loss

Then:
- All executions are created successfully in the database
- But workflows are **never started** (workflow creator is `nil`)
- Executions stay in `PENDING` phase forever
- Only a `WARN` log is emitted - no alerts, no retries, no recovery
- Tests timeout with zero visibility into the issue

This is especially problematic for local development where:
- Developers start services in different orders
- Temporal may restart during development
- Long-running test suites expect reliable execution

---

## Root Cause Analysis

### Current Implementation (`server.go:129-147`)

```go
// At server startup:
temporalClient, err := client.Dial(client.Options{
    HostPort:  cfg.TemporalHostPort,
    Namespace: cfg.TemporalNamespace,
    Logger:    temporallog.NewStructuredLogger(...),
})
if err != nil {
    log.Warn().
        Err(err).
        Msg("Failed to connect to Temporal server - workflows will not execute")
    temporalClient = nil // ❌ Set to nil - NEVER RETRIED
} else {
    defer temporalClient.Close()
}

// Only create workflow creators if client is not nil:
if temporalClient != nil {
    agentExecutionWorkflowCreator = agentexecutiontemporal.NewInvokeAgentExecutionWorkflowCreator(temporalClient, ...)
}

// Later, inject (possibly nil) creators:
agentExecutionController.SetWorkflowCreator(agentExecutionWorkflowCreator) // May be nil!
```

### What Happens When Execution is Created

```go
// create.go:468-474
if s.workflowCreator == nil {
    log.Warn().
        Str("execution_id", executionID).
        Msg("Workflow creator not available - execution will remain in PENDING (Temporal not connected)")
    return nil // ❌ Success! But workflow never starts
}
```

**Result**: Execution saved to DB, but workflow never starts. Silent failure.

---

## Why This Breaks E2E Tests

1. **Test creates execution** → `aex-01kfkmewzrf4yd4a7hdsh9zxxa` created in DB
2. **Workflow never started** → No workflow in Temporal
3. **Test polls execution status** → Forever stuck at `PENDING`
4. **Test times out after 60s** → No clear error message

**Our specific case**: stigmer server started, then restarted. On restart, Temporal connection failed (timing issue), so `workflowCreator` was `nil`. All subsequent executions failed silently.

---

## Solution: Multi-Layered Resilience

### 1. **Health Check & Automatic Reconnection** (PRIMARY FIX)

Add a background goroutine that:
- Checks Temporal connection health every 30 seconds
- Attempts reconnection if disconnected
- Reinitializes workflow creators when reconnected
- Logs connection state changes

**Implementation**:

```go
// New function in server.go
func (s *Server) startTemporalHealthMonitor(ctx context.Context, cfg *Config) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            s.checkAndReconnectTemporal(cfg)
        }
    }
}

func (s *Server) checkAndReconnectTemporal(cfg *Config) {
    // If we have a client, check if it's still healthy
    if s.temporalClient != nil {
        // Try a lightweight ping (workflow list with limit 1)
        _, err := s.temporalClient.ListWorkflows(...)
        if err == nil {
            return // All good
        }
        
        log.Warn().Err(err).Msg("Temporal connection unhealthy, attempting reconnection")
        s.temporalClient.Close()
        s.temporalClient = nil
    }
    
    // Attempt connection
    client, err := client.Dial(client.Options{
        HostPort:  cfg.TemporalHostPort,
        Namespace: cfg.TemporalNamespace,
        Logger:    temporallog.NewStructuredLogger(...),
    })
    
    if err != nil {
        log.Warn().Err(err).Msg("Temporal reconnection failed, will retry in 30s")
        return
    }
    
    log.Info().Msg("✅ Temporal reconnected successfully")
    
    // Reinitialize workflow creators
    s.temporalClient = client
    s.reinitializeWorkflowCreators(client)
    
    // Restart workers
    s.restartWorkers(client)
}

func (s *Server) reinitializeWorkflowCreators(client client.Client) {
    // Recreate agent execution workflow creator
    agentExecutionTemporalConfig := agentexecutiontemporal.NewConfig()
    agentExecutionWorkflowCreator := agentexecutiontemporal.NewInvokeAgentExecutionWorkflowCreator(
        client,
        agentExecutionTemporalConfig,
    )
    s.agentExecutionController.SetWorkflowCreator(agentExecutionWorkflowCreator)
    
    // Recreate workflow execution workflow creator
    workflowExecutionTemporalConfig := workflowexecutiontemporal.LoadConfig()
    workflowExecutionWorkflowCreator := workflowexecutionworkflows.NewInvokeWorkflowExecutionWorkflowCreator(
        client,
        workflowExecutionTemporalConfig.StigmerQueue,
        workflowExecutionTemporalConfig.RunnerQueue,
    )
    s.workflowExecutionController.SetWorkflowCreator(workflowExecutionWorkflowCreator)
    
    log.Info().Msg("✅ Workflow creators reinitialized")
}
```

### 2. **Retry Logic in Workflow Creation** (SECONDARY FIX)

Make workflow creation more resilient:

```go
// create.go: Retry workflow creation on transient failures
func (s *startWorkflowStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
    execution := ctx.NewState()
    executionID := execution.GetMetadata().GetId()

    if s.workflowCreator == nil {
        return fmt.Errorf("Temporal not connected - execution cannot start") // ❌ FAIL FAST
    }

    // Retry logic for transient failures
    var lastErr error
    for attempt := 1; attempt <= 3; attempt++ {
        err := s.workflowCreator.Create(execution)
        if err == nil {
            return nil // Success
        }
        
        lastErr = err
        if isTemporalConnectionError(err) {
            log.Warn().
                Err(err).
                Int("attempt", attempt).
                Str("execution_id", executionID).
                Msg("Temporal connection error, retrying...")
            time.Sleep(time.Duration(attempt) * time.Second)
            continue
        }
        
        // Non-retryable error
        return err
    }
    
    return fmt.Errorf("failed to start workflow after 3 attempts: %w", lastErr)
}
```

### 3. **Fail Fast Instead of Silent Degradation** (OPTION)

**Alternative approach**: Make Temporal required for execution creation:

```go
// If Temporal is not connected, REJECT execution creation
if s.workflowCreator == nil {
    return status.Errorf(
        codes.Unavailable,
        "Temporal is unavailable - executions cannot be created. Please try again later.",
    )
}
```

**Pros**: Clear error to users immediately  
**Cons**: Less graceful than auto-reconnect

---

## Recommended Implementation Plan

### Phase 1: Immediate Fix (For E2E Tests)
1. Add health check + automatic reconnection
2. Make workflow creator reinitialization atomic
3. Add clear logging when Temporal state changes

### Phase 2: Enhanced Reliability
1. Add retry logic in workflow creation
2. Implement exponential backoff for reconnection attempts
3. Add metrics/alerts for Temporal health

### Phase 3: Production Hardening
1. Connection pooling for Temporal clients
2. Circuit breaker pattern for Temporal calls
3. Queue executions for retry when Temporal is down

---

## Testing Strategy

### Unit Tests
- Test reconnection logic
- Test workflow creator reinitialization
- Test health check failure scenarios

### Integration Tests
1. **Test: Temporal starts after server**
   - Start stigmer server
   - Start Temporal 10s later
   - Create execution → Should succeed

2. **Test: Temporal restarts mid-test**
   - Create execution 1 → Success
   - Restart Temporal
   - Create execution 2 → Should retry and succeed

3. **Test: Temporal unavailable for extended period**
   - Stop Temporal
   - Create execution → Should fail immediately (if fail-fast enabled)

### E2E Test Improvements
- Add explicit Temporal connectivity check before test suite
- Add timeout with better error messages showing current phase
- Print Temporal connection status in test output

---

## Files to Modify

1. **`backend/services/stigmer-server/pkg/server/server.go`**
   - Add health monitor goroutine
   - Add reconnection logic
   - Make workflow creators reinitializable

2. **`backend/services/stigmer-server/pkg/domain/agentexecution/controller/create.go`**
   - Add retry logic
   - Return error instead of warning on nil creator (fail-fast option)

3. **`test/e2e/stigmer_server_manager_test.go`**
   - Add Temporal connectivity verification
   - Add retry logic for server startup

4. **`test/e2e/helpers_test.go`**
   - Improve timeout error messages with current phase
   - Add Temporal health check utility

---

## Benefits

✅ **Zero-downtime reconnection** - Server auto-recovers from Temporal issues  
✅ **Clear error messages** - Developers know immediately when Temporal is down  
✅ **Test reliability** - E2E tests pass consistently regardless of startup order  
✅ **Production-ready** - Handles network issues, restarts, timing issues gracefully  
✅ **Better observability** - Clear logs showing connection state changes  

---

## Alternative: Why Not "Just Restart"?

**User asked**: "How do we make setup foolproof so users don't need to restart?"

**Our answer**: Automatic reconnection! Because:

1. **In production**: Services restart independently. Manual restarts aren't feasible.
2. **In development**: Developer experience matters. Auto-recovery is magic.
3. **In tests**: CI/CD pipelines should be resilient to timing issues.
4. **Best practice**: Cloud-native apps should handle dependency failures gracefully.

---

## Next Steps

1. **Implement Phase 1** (health check + reconnection)
2. **Test with current E2E suite** to verify fix
3. **Add logging** to track reconnection attempts
4. **Document** behavior for users

This makes Stigmer OSS local development **production-grade and developer-friendly**.
