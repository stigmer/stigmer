# Fix Bidi Streaming Codegen Across All SDK Generators

**Date**: April 23, 2026

## Summary

Fixed a codegen bug where bidirectional streaming RPCs (like the runner `Connect` stream) were incorrectly generated as server-streaming-only across all four SDK generators (Go, TypeScript, Python, Java). The generated code now correctly emits send/receive/close capabilities for bidi streams in each language's idiomatic pattern.

## Problem Statement

Running `make codegen` produced a compile error in the Go SDK:

```
sdk/go/internal/gen/runner.go:70:48: cannot use input (variable of type
*runnerv1.RunnerStreamClientMessage) as grpc.CallOption value in argument
to r.command.Connect
```

### Pain Points

- The `generateStreamingMethod` function in all four generators only checked `m.ServerStreaming` and never inspected `m.ClientStreaming`
- Bidi streaming methods (where both flags are true) were treated as server-streaming, generating code that passed the client message as a direct argument instead of opening a bidirectional channel
- The Go SDK failed to compile; the TS, Python, and Java SDKs generated incorrect runtime behavior (no ability to send messages on the stream)

## Solution

Added a `m.ClientStreaming` branch to each generator's streaming method function. When both `ServerStreaming` and `ClientStreaming` are true, the generator now emits language-idiomatic bidi streaming wrappers with full send/receive/close support.

## Implementation Details

### Go (`sdk_client.go`)

Updated `generateStreamingMethod` to emit `Send()`, `Recv()`, `CloseSend()` on the stream wrapper and accept `opts ...grpc.CallOption` instead of an input message.

### TypeScript (`sdk_client_ts.go`)

- New shared helper `bidi-stream.ts` with a generic `BidiStream<Send, Receive>` class
- Wraps Connect-RPC v2's `AsyncIterable` bidi API into a push-based `send()`/`close()` interface with async iteration for receiving
- Updated `generateTSStreamingMethod` to return `BidiStream` for bidi methods

### Python (`sdk_client_python.go`)

- New shared helper `_bidi.py` with a generic `BidiStream[Send, Receive]` class
- Uses `queue.SimpleQueue` to bridge push-based `send()` calls with Python grpc's request-iterator bidi API
- Updated `generatePythonStreamingMethod` to return `BidiStream` for bidi methods

### Java (`sdk_client_java.go`)

- New shared helper `StigmerBidiStream.java` with `send()`/`closeSend()`/`receive()` methods
- Uses `StreamObserver` + `LinkedBlockingQueue` to bridge Java grpc's async bidi API into a blocking-friendly interface
- Added automatic async stub (`newStub`) generation alongside the blocking stub for services containing bidi methods

## Benefits

- All four SDKs now correctly support bidirectional streaming RPCs
- The runner `Connect` bidi stream works end-to-end: clients can send heartbeats/command responses while receiving server commands
- Future bidi streaming methods added to any service will automatically get correct codegen treatment
- Each language gets an idiomatic wrapper (async generators in TS, iterators in Python, blocking queue in Java)

## Impact

- **Go SDK**: Compile error resolved
- **TypeScript SDK**: `RunnerClient.connect()` now returns a `BidiStream` with `send`/`close`/async iteration instead of a broken `AsyncGenerator`
- **Python SDK**: `RunnerClient.connect()` now returns a `BidiStream` with `send`/`close`/iteration instead of a broken `Iterator`
- **Java SDK**: `RunnerClient.connect()` now returns a `StigmerBidiStream` with `send`/`closeSend`/`receive` instead of a broken `StigmerStream`
- Any future bidi streaming RPC added to any service will be handled correctly

## Related Work

- Follows from the runner bidi stream proto additions (2026-04-22)
- Runner command stream handler changelogs: `2026-04-22-192844-oss-bidi-stream-handler.md`, `2026-04-22-195505-runner-stream-client-cli-daemon.md`

---

**Status**: Production Ready
**Commits**: `7ce4c852` (Go), `ce26866a` (TS/Python/Java)
