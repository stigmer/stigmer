# ADR: Asynchronous Agent Execution using Temporal Activity Token Handshake

**Status**: Proposed  
**Date**: January 22, 2026  
**Context**: Integration of Stigma Agents (Long-Running Operations) into Zigflow (Serverless Workflow Engine)

## 1. Context and Problem Statement

We are integrating internal Stigma Agents into the Zigflow engine.

**System Components:**
- **Zigflow**: A generic serverless workflow provider written in **Go**
- **Stigma Agents**: Complex, long-running workflows defined in **Java** (Orchestrator) with AI tasks executed in **Python** (Worker)

**Current State:**

Zigflow executes tasks synchronously. When we call the Stigma gRPC endpoint, the call returns "Success" immediately (ACK), causing Zigflow to move to the next state before the Agent actually finishes its work.

**Constraint:**

We must support two triggers:
1. **Direct gRPC call** - Client manages the wait
2. **Zigflow Workflow** - Zigflow must wait asynchronously

**The Problem:**

How do we make Zigflow wait for the actual completion of a Stigma Agent (which may run for minutes or hours) without blocking the worker thread?

## 2. Decision

We will implement the **Async Activity Completion Pattern** (Token Handshake).

Zigflow's Go Activity will not complete immediately upon calling the Stigma RPC. Instead, it will pass a **Temporal Task Token** to the Stigma Java Service and enter a "Pending" state. The Stigma Java Workflow will take responsibility for "calling back" (completing) that Go activity upon conclusion.

### Architectural Flow

```mermaid
sequenceDiagram
    participant Zigflow as Zigflow (Go)
    participant StigmaAPI as Stigma Service (Java)
    participant StigmaWF as Stigma Workflow (Java)
    participant PythonWorker as Python Activities
    participant Temporal as Temporal Server

    Zigflow->>Zigflow: Start Activity
    Zigflow->>Zigflow: Generate Task Token
    Zigflow->>StigmaAPI: StartAgent(spec, token)
    StigmaAPI-->>Zigflow: ACK (202 Accepted)
    Zigflow->>Temporal: Return ErrResultPending
    Note over Zigflow,Temporal: Activity paused, waiting for completion
    
    StigmaAPI->>StigmaWF: Start Workflow(spec, token)
    StigmaWF->>PythonWorker: Execute AI Tasks
    PythonWorker-->>StigmaWF: Results
    StigmaWF->>StigmaWF: Process Complete
    StigmaWF->>Temporal: Complete Activity(token, result)
    Temporal->>Zigflow: Activity Completed
    Zigflow->>Zigflow: Continue Workflow
```

**Flow Steps:**

1. **Zigflow (Go)**: Starts Activity → Generates Task Token → Calls Java RPC → Returns `ErrResultPending`
2. **Stigma Service (Java)**: Receives RPC → Starts `StigmaWorkflow` (Java) passing the Token as an argument
3. **Stigma Workflow (Java)**: Orchestrates Python Activities
4. **Completion (Java)**: When `StigmaWorkflow` finishes, it uses the `ActivityCompletionClient` to complete the external Zigflow (Go) task using the saved Token

## 3. Detailed Design & Implementation Plan

### Component A: Interface Definition (Protobuf)

**Action**: Update the gRPC definition to accept the callback token.

```protobuf
// stigma_service.proto

message StartAgentRequest {
    string agent_id = 1;
    AgentSpec spec = 2;
    
    // NEW FIELD: The binary token from the caller (Zigflow/Temporal)
    // If empty, treat as a fire-and-forget or sync call.
    bytes callback_token = 3; 
}
```

**Rationale**: By making `callback_token` optional, we maintain backward compatibility with direct gRPC calls that don't need async completion.

### Component B: Zigflow Activity (Go)

**Action**: Update the Custom Task Handler to handle the async wait.

