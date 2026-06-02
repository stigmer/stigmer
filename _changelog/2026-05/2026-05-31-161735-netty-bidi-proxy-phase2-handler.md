# Netty BiDi HTTP/2 Proxy Handler (Cursor Billing Phase 2)

**Date**: May 31, 2026

## Summary

Built a Netty HTTP/2 (h2c) proxy server on port 8082 in stigmer-cloud that transparently proxies Connect RPC BiDi streams between the runner and Cursor's `api2.cursor.sh`, extracting billing usage from the wire. This is the foundation of Phase 2 proxy-authoritative billing — the proxy becomes the single source of truth for Cursor usage metering, replacing the Phase 1 runner-reported fallback.

## Problem Statement

Cursor agent executions (`AgentService/Run`) use Connect RPC BiDi streaming over HTTP/2. The existing Tomcat proxy controller on port 8081 cannot handle this traffic for three reasons:

### Pain Points

- **Tomcat speaks HTTP/1.1 only** — the Cursor SDK's `connect-node` uses native HTTP/2 (`http2` module), so the connection fails before any bytes arrive at Tomcat
- **Servlet model buffers the full request body** — BiDi streaming sends the initial `AgentRunRequest` as an envelope-framed stream that the client doesn't close until the conversation ends, creating a deadlock
- **`java.net.http.HttpClient` is HTTP/1.1 for upstream** — the current controller cannot maintain a full-duplex HTTP/2 stream to `api2.cursor.sh`
- **Phase 1 billing workaround** (`recordCursorUsage` in Java workflows) relies on runner-reported data, which is display-only and not proxy-authoritative

## Solution

A dedicated Netty HTTP/2 server on port 8082 that sits alongside the existing gRPC server (8080) and Tomcat (8081) in the same JVM. It speaks h2c inbound (from the runner's `connect-node`), maintains h2+TLS upstream (to `api2.cursor.sh`), and relays frames bidirectionally without buffering — while teeing response data through the existing `ConnectCursorUsageExtractor` for billing.

## Implementation Details

### New classes (stigmer-cloud)

| Class | Purpose |
|-------|---------|
| `CursorBidiProxyServer` | Spring `SmartLifecycle` component — Netty `ServerBootstrap` with `Http2FrameCodec` + `Http2MultiplexHandler`, auth executor group, graceful GOAWAY+drain shutdown |
| `CursorBidiStreamHandler` | Per-stream handler with 5-phase state machine (AWAITING_HEADERS → AUTHENTICATING → RELAYING → COMPLETING → DONE), auth offloading, ByteBuf lifecycle, usage reporting |
| `CursorBidiUpstreamClient` | HTTP/2+TLS connection to `api2.cursor.sh` with JDK SSL + ALPN h2, GOAWAY-aware reconnect, stream multiplexing |
| `CursorBidiProxyProperties` | `@ConfigurationProperties("stigmer.proxy.cursor.bidi")` — port, enabled, upstream host/port |
| `ConnectModelExtractor` | Envelope-aware model ID extraction from streaming request bodies using `ConnectEnvelopeDecoder` + `ProtobufFieldScanner` |

### Key design decisions

- **Auth offloading**: `AuthenticationManager.authenticate()` is blocking (JWKS fetch, DB lookup). Runs on a `DefaultEventExecutorGroup(4)`, not the Netty event loop. DATA frames arriving during auth are buffered with `ByteBuf.retain()` and flushed after auth succeeds.
- **Zero porting**: Reuses existing tested infrastructure — `ConnectEnvelopeDecoder` (10 tests), `ConnectCursorUsageExtractor` (12 tests), `ProxyAuthorizationService`, `ProxyUsageReporter`, `ProxyCallSequencer`, `CursorModelResolver`
- **Standard Netty alongside shaded**: Added `io.netty:*:4.1.100.Final` (8 artifacts) to `MODULE.bazel`. The shaded Netty in `grpc-netty-shaded` uses relocated packages (`io.grpc.netty.shaded.io.netty.*`) — no classpath conflict.
- **Upstream TLS**: `SslContextBuilder.forClient()` with JVM default trust store + ALPN h2. Single connection, lazily created, multiplexed streams.

### Tests

- `ConnectModelExtractorTest` — 12 test cases covering envelope framing, chunked delivery, edge cases
- `CursorBidiStreamHandlerTest` — 8 test cases for bearer token extraction logic
- `CursorBidiProxyIntegrationTest` — Real Netty h2c server + mock upstream, auth rejection and relay verification with PARANOID leak detection

### Refactored

- `CursorProxyController.extractModelFromConnectRequest` now delegates to shared `ConnectModelExtractor.extractModelFromPayload`

## Benefits

- **Proxy-authoritative billing**: Usage metering happens at the wire level — no dependency on runner-reported data
- **Full-duplex streaming**: Handles Connect RPC BiDi that Tomcat cannot serve
- **Zero-copy extraction**: Response bytes are teed through extractors during relay — no additional buffering
- **Same auth chain**: Reuses `AuthenticationManager` and `ProxyAuthorizationService` beans, ensuring consistent JWT/API-key validation across all transports

## Impact

- **stigmer-cloud**: 5 new Java classes, 3 test classes, BUILD.bazel + MODULE.bazel deps, application.yaml config
- **Billing pipeline**: When wired (Tasks 2-5), proxy-observed usage replaces runner-reported data as the authoritative billing source
- **Runtime**: New Netty listener on port 8082 — no impact on existing 8080/8081 listeners

## Related Work

- Phase 1 billing fix: `_changelog/2026-05/2026-05-31-154028-fix-cursor-billing-pipeline-phase1.md`
- Billing trust ladder sketch: `_changelog/2026-05/2026-05-29-134102-cursor-billing-trust-ladder-sketch.md`
- Project tracker: `_projects/2026-05/20260531.01.cursor-bidi-proxy-phase2/`

---

**Status**: ✅ Production Ready (handler implementation complete; runner wiring is Task 2)
**Timeline**: Task 1 of 6 in the Phase 2 project
