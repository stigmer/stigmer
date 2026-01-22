# Task 01: Temporal Token Handshake - Implementation Plan

**Status**: 🔍 PENDING REVIEW  
**Created**: 2026-01-22  
**Estimated Duration**: 3-4 weeks (21 days)

## Overview

Implement Temporal's async activity completion pattern to enable Zigflow (Go) to wait for actual completion of Stigma Agent (Java/Python) workflows without blocking worker threads. This uses a token handshake mechanism where Zigflow passes its activity token to Stigma, which calls back upon completion.

## Problem Being Solved

**Current State**: Zigflow calls Stigma gRPC endpoint → Receives immediate ACK → Moves to next state → Agent still running

**Desired State**: Zigflow calls Stigma → Receives ACK → Pauses activity → Agent runs → Agent completes → Zigflow resumes

**Without Blocking**: The Go worker thread is not blocked during the Agent's execution (which can take minutes to hours).

## Success Criteria

- [ ] Zigflow activities correctly wait for actual Stigma Agent completion
- [ ] Worker threads are not blocked during long-running agent execution
- [ ] System is resilient to restarts (token is durable in Temporal)
- [ ] Backward compatibility maintained (direct gRPC calls still work)
- [ ] Comprehensive test coverage (unit, integration, failure scenarios)
- [ ] Production-ready observability (metrics, alerts, logs, dashboards)
- [ ] Documentation complete (architecture, operations, troubleshooting)

## Implementation Phases

### Phase 1: Proto Definition (Days 1-2)

**Goal**: Add `callback_token` field to proto definitions and regenerate code.

**Tasks**:
1. **Update Proto File**
   - Add `bytes callback_token = 3;` to `StartAgentRequest` message
   - Document field purpose and optional nature
   - Add validation rules if needed
   - File: `apis/*/proto/stigma_service.proto` (or equivalent)

2. **Regenerate Proto Code**
   - Run proto compiler for Go target
   - Run proto compiler for Java target
   - Verify generated code compiles
   - Update any breaking changes

3. **Update Proto Documentation**
   - Document token field purpose
   - Explain optional vs required usage
   - Add examples for both direct calls and workflow calls

**Deliverables**:
- [ ] Proto file updated with `callback_token` field
- [ ] Go proto code regenerated and compiling
- [ ] Java proto code regenerated and compiling
- [ ] Proto documentation updated

**Acceptance Criteria**:
- Proto compiles without errors in both Go and Java
- Field is optional (backward compatible)
- Documentation clearly explains token usage

---

### Phase 2: Zigflow (Go) Activity Implementation (Days 3-4)

**Goal**: Update Zigflow's `ExecuteAgent` activity to extract task token, pass it to Stigma, and return `ErrResultPending`.

**Tasks**:
1. **Update Activity Function**
   - Extract task token: `activityInfo := activity.GetInfo(ctx)` → `taskToken := activityInfo.TaskToken`
   - Pass token in gRPC request: `CallbackToken: taskToken`
   - Return pending status: `return nil, activity.ErrResultPending`
   - Handle errors before returning pending

2. **Add Logging**
   - Log token (Base64 encoded) at activity start
   - Log gRPC call result (ACK received)
   - Log return of pending status
   - Include correlation IDs for tracing

3. **Set Timeouts**
   - Configure `StartToCloseTimeout` (recommend 24 hours)
   - Document timeout rationale
   - Add timeout configuration to activity options

4. **Error Handling**
   - Immediate failure if gRPC call fails
   - Return error (not pending) if Stigma service is unreachable
   - Add retry logic for transient failures

**Code Location**:
- File: `zigflow/activities/stigma_activity.go` (or equivalent)
- Function: `ExecuteAgent(ctx context.Context, input StigmaTaskInput) (interface{}, error)`

**Deliverables**:
- [ ] Activity extracts and passes task token
- [ ] Activity returns `ErrResultPending` on success
- [ ] Comprehensive logging at each step
- [ ] Timeout configured (24 hours)
- [ ] Unit tests with mock Stigma client

**Acceptance Criteria**:
- Activity compiles and runs without errors
- Token is correctly extracted and passed
- Activity enters "Running" state in Temporal UI
- Logs show token (Base64) and correlation IDs
- Unit tests cover success and error paths

---

### Phase 3: Stigma Service (Java) RPC Handler (Days 5-6)

**Goal**: Update Stigma's `startAgent` gRPC handler to accept token, start workflow with token, and return immediate ACK.