```go
// stigma_activity.go (Zigflow)

func (a *StigmaActivities) ExecuteAgent(ctx context.Context, input StigmaTaskInput) (interface{}, error) {
    // 1. Get the Activity Context to access the Token
    activityInfo := activity.GetInfo(ctx)
    taskToken := activityInfo.TaskToken

    // 2. Prepare the RPC Request
    req := &pb.StartAgentRequest{
        AgentId:       input.AgentId,
        Spec:          input.Spec,
        CallbackToken: taskToken, // Pass the token to Java
    }

    // 3. Call Stigma Service (Java) via gRPC
    // Note: We expect this call to return immediately with an ACK
    _, err := a.grpcClient.StartAgent(ctx, req)
    if err != nil {
        return nil, err // Immediate failure
    }

    // 4. IMPORTANT: Tell Temporal "I am not done yet"
    // The workflow will pause here and wait for the external completion.
    return nil, activity.ErrResultPending
}
```

**Key Points:**
- `activity.GetInfo(ctx).TaskToken` provides the unique identifier for this activity execution
- `activity.ErrResultPending` tells Temporal to pause the activity and wait for external completion
- The activity will remain in "Running" state until the Java service calls back

### Component C: Stigma Service (Java RPC)

**Action**: Pass the token into the Workflow Execution.

```java
// StigmaServiceImpl.java

@Override
public void startAgent(StartAgentRequest request, StreamObserver<Empty> responseObserver) {
    // 1. Configure Workflow Options
    WorkflowOptions options = WorkflowOptions.newBuilder()
            .setTaskQueue("STIGMA_JAVA_QUEUE")
            .setWorkflowId("agent-" + request.getAgentId() + "-" + UUID.randomUUID())
            .build();

    // 2. Start the Java Workflow Stub
    StigmaWorkflow workflow = client.newWorkflowStub(StigmaWorkflow.class, options);
    
    // 3. Execute Async
    // We pass the callbackToken into the workflow arguments
    WorkflowExecution.start(workflow::runAgentWorkflow, request.getSpec(), request.getCallbackToken());

    // 4. Return ACK to Zigflow immediately
    responseObserver.onNext(Empty.getDefaultInstance());
    responseObserver.onCompleted();
}
```

**Key Points:**
- The RPC handler returns immediately after starting the workflow
- The token is passed as a workflow argument, making it part of the workflow's durable state
- If the workflow service restarts, the token is preserved in Temporal's history

### Component D: Stigma Workflow (Java Orchestrator)

**Action**: Handle the completion logic at the end of the workflow.

```java
// StigmaWorkflowImpl.java

public class StigmaWorkflowImpl implements StigmaWorkflow {

    // Activity Stub for Python AI Workers
    private final PythonActivities pythonActivities = 
        Workflow.newActivityStub(PythonActivities.class, ...);

    @Override
    public void runAgentWorkflow(AgentSpec spec, byte[] callbackToken) {
        AgentResult result = null;
        try {
            // 1. Run the heavy Logic (Python Workers)
            // This is where the actual agent work happens
            result = pythonActivities.executeDeepThink(spec);

        } catch (Exception e) {
            // Handle failure case
            if (callbackToken != null && callbackToken.length > 0) {
                failExternalZigflowActivity(callbackToken, e);
            }
            throw e;
        }

        // 2. The "Callback" Logic
        // If a token exists, we must manually complete the external Zigflow activity
        if (callbackToken != null && callbackToken.length > 0) {
            completeExternalZigflowActivity(callbackToken, result);
        }
    }

    private void completeExternalZigflowActivity(byte[] token, AgentResult result) {
        // We use a detached scope or an external Activity to perform the completion
        // because Workflow code cannot make external API calls directly.
        Workflow.newActivityStub(SystemActivities.class)
                .completeZigflowToken(token, result);
    }

    private void failExternalZigflowActivity(byte[] token, Exception e) {
        Workflow.newActivityStub(SystemActivities.class)
                .failZigflowToken(token, e);
    }
}
```

**Key Points:**
- The workflow checks if a token exists before attempting completion
- Both success and failure paths complete the external activity
- The completion logic is delegated to an activity (required for determinism)

### Component E: System Activity (Java)

**Action**: The actual "Completer" helper. Since workflows must be deterministic, they cannot instantiate a `CompletionClient` directly. They must ask an Activity to do it.

