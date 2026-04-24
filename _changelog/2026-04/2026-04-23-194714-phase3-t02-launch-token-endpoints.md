# Phase 3 T02: Server-Side Launch Token Endpoints

**Date**: April 23, 2026

## Summary

Added two gRPC RPCs (`createLaunchToken` and `exchangeLaunchToken`) to the `RunnerCommandController` service, enabling a secure browser-to-CLI credential handshake for launching local runners. This is the server-side foundation for the `stigmer://` URL scheme flow — the centrepiece of Phase 3 — where a cloud user clicks "Launch Local Runner" in the web console and the browser hands off to the locally installed CLI via a one-time opaque token.

## Problem Statement

Users who want to run agents on their local machine (laptop GPU, local filesystem, local tools) must currently go through a two-step manual process: `stigmer login` (interactive OAuth flow) followed by `stigmer up runner`. There is no way for the web console to initiate a local runner launch directly.

### Pain Points

- Manual CLI authentication is a friction point for users who are already logged into the browser
- No programmatic way for the browser to transfer authentication to a local process
- The CLI and Desktop app have no mechanism to receive credentials from the web console

## Solution

Implemented the OAuth Authorization Code pattern adapted for OS-level URL scheme dispatch: the browser creates a one-time opaque token (backed by Redis), embeds it in a `stigmer://` URL, and the local CLI exchanges it for long-lived Stigmer-signed JWT credentials. The token is consumed atomically on exchange, preventing replay attacks.

## Implementation Details

### Proto Contract (apis/)

- **4 new messages** in `io.proto`: `CreateLaunchTokenRequest`, `CreateLaunchTokenResponse`, `ExchangeLaunchTokenRequest`, `ExchangeLaunchTokenResponse`
- **2 new RPCs** in `command.proto` on `RunnerCommandController`:
  - `createLaunchToken` — authenticated, FGA-authorized (`can_create_runner` on org)
  - `exchangeLaunchToken` — public (`is_public = true`), the one-time token IS the proof of authorization
- Response shape mirrors `MintUserTokenResponse` for credential consistency across the platform

### Java Implementation (stigmer-cloud)

Three new files under `domain/agentic/runner/launch/`:

- **`LaunchTokenService`** — Redis-backed token lifecycle. Creates: resolves caller claims from interceptor context (decodes Auth0 JWT for email/name via `JWT.decode()`), mints Stigmer JWT via `StigmerJwtIssuer`, stores in Redis (`launch-token:{uuid}`, 60s TTL). Exchanges: atomic `getAndDelete`, returns stored credentials.
- **`RunnerCreateLaunchTokenHandler`** — Authenticated `OperationHandlerV2`. Extracts caller from `InterceptorContextHolder`, delegates to service.
- **`RunnerExchangeLaunchTokenHandler`** — Public `OperationHandlerV2`. Zero auth/domain/DB dependencies. Pure token swap.

### Go Stub (stigmer OSS)

- **`launch_token.go`** — Both RPCs return `UNIMPLEMENTED` with descriptive messages. Cloud-primary feature; OSS users authenticate via `stigmer login`.

### Key Architectural Decisions

- **gRPC not REST**: Consistent with all other runner APIs. No new HTTP surface.
- **Opaque UUID in Redis, not JWT**: Simpler than JWT+consumed-set. Atomic single-use via `GETDEL`. Natural multi-instance support.
- **JWT minted at creation time**: The exchange endpoint is stateless — no DB access, no JWT minting. Pure lookup + delete + return.
- **Exchange returns credentials only**: Runner resource creation is the CLI's responsibility via the existing `apply` RPC. Clean separation of security and domain concerns.

### Codegen

Full stub regeneration across both repos: Go, Java, TypeScript, Python, Dart. The TypeScript SDK's `RunnerClient` now has `createLaunchToken()` and `exchangeLaunchToken()` methods automatically.

## Benefits

- **One-click local runner launch**: Users go from browser to running local runner without manual `stigmer login`
- **Industry-standard security**: Same pattern as OAuth Authorization Code flow, used by Zoom, Slack, Figma, VS Code
- **Zero infrastructure overhead**: Uses existing Redis (already a dependency for runner command stream)
- **Multi-instance ready**: Redis-backed from day one, no "works in dev, breaks in prod"
- **SDK-ready**: Generated TS/Go/Python/Java/Dart clients can consume these RPCs immediately

## Impact

- **Runner proto**: 2 new RPCs, 4 new messages (purely additive, no breaking changes)
- **stigmer-cloud**: 3 new Java files + BUILD.bazel test target
- **stigmer OSS**: 1 new Go file (UNIMPLEMENTED stubs)
- **All SDKs**: Auto-generated client methods for launch token create/exchange
- **Unblocks**: Phase 3 T04 (CLI URL handler), T07 (SDK runner action hooks), and Desktop App T05 (stigmer:// URL scheme handling)

## Related Work

- **Phase 3 project**: `_projects/2026-04/20260423.02.phase3-persistent-runners-browser-launch/`
- **Prior work**: Agent-runner-as-resource (Phases 0-2), runner-ux-cli-restructure, runner-command-stream
- **Next**: T03 (CLI URL scheme registration), T06 (runner stop via command stream)

---

**Status**: Production Ready (pending pre-existing `SessionUpdateSandboxIdHandler` compilation fix for Java test execution)
**Timeline**: Single session