**Tasks**:
1. **Update RPC Handler**
   - Read `callback_token` from request
   - Pass token to workflow as argument
   - Return immediate ACK (`Empty` response)
   - Handle null/empty token (backward compatibility)

2. **Workflow Startup**
   - Start `StigmaWorkflow` asynchronously
   - Pass token as workflow parameter
   - Generate unique workflow ID
   - Configure task queue

3. **Logging**
   - Log incoming request with token (Base64)
   - Log workflow start (workflow ID)
   - Log ACK return
   - Include correlation IDs

4. **Error Handling**
   - Return error if workflow fails to start
   - Log and handle null token gracefully
   - Add validation for token format

**Code Location**:
- File: `stigma-service/src/main/java/com/stigmer/service/StigmaServiceImpl.java`
- Method: `startAgent(StartAgentRequest request, StreamObserver<Empty> responseObserver)`

**Deliverables**:
- [ ] RPC handler accepts `callback_token`
- [ ] Workflow started with token as parameter
- [ ] Immediate ACK returned to caller
- [ ] Comprehensive logging
- [ ] Unit tests with mock workflow client

**Acceptance Criteria**:
- Handler compiles and runs without errors
- Token is correctly passed to workflow
- ACK returned within milliseconds
- Logs show token and workflow ID
- Unit tests cover success, null token, and error paths

---

### Phase 4: Stigma Workflow (Java) Completion Logic (Days 7-9)

**Goal**: Update `StigmaWorkflow` to accept token parameter and complete external Zigflow activity upon conclusion.

**Tasks**:
1. **Update Workflow Signature**
   - Add `byte[] callbackToken` parameter
   - Update workflow interface
   - Update workflow implementation

2. **Completion Logic (Success Path)**
   - After Python activities complete successfully
   - Check if token exists (not null/empty)
   - Call `completeExternalZigflowActivity(token, result)`
   - Delegate to System Activity (for determinism)

3. **Completion Logic (Failure Path)**
   - Wrap entire workflow in try-catch
   - On exception, check if token exists
   - Call `failExternalZigflowActivity(token, exception)`
   - Delegate to System Activity

4. **Determinism**
   - Workflow code cannot instantiate `ActivityCompletionClient` directly
   - Must delegate to System Activity for completion
   - Use detached scope if needed

5. **Logging**
   - Log token receipt at workflow start
   - Log before calling completion activity
   - Log completion activity result
   - Include workflow ID and correlation IDs

**Code Location**:
- File: `stigma-workflows/src/main/java/com/stigmer/workflows/StigmaWorkflowImpl.java`
- Interface: `stigma-workflows/src/main/java/com/stigmer/workflows/StigmaWorkflow.java`

**Deliverables**:
- [ ] Workflow accepts `byte[] callbackToken` parameter
- [ ] Success path completes external activity
- [ ] Failure path fails external activity
- [ ] Determinism maintained (uses System Activity)
- [ ] Comprehensive logging
- [ ] Unit tests with mock System Activity

**Acceptance Criteria**:
- Workflow compiles and runs without errors
- Token is preserved in workflow state
- Both success and failure paths complete external activity
- Workflow remains deterministic
- Logs show token and completion calls
- Unit tests cover success, failure, and null token paths

---

### Phase 5: System Activity (Java) - ActivityCompletionClient (Days 10-11)

**Goal**: Create `SystemActivities` interface and implementation using `ActivityCompletionClient` to complete external Zigflow activities.

**Tasks**:
1. **Create Interface**
   - Define `SystemActivities` interface
   - Method: `void completeZigflowToken(byte[] token, AgentResult result)`
   - Method: `void failZigflowToken(byte[] token, Exception exception)`

2. **Implement Activity**
   - Inject `ActivityCompletionClient` via dependency injection
   - Implement `completeZigflowToken`: Call `completionClient.complete(token, result)`
   - Implement `failZigflowToken`: Call `completionClient.reportFailure(token, exception)`
   - Add error handling and logging

3. **Register Activity Worker**
   - Register `SystemActivities` implementation with Temporal worker
   - Configure activity options (timeouts, retries)
   - Ensure worker is running in production

4. **Logging**
   - Log token (Base64) at activity start
   - Log completion result (success/failure)
   - Log any errors
   - Include correlation IDs

5. **Error Handling**
   - Handle invalid token format
   - Handle completion client failures
   - Add retries for transient failures