```java
// SystemActivitiesImpl.java
public class SystemActivitiesImpl implements SystemActivities {
    
    private final ActivityCompletionClient completionClient; // Injected via DI

    @Override
    public void completeZigflowToken(byte[] token, AgentResult result) {
        // This is what wakes up the Go Workflow!
        completionClient.complete(token, result);
    }

    @Override
    public void failZigflowToken(byte[] token, Exception e) {
        completionClient.reportFailure(token, e);
    }
}
```

**Key Points:**
- `ActivityCompletionClient` is provided by Temporal SDK
- This activity runs in a worker process that has access to non-deterministic operations
- The token uniquely identifies the external activity to complete

## 4. Consequences

### Positive

✅ **Correctness**: Zigflow correctly waits for the actual completion of the Agent, not just the gRPC ACK

✅ **Resilience**: If the Stigma Service restarts, the Zigflow workflow remains safely paused. The token is durable.

✅ **Decoupling**: Zigflow (Go) does not need to know about the Python queues or internal logic; it only holds a generic wait state

✅ **Scalability**: The Go activity worker thread is not blocked during the long-running agent execution

✅ **Backward Compatibility**: Direct gRPC calls (without token) continue to work as before

✅ **Observability**: Both Zigflow and Stigma workflows appear in Temporal UI, providing complete visibility

### Negative

⚠️ **Complexity**: Requires passing the `token` through multiple layers (Go → Proto → Java RPC → Java Workflow → Java Activity)

⚠️ **Debuggability**: "Pending" activities can be hard to debug if the callback is never sent (e.g., if the Java workflow crashes before the completion logic)

**Mitigation**: Set a `StartToCloseTimeout` on the Zigflow Go Activity (e.g., 24 hours). If the Java service never calls back, Temporal will timeout the activity.

⚠️ **Token Management**: If the token is lost or corrupted, the activity will hang indefinitely

**Mitigation**: Log the token (Base64 encoded) in both Go and Java for debugging. Add monitoring alerts for activities stuck in "Running" state.

## 5. Sequence Diagram

```mermaid
sequenceDiagram
    participant CLI as User/CLI
    participant ZigflowWF as Zigflow Workflow (Go)
    participant ZigflowAct as Zigflow Activity (Go)
    participant StigmaRPC as Stigma gRPC Service (Java)
    participant StigmaWF as Stigma Workflow (Java)
    participant SystemAct as System Activity (Java)
    participant PythonAct as Python Activities
    participant Temporal as Temporal Server

    CLI->>ZigflowWF: Start Workflow
    ZigflowWF->>ZigflowAct: Execute Agent Task
    ZigflowAct->>Temporal: Get Task Token
    Temporal-->>ZigflowAct: Token (bytes)
    
    ZigflowAct->>StigmaRPC: StartAgent(spec, token)
    StigmaRPC->>StigmaWF: Start Workflow(spec, token)
    StigmaRPC-->>ZigflowAct: ACK (Empty)
    ZigflowAct-->>Temporal: ErrResultPending
    
    Note over ZigflowAct,Temporal: Activity Paused ⏸️<br/>Workflow Waiting
    
    StigmaWF->>PythonAct: Execute AI Tasks
    PythonAct->>PythonAct: Long-Running Work (Minutes/Hours)
    PythonAct-->>StigmaWF: Results
    
    StigmaWF->>SystemAct: completeZigflowToken(token, result)
    SystemAct->>Temporal: Complete Activity(token, result)
    Temporal->>ZigflowAct: Activity Completed ✓
    ZigflowAct-->>ZigflowWF: Return Result
    ZigflowWF->>ZigflowWF: Continue to Next Step
    ZigflowWF-->>CLI: Workflow Complete
```

## 6. Implementation Checklist

### Phase 1: Proto Definition
- [ ] Add `callback_token` field to `StartAgentRequest`
- [ ] Regenerate Go and Java proto files
- [ ] Update proto documentation

### Phase 2: Zigflow (Go)
- [ ] Update `ExecuteAgent` activity to extract task token
- [ ] Pass token in gRPC request
- [ ] Return `activity.ErrResultPending`
- [ ] Add logging for token (Base64 encoded)
- [ ] Set appropriate `StartToCloseTimeout`

