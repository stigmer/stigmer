# Fix Connection Health Detection with gRPC Transport Keepalives

**Date**: February 16, 2026

## Summary

Replaced application-level "connection stale" detection with industry-standard gRPC HTTP/2 PING-based keepalives. The CLI was showing false "Connection may be interrupted" warnings during normal LLM thinking periods (when the agent-runner produces no events for 15+ seconds). The fix separates connection health (transport layer) from application data flow (application layer), uses the right mechanism at each layer, and eliminates false positives while maintaining genuine connection failure detection.

## Problem Statement

The CLI TUI tracked application-level data arrival (`lastBackendUpdate`) to infer connection health. When no execution status updates arrived within 15 seconds, it displayed:

```
⚠ Connection may be interrupted  ↑↓ scroll  c cancel  ? help  q detach
```

This warning triggered falsely during:
- **LLM "thinking" periods** — When the model is processing a long prompt before generating output, LangGraph emits no events. The agent-runner's streaming update scheduler has a 5-second keepalive, but `should_send_update()` is only called inside the event loop. No events = no loop iterations = no keepalive fires.
- **Long-running tool executions** — Tools that take 20+ seconds without streaming output would trigger the warning even though the connection and execution were healthy.

### Pain Points

- **User confusion**: The vague warning during normal operation eroded trust. Users couldn't distinguish "agent is thinking" from "connection is broken."
- **Layer violation**: Using "no application data" as a proxy for "connection broken" conflates two fundamentally different signals.
- **Redundant UX**: The CLI already had a "thinking indicator" (spinner after 2 seconds of no events) for the "agent is processing" state. The connection warning was redundant.
- **Not industry-standard**: World-class gRPC deployments (Kubernetes, Envoy, Istio) use HTTP/2 PING frames for connection health, not application-level heuristics.

## Solution

Implement gRPC transport-level keepalives across the entire stack (CLI client, Go server, Java server) and remove the application-level stale detection entirely.

### Architectural Principle

Connection health and application data flow are separate concerns belonging at separate layers:

| Concern | Right Layer | Mechanism |
|---|---|---|
| **Connection alive?** | Transport (HTTP/2) | gRPC keepalive PING frames |
| **Agent producing output?** | Application (TUI) | Thinking indicator (already exists) |

### gRPC Keepalive Specification