**Code Location**:
- Interface: `stigma-activities/src/main/java/com/stigmer/activities/SystemActivities.java`
- Implementation: `stigma-activities/src/main/java/com/stigmer/activities/SystemActivitiesImpl.java`

**Deliverables**:
- [ ] `SystemActivities` interface created
- [ ] Implementation using `ActivityCompletionClient`
- [ ] Activity registered with worker
- [ ] Comprehensive logging
- [ ] Error handling and retries
- [ ] Unit tests with mock completion client

**Acceptance Criteria**:
- Activity compiles and runs without errors
- External activity completion works in integration test
- Logs show token and completion status
- Error handling covers edge cases
- Unit tests cover success, failure, invalid token paths

---

### Phase 6: Testing (Days 12-15)

**Goal**: Comprehensive test coverage across all components and scenarios.

**Test Levels**:

#### 6.1 Unit Tests (Day 12)
- **Zigflow Activity**: Mock Stigma client, verify token passing and `ErrResultPending`
- **Stigma RPC Handler**: Mock workflow client, verify token passing and ACK
- **Stigma Workflow**: Mock System Activity, verify completion calls
- **System Activity**: Mock `ActivityCompletionClient`, verify completion/failure calls

#### 6.2 Integration Tests (Days 13-14)
- **Full Flow**: Zigflow → Stigma → Python → Completion → Zigflow
- **Success Path**: Agent completes successfully, Zigflow resumes
- **Failure Path**: Agent fails, Zigflow receives error
- **Null Token**: Direct gRPC call (no token), workflow completes normally

#### 6.3 Failure Scenarios (Day 14)
- **Timeout**: Agent doesn't complete within 24 hours, Zigflow times out
- **Token Corruption**: Invalid token, proper error handling
- **Service Restart**: Stigma restarts mid-execution, token survives
- **Network Failure**: Transient failures, retries work

#### 6.4 Performance Tests (Day 15)
- **Concurrent Agents**: Run 10+ agents simultaneously, no resource exhaustion
- **Latency**: Measure overhead of token handshake (< 100ms)
- **Load Test**: Sustained load over hours, no memory leaks

**Deliverables**:
- [ ] Unit tests for all components (80%+ coverage)
- [ ] Integration tests covering full flow
- [ ] Failure scenario tests passing
- [ ] Performance benchmarks documented
- [ ] Test documentation and runbooks

**Acceptance Criteria**:
- All tests pass reliably
- Coverage meets target (80%+ for critical paths)
- Performance overhead is acceptable (< 100ms)
- Failure scenarios handled gracefully

---

### Phase 7: Observability (Days 16-18)

**Goal**: Production-ready monitoring, alerting, and troubleshooting capabilities.

**Tasks**:

#### 7.1 Metrics (Day 16)
- **Counter**: `zigflow.agent.activity.started` (total activities started)
- **Counter**: `zigflow.agent.activity.pending` (activities in pending state)
- **Counter**: `zigflow.agent.activity.completed` (completed via token)
- **Counter**: `zigflow.agent.activity.failed` (failed via token)
- **Counter**: `zigflow.agent.activity.timeout` (activities that timed out)
- **Histogram**: `zigflow.agent.activity.duration` (time from start to completion)
- **Gauge**: `stigma.workflow.running` (current running workflows)

#### 7.2 Alerts (Day 17)
- **Stuck Activities**: Alert if activities pending > 24 hours
- **High Failure Rate**: Alert if failure rate > 10%
- **Token Errors**: Alert if token corruption/invalid format detected
- **System Activity Failures**: Alert if completion calls fail

#### 7.3 Logging (Day 17)
- Structured logs at each handoff point
- Correlation IDs across all services
- Token (Base64) logged for debugging
- Searchable by workflow ID, activity ID, agent ID

#### 7.4 Dashboards (Day 18)
- **Temporal UI**: View pending activities, workflow history
- **Grafana Dashboard**: Metrics for activity states, durations, error rates
- **Activity Timeline**: Visualize token handshake flow
- **Alerting Status**: Current alert status

#### 7.5 Troubleshooting Documentation (Day 18)
- Runbook: "Activity stuck in pending"
- Runbook: "Token corruption/loss"
- Runbook: "High failure rate"
- Debugging guide with example queries

**Deliverables**:
- [ ] Metrics instrumented in all components
- [ ] Alerts configured and tested
- [ ] Structured logging with correlation IDs
- [ ] Grafana dashboard created
- [ ] Runbooks and troubleshooting guides written