### Phase 3: Stigma Service (Java)
- [ ] Update `startAgent` RPC handler to accept token
- [ ] Pass token to workflow as argument
- [ ] Return immediate ACK

### Phase 4: Stigma Workflow (Java)
- [ ] Add `byte[] callbackToken` parameter to workflow signature
- [ ] Add completion logic at end of workflow
- [ ] Handle both success and failure paths
- [ ] Add logging for token operations

### Phase 5: System Activity (Java)
- [ ] Create `SystemActivities` interface with completion methods
- [ ] Implement using `ActivityCompletionClient`
- [ ] Add error handling and logging
- [ ] Register activity worker

### Phase 6: Testing
- [ ] Unit test: Zigflow activity with mock token
- [ ] Unit test: Java workflow with mock completion client
- [ ] Integration test: Full flow with real Temporal
- [ ] Failure test: Timeout scenario
- [ ] Failure test: Token corruption
- [ ] Performance test: Multiple concurrent agents

### Phase 7: Observability
- [ ] Add metrics for pending activities
- [ ] Add alerts for stuck activities (> 24 hours)
- [ ] Add logs at each handoff point
- [ ] Document troubleshooting procedures

## 7. Alternatives Considered

### Alternative 1: Polling (Rejected)

**Approach**: Zigflow polls Stigma status endpoint every N seconds.

**Pros**: Simple to understand

**Cons**:
- Wastes worker thread resources during polling
- Introduces unnecessary network traffic
- Adds latency (up to polling interval)
- No built-in timeout mechanism

### Alternative 2: Message Queue Callback (Rejected)

**Approach**: Stigma publishes completion message to queue, Zigflow consumes it.

**Pros**: Decoupled systems

**Cons**:
- Requires external message queue (Kafka, RabbitMQ)
- Adds operational complexity
- Need to correlate queue message with activity execution
- Temporal already provides this capability natively

### Alternative 3: Synchronous RPC with Long Timeout (Rejected)

**Approach**: Make RPC call with 24-hour timeout.

**Pros**: Simple implementation

**Cons**:
- Blocks worker thread for hours
- Poor resource utilization
- Worker pool exhaustion under load
- No resilience if connection drops

**Why Async Token Handshake Wins:**

The Temporal async completion pattern is purpose-built for this exact use case. It's battle-tested, provides proper timeout handling, survives restarts, and doesn't waste resources.

## 8. Risks and Mitigations

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Token lost/corrupted | Activity hangs forever | Low | Set `StartToCloseTimeout`, add monitoring alerts |
| Java service crashes before completion | Activity times out | Medium | Temporal retries workflow, completion in `finally` block |
| Token passed to wrong service | Wrong activity completed | Low | Validate token format, add namespace prefix |
| Performance overhead of extra activity call | Slight latency increase | High (but acceptable) | Measure and document (< 100ms overhead) |
| Debugging "pending" activities is hard | Increased troubleshooting time | Medium | Comprehensive logging, Temporal UI visibility |

## 9. References

- [Temporal Async Activity Completion](https://docs.temporal.io/activities#asynchronous-activity-completion)
- [Temporal Activity Tokens](https://docs.temporal.io/activities#activity-tokens)
- [Temporal Java SDK ActivityCompletionClient](https://www.javadoc.io/doc/io.temporal/temporal-sdk/latest/io/temporal/client/ActivityCompletionClient.html)
- [Temporal Go SDK ErrResultPending](https://pkg.go.dev/go.temporal.io/sdk/activity#ErrResultPending)

## 10. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-22 | Use Temporal async completion pattern | Native support, battle-tested, proper timeout handling |
| 2026-01-22 | Make `callback_token` optional in proto | Maintain backward compatibility with direct calls |
| 2026-01-22 | Delegate completion to System Activity | Workflow determinism requirement |
| 2026-01-22 | Set 24-hour timeout on Go activity | Prevent infinite hangs, reasonable limit for agent tasks |

---

**Status**: Proposed - Awaiting review and approval

**Next Steps**:
1. Review with Architecture Team
2. Prototype Phase 1-2 (Proto + Go)
3. Validate approach with small test case
4. Proceed with full implementation if successful
