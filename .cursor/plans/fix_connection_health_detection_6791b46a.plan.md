---
name: Fix connection health detection
overview: Replace the application-level "connection stale" detection (which falsely triggers during LLM thinking) with gRPC transport-level keepalives -- the industry-standard mechanism for connection health. Remove the isConnectionStale() warning entirely, since the thinking indicator already covers the "agent is quiet" UX.
todos:
  - id: cli-keepalive-dial
    content: "Add gRPC keepalive ClientParameters to the CLI's grpc.Dial options in client.go (Time: 10s, Timeout: 5s)"
    status: completed
  - id: go-server-keepalive
    content: Add KeepaliveEnforcementPolicy and KeepaliveParams to the Go gRPC server in server.go (permit 5s min, server PING 15s)
    status: completed
  - id: java-server-keepalive
    content: "Add keepalive properties to the Java gRPC server configuration in application.yaml (permit-keep-alive-time: 5s)"
    status: completed
  - id: remove-stale-detection
    content: Remove isConnectionStale(), connectionStaleThreshold, lastBackendUpdate, HeartbeatEvent, and the 'Connection may be interrupted' footer from the CLI TUI
    status: completed
  - id: verify-stream-error-path
    content: Verify the existing StreamErrorEvent handling works correctly when gRPC transport detects a dead connection (no new code needed, just confirmation)
    status: completed
isProject: false
---

# Fix Connection Health Detection with gRPC Transport Keepalives

## Problem

The CLI's "Connection may be interrupted" warning is a **false positive** caused by a layer violation: it uses "no application data received in 15 seconds" as a proxy for "connection is broken." But silence on the gRPC stream can mean two things:

1. **Connection is broken** (genuine problem)
2. **Agent is thinking** (normal behavior -- LLM processing a prompt before generating output)

The current code conflates these two fundamentally different signals.

### Why It Happens

The agent-runner's `StreamingUpdateScheduler` has a 5-second keepalive, but `should_send_update()` is only called **inside the event processing loop** (`[execute_graphton.py` line 1971](backend/services/agent-runner/worker/activities/execute_graphton.py)). When no LangGraph events are emitted (LLM thinking), the loop body never executes, so no keepalive fires. The background heartbeat task (line 1866) only sends **Temporal heartbeats**, not backend status updates. After 15 seconds of silence, the CLI triggers the warning.

## Architectural Principle

Connection health and application data flow are **separate concerns** that belong at **separate layers**:


| Concern                 | Right Layer        | Mechanism                           |
| ----------------------- | ------------------ | ----------------------------------- |
| Connection alive?       | Transport (HTTP/2) | gRPC keepalive PING frames          |
| Agent producing output? | Application (TUI)  | Thinking indicator (already exists) |


World-class gRPC deployments (Kubernetes, Envoy, etc.) all use HTTP/2 PING frames for connection health -- not application-level data flow.

## Solution

### 1. Configure gRPC keepalive on the CLI connection (client side)

In `[client-apps/cli/internal/cli/backend/client.go](client-apps/cli/internal/cli/backend/client.go)`, add keepalive parameters to the gRPC dial options:

```go
import "google.golang.org/grpc/keepalive"

opts = append(opts, grpc.WithKeepaliveParams(keepalive.ClientParameters{
    Time:                10 * time.Second, // Send PING every 10s when stream is idle
    Timeout:             5 * time.Second,  // Wait 5s for PING response
    PermitWithoutStream: false,            // Only when active streams exist
}))
```

**What this does**: The gRPC transport sends HTTP/2 PING frames every 10 seconds when the stream is idle. If the server doesn't respond within 5 seconds, the transport layer closes the connection. `stream.Recv()` returns an error, which the CLI already handles as a `StreamErrorEvent` -- showing a real error message, not a vague warning.

### 2. Configure gRPC keepalive on the Go backend server

In `[backend/libs/go/grpc/server.go](backend/libs/go/grpc/server.go)`, add server-side keepalive enforcement to permit client PINGs:

```go
import "google.golang.org/grpc/keepalive"

grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
    MinTime:             5 * time.Second, // Allow client PINGs as frequent as 5s
    PermitWithoutStream: false,           // Only when streams exist
}),
grpc.KeepaliveParams(keepalive.ServerParameters{
    Time:    15 * time.Second, // Server sends PINGs every 15s
    Timeout: 5 * time.Second,  // Wait 5s for PING response
}),
```

**Why both client and server**: The client keepalive detects "server is unreachable." The server keepalive enforcement tells gRPC "it's OK for clients to send PINGs this frequently" (without this, gRPC may reject frequent PINGs with GOAWAY).

### 3. Configure keepalive on the Java backend server (stigmer-cloud)

In `[backend/services/stigmer-service/src/main/resources/application.yaml](../stigmer-cloud/backend/services/stigmer-service/src/main/resources/application.yaml)` (via `grpc-spring-boot-starter` properties):

```yaml
grpc:
  server:
    permit-keep-alive-time: 5s
    keep-alive-time: 15s
    keep-alive-timeout: 5s
```

### 4. Remove `isConnectionStale()` and the false warning from the CLI TUI

- **Remove** `isConnectionStale()` from `[view.go](client-apps/cli/pkg/executiontui/view.go)` (lines 167-173)
- **Remove** the "Connection may be interrupted" footer case from `renderFooter()` (lines 108-109)
- **Remove** `connectionStaleThreshold` constant from `[update.go](client-apps/cli/pkg/executiontui/update.go)` (lines 202-206)
- **Remove** the `lastBackendUpdate` field from `[model.go](client-apps/cli/pkg/executiontui/model.go)` (line 126-129)
- **Remove** the `HeartbeatEvent` type from `[events.go](client-apps/cli/pkg/executiontui/events.go)` and its handling in `[handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)`
- **Remove** the HeartbeatEvent emission from `[run_stream_events.go](client-apps/cli/cmd/stigmer/root/run_stream_events.go)` (line 68)

**Why remove rather than adjust the threshold?** Because the signal is fundamentally wrong. Increasing the threshold to 60 seconds would just delay the false positive, not fix it. With transport-level keepalives:

- If the connection genuinely breaks, `stream.Recv()` errors within ~15 seconds (10s PING interval + 5s timeout) and the CLI already shows a proper error via `StreamErrorEvent`
- If the agent is just thinking, the connection is alive (PINGs succeed), the stream stays open, and the thinking indicator (spinner after 2s idle) provides the right UX

### What Already Works (No Changes Needed)

- **Thinking indicator**: Shows a spinner in the header after 2 seconds of no events during `in_progress`. This is the correct UX for "agent is alive but processing." Already implemented in `[update.go](client-apps/cli/pkg/executiontui/update.go)` lines 222-238.
- **Stream error handling**: `StreamErrorEvent` handling in `[handle_events.go](client-apps/cli/pkg/executiontui/handle_events.go)` lines 140-155 already shows a proper error when the stream actually breaks.
- **Backend stall detection**: The agent-runner has a 5-minute stall timeout (`[execute_graphton.py](backend/services/agent-runner/worker/activities/execute_graphton.py)` line 1900) that detects genuinely stuck executions and fails them through the normal pipeline.

## Result

After this change:

- **Broken connection**: Detected by gRPC transport within ~15s. `stream.Recv()` errors. CLI shows a real error.
- **Agent thinking**: Connection alive (PINGs succeed). Stream idle. CLI shows thinking spinner. No false warning.
- **Agent producing output**: Events flow normally. CLI renders content.
- **No redundant data**: Zero additional application-level traffic. The PING frames are tiny, transport-level, and standard.