**Acceptance Criteria**:
- Metrics appear in monitoring system
- Alerts fire correctly during test scenarios
- Logs are searchable by correlation ID
- Dashboard shows real-time activity state
- Runbooks enable 24/7 operations support

---

### Phase 8: Documentation & Handoff (Days 19-21)

**Goal**: Complete documentation for developers, operators, and future maintainers.

**Tasks**:

#### 8.1 Architecture Documentation (Day 19)
- Update ADR with implementation learnings
- Create sequence diagrams (as-built)
- Document component interactions
- Explain token lifecycle

#### 8.2 Developer Guide (Day 20)
- How to add new agent types
- How to test locally
- How to debug pending activities
- Code examples and patterns

#### 8.3 Operator Runbook (Day 20)
- How to deploy changes
- How to monitor system health
- How to troubleshoot common issues
- Emergency procedures

#### 8.4 Knowledge Transfer (Day 21)
- Demo video (10-15 minutes)
- Live walkthrough session
- Q&A with team
- Handoff to operations

**Deliverables**:
- [ ] ADR updated with implementation details
- [ ] Developer guide published
- [ ] Operator runbook published
- [ ] Demo video recorded
- [ ] Knowledge transfer session completed

**Acceptance Criteria**:
- Documentation is accurate and complete
- New developers can understand the system
- Operators can troubleshoot without escalation
- Team is confident in production deployment

---

## Implementation Order

**Week 1 (Days 1-5)**:
- Proto definition and regeneration
- Zigflow activity implementation
- Stigma service RPC handler

**Week 2 (Days 6-11)**:
- Stigma workflow completion logic
- System activity implementation
- Initial testing

**Week 3 (Days 12-18)**:
- Comprehensive testing (unit, integration, failure, performance)
- Observability (metrics, alerts, logs, dashboards)

**Week 4 (Days 19-21)**:
- Documentation and handoff
- Production deployment preparation
- Knowledge transfer

## Dependencies & Blockers

**External Dependencies**:
- Temporal SDK (Go) - Already available
- Temporal SDK (Java) - Already available
- Protobuf compiler - Already available

**Internal Dependencies**:
- Access to Zigflow codebase (Go)
- Access to Stigma codebase (Java/Python)
- Access to Temporal cluster (dev/staging/prod)

**Potential Blockers**:
- Temporal cluster capacity (need to verify)
- Code review bandwidth (need team availability)
- Testing environment availability (need staging cluster)

## Risk Management

| Risk | Mitigation | Owner |
|------|------------|-------|
| Token loss/corruption | Set timeouts, add monitoring | Engineering |
| Service restarts | Temporal handles durable state | Platform |
| Performance degradation | Benchmark early, optimize if needed | Engineering |
| Debugging complexity | Comprehensive logging and docs | Engineering |
| Production rollout | Phased rollout, feature flag | DevOps |

## Validation & Acceptance

**Developer Validation**:
- [ ] Code compiles without errors
- [ ] All unit tests pass
- [ ] All integration tests pass
- [ ] Code review approved

**QA Validation**:
- [ ] Manual testing in staging
- [ ] Failure scenarios verified
- [ ] Performance benchmarks met
- [ ] Load testing passed

**Operations Validation**:
- [ ] Monitoring and alerts working
- [ ] Runbooks tested
- [ ] On-call team trained
- [ ] Rollback plan documented

**Product Validation**:
- [ ] Success criteria met
- [ ] Use cases validated
- [ ] Documentation complete
- [ ] Stakeholders signed off

## Next Steps After This Task

1. **Production Rollout**: Phased deployment to production
2. **Monitoring & Tuning**: Monitor for 1-2 weeks, tune as needed
3. **Future Enhancements**: Token encryption, better error messages, dashboards
4. **Related Projects**: Extend pattern to other long-running operations

## References

- **ADR**: `/Users/suresh/scm/github.com/stigmer/stigmer/docs/adr/20260122-async-agent-execution-temporal-token-handshake.md`
- **Temporal Docs**: https://docs.temporal.io/activities#asynchronous-activity-completion
- **Project README**: `../README.md`

---

**Status**: 🔍 PENDING REVIEW

**Next Action**: Present this plan to the team for review and feedback. Once approved, create `T01_1_review.md` with feedback, then `T01_2_revised_plan.md` with updates, and finally `T01_3_execution.md` for implementation tracking.