Per the official gRPC documentation (https://grpc.io/docs/guides/keepalive/), keepalive parameters control HTTP/2 PING frame transmission for connection health:

**Client-side** (`ClientParameters`):
- `Time`: Interval between PING frames when stream is idle
- `Timeout`: Wait time for PING acknowledgment before closing connection
- `PermitWithoutStream`: Allow PINGs with no active RPCs (default: false)

**Server-side enforcement** (`EnforcementPolicy`):
- `MinTime` (`permit-keep-alive-time`): Minimum interval clients must wait between PINGs. If violated, server sends GOAWAY and closes connection.
- `PermitWithoutStream`: Whether to allow keepalive PINGs without active streams (default: false)

**Server-side keepalive** (`ServerParameters`):
- `Time` (`keep-alive-time`): Server-initiated PING interval to detect dead clients
- `Timeout` (`keep-alive-timeout`): Wait time for PING response before closing connection

## Implementation Details

### 1. CLI gRPC Client Configuration

**File**: `client-apps/cli/internal/cli/backend/client.go`

Added `keepalive.ClientParameters` to the dial options:

```go
import "google.golang.org/grpc/keepalive"

opts = append(opts, grpc.WithKeepaliveParams(keepalive.ClientParameters{
    Time:                30 * time.Second, // Send PING every 30s when stream is idle
    Timeout:             10 * time.Second, // Wait 10s for PING response
    PermitWithoutStream: false,            // Only when active streams exist
}))
```

**Behavior**: The gRPC transport sends HTTP/2 PING frames every 30 seconds when the subscribe stream is idle (no data flowing). If the server doesn't respond within 10 seconds, the transport closes the connection. `stream.Recv()` returns an error (typically `codes.Unavailable`), which the CLI already handles via `StreamErrorEvent` — showing a proper error message to the user.

**Detection latency**: ~40 seconds (30s interval + 10s timeout) for genuine connection failures.

### 2. Go gRPC Server Configuration

**File**: `backend/libs/go/grpc/server.go`

Added server-side keepalive enforcement and server-initiated keepalive:

```go
import "google.golang.org/grpc/keepalive"

grpcServer := grpc.NewServer(
    // ... existing options ...
    
    grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
        MinTime:             5 * time.Second, // Allow client PINGs >= 5s apart
        PermitWithoutStream: false,           // Only when active streams exist
    }),
    
    grpc.KeepaliveParams(keepalive.ServerParameters{
        Time:    15 * time.Second, // Send PING every 15s on idle connections
        Timeout: 5 * time.Second,  // Wait 5s for PING response
    }),
)
```

**Purpose**:
- **Enforcement policy**: Permits client PINGs as frequent as every 5 seconds. Without this, gRPC's default is 5 minutes — our client's 30-second PINGs would be rejected with a GOAWAY frame.
- **Server keepalive**: Detects dead clients on long-lived streams. If a CLI client crashes or loses network without cleanly closing the connection, the server's subscribe handler would otherwise hold the gRPC stream, Redis listener, and CountDownLatch open indefinitely. Server-initiated keepalive detects the dead client within ~20 seconds (15s + 5s) and releases those resources.

### 3. Java gRPC Server Configuration (stigmer-cloud)

**File**: `backend/services/stigmer-service/src/main/resources/application.yaml`

Added keepalive properties via `grpc-spring-boot-starter`:

```yaml
grpc:
  server:
    port: 8080
    reflection-service-enabled: true
    permit-keep-alive-time: 5s
    keep-alive-time: 15s
    keep-alive-timeout: 5s
```

**Purpose**: Same as Go server — permits client PINGs and provides server-side dead client detection for resource cleanup.

### 4. Remove Application-Level Stale Detection (CLI TUI)

Removed the entire application-level "connection stale" tracking mechanism from 6 files:

**`events.go`**: Removed `HeartbeatEvent` type (12 lines)
**`model.go`**: Removed `lastBackendUpdate` field and initialization (6 lines)
**`handle_events.go`**: Removed `HeartbeatEvent` dispatch and `lastBackendUpdate` update (14 lines)
**`view.go`**: Removed `isConnectionStale()` method, footer warning case, unused `time` import (11 lines)
**`update.go`**: Removed `connectionStaleThreshold` constant (6 lines)
**`run_stream_events.go`**: Removed `HeartbeatEvent` emission on every `stream.Recv()` (8 lines)

**Rationale**: With transport-level keepalives:
- If the connection genuinely breaks, `stream.Recv()` errors within ~40 seconds and the CLI shows a proper error via `StreamErrorEvent` (already implemented)
- If the agent is just thinking, the connection is alive (PINGs succeed), the stream stays open, and the thinking indicator (spinner after 2s idle) provides the right UX
- No false positives, no redundant warnings, no application-level heuristics

### 5. Existing Error Handling (No Changes)

The CLI already properly handles genuine connection failures:

**`run_stream_events.go`** (lines 48-59):
```go
execution, err := cfg.stream.Recv()
if err != nil {
    if err == io.EOF {
        cfg.events <- executiontui.StreamErrorEvent{
            Err: errors.New("execution stream ended unexpectedly"),
        }
    } else {
        cfg.events <- executiontui.StreamErrorEvent{
            Err: errors.Wrap(err, "execution stream error"),
        }
    }
    return
}
```

**`handle_events.go`** (lines 126-140):
```go
case StreamErrorEvent:
    m.done = true
    m.exitError = e.Err.Error()
    // ... finalize running tools ...
    m.blocks = append(m.blocks, newErrorBlock(
        renderErrorContent("Stream error: "+e.Err.Error()),
    ))
```

When gRPC transport detects a dead connection via keepalive timeout, `stream.Recv()` returns an error (e.g., `codes.Unavailable desc="transport is closing"`), which flows through this existing path and shows the user a clear, accurate error message.

## Benefits

**Eliminates false positives**: No more warnings during normal LLM thinking or long tool executions. Users see connection warnings only when the connection is genuinely broken.

**Industry-standard approach**: Uses HTTP/2 PING frames (the mechanism Kubernetes, Envoy, Istio, and every production gRPC deployment uses) instead of custom application-level heuristics.

**Clearer UX**:
- **Broken connection**: CLI shows "Stream error: execution stream error: rpc error: code = Unavailable" (accurate, actionable)
- **Agent thinking**: CLI shows thinking spinner in header (correct signal)
- **Agent producing output**: Events flow normally, content renders

**Resource leak prevention**: Server-side keepalive detects crashed/disconnected clients and releases resources (gRPC streams, Redis listeners, latches) instead of holding them until execution completion.

**Simplified code**: Removed ~70 lines of application-level tracking code. Transport layer handles connection health; application layer handles execution progress.

**No additional traffic**: HTTP/2 PING frames are tiny (8-byte payload) and only sent when streams are idle. Zero impact on normal operation.

## Impact

**Users**: No more false "connection interrupted" warnings during normal usage. Better trust in the CLI's status indicators.

**Developers**: Cleaner separation of concerns (transport vs application). Standard gRPC patterns instead of custom heuristics.

**Operations**: Server-side resource leak prevention for crashed clients. Better observability via gRPC metrics.

**Scale**: The 30-second client PING interval is conservative per gRPC recommendations (docs suggest "avoid below one minute" for large deployments). Current scale (individual CLI users) handles this easily. If the platform scales to hundreds of concurrent subscribers, the interval can be increased to 60s with minimal UX impact.

## Related Work

This fix is independent but complements:
- **Thinking indicator** (`update.go` lines 222-238): Shows spinner after 2s of no events during `in_progress`. Provides the right UX for "agent is processing."
- **Backend stall detection** (`execute_graphton.py` line 1900): 5-minute timeout that detects genuinely stuck executions (e.g., LLM hang) and fails them through the normal pipeline.
- **Streaming update scheduler** (`update_scheduler.py`): Hybrid time + event threshold scheduler with 5-second keepalive — but only fires when events arrive. This fix ensures connection health is monitored even when no events flow.

## Testing Scenarios

**Normal operation (LLM thinking)**:
1. Start agent execution via CLI
2. Agent sends a complex prompt to LLM
3. LLM takes 45 seconds to "think" (no events emitted)
4. **Before**: CLI shows "⚠ Connection may be interrupted" warning after 15s
5. **After**: CLI shows thinking spinner, no warning. gRPC PINGs confirm connection is alive.

**Genuine connection failure**:
1. Start agent execution via CLI
2. Kill stigmer-server process or disconnect network
3. **Before**: CLI shows "⚠ Connection may be interrupted" warning after 15s, eventually shows stream error
4. **After**: Within ~40s, gRPC keepalive times out, `stream.Recv()` returns error, CLI shows "Stream error: ... code = Unavailable" immediately.

**Crashed client (server-side)**:
1. Start execution, begin subscribing
2. Kill CLI process without clean close (SIGKILL, laptop sleep, network disconnect)
3. **Before**: Server holds gRPC stream, Redis listener, latch open until execution completes
4. **After**: Server-side keepalive detects dead client within ~20s, releases resources

---

**Status**: ✅ Production Ready

**Files Modified**: 12 files across 2 repositories
- **stigmer**: 11 files (CLI client, Go server, TUI components)
- **stigmer-cloud**: 1 file (Java server configuration)

**Lines Changed**: +41 insertions, -70 deletions (net -29 lines)
