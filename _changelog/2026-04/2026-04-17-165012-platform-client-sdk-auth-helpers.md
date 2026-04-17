# PlatformClient SDK Auth Helpers (T05)

**Date**: April 17, 2026

## Summary

Implemented purpose-built PlatformClient token-minting helpers across all four Stigmer SDKs — TypeScript (`@stigmer/sdk/node`), Go (`sdk/go`), Python (`sdk/python`), and Java (`sdk/java`) — completing T05 of the PlatformClient project. Platform builders can now mint user-scoped Stigmer JWTs from their backends with a single, minimal API surface; the returned tokens are passed to the React SDK's `StigmerProvider` via its existing `getAccessToken` callback. A comprehensive integration guide with backend snippets in all four languages and a runnable Node example ship alongside the code.

## Problem Statement

T04 completed the backend: the `mintUserToken` gRPC RPC is live, Stigmer-signed JWTs are validated through the auth chain, and JIT provisioning is wired end-to-end. But platform builders had no ergonomic path to call `mintUserToken` from their own backend code. The generated clients existed in all four SDKs (from codegen), but exposed the raw proto types: platform builders would have to construct `MintUserTokenRequest` by hand, manage their own gRPC channel, map `expires_in` (seconds) to an absolute timestamp manually, and discover the endpoint themselves.

The in-repo T05 plan (`tasks/T05_0_plan.md`) predated Session 3's gRPC pivot and carried three stale assumptions plus one scoping omission, which are documented and superseded by this work.

### Pain Points

- No discoverable entry point for PlatformClient token minting — platform builders had to find the generated `mintUserToken` method inside a resource CRUD client that also exposed unrelated operations (`create`, `update`, `delete`, `rotateSecret`, etc.)
- Raw proto types (`MintUserTokenRequest`, `MintUserTokenResponse`) are unergonomic — snake_case fields, no absolute expiry timestamp, no actionable error messages
- `validateConfig` in the TypeScript SDK required an API key or `getAccessToken` even for platform builders whose backend only mints tokens (they have no other use for the main Stigmer client)
- No integration documentation — the flow from "create a PlatformClient in the Console" to "token in a React component" was undocumented
- Risk of copy-paste footguns: a platform builder putting `clientSecret` in the browser config because nothing in the SDK told them not to

## Solution

A purpose-built, minimal helper per SDK with a single responsibility — mint user-scoped Stigmer JWTs. Not an addition to the main `Stigmer` client, not a new auth mode, not a token cache. One primitive, one job.

### Cross-cutting design decisions

- **`mintUserToken` method name** — mirrors the proto and the Session 1 naming decision (precise, avoids CRUD collision with "create")
- **No SDK-level token caching** — the token is user-keyed; caching strategy (memory bounds, eviction, Redis backplane, session boundaries) belongs to the platform builder's backend
- **No changes to main client auth modes** — `apiKey` and `getAccessToken` remain the only auth modes on `Stigmer` / `createNodeClient` / `NewClient` / `StigmerClient`; this helper is a separate primitive
- **No changes to `@stigmer/react`** — the existing `StigmerProvider` + `getAccessToken` callback is the complete browser story; no new hooks or components needed
- **Server-only by construction (TypeScript)** — exported from `@stigmer/sdk/node` only; never from the browser entry. The split entry is the architectural guard; no runtime checks needed
- **`expiresAt` as absolute timestamp** — SDK computes `Date`/`time.Time`/`datetime`/`Instant` from the wire `expires_in` so callers don't have to

## Implementation Details

### Design decision document

- `_projects/2026-04/20260417.01.platform-client/design-decisions/005-t05-sdk-design-supersedes-original-plan.md` — records the supersession of `T05_0_plan.md`, listing the four stale assumptions (no `client_credentials` grant, no SDK caching, `mintUserToken` naming, Java inclusion) and the reasoning for each.

### TypeScript SDK (`@stigmer/sdk/node`)

- `sdk/typescript/src/platform-client-auth.ts` — hand-written `PlatformClientAuth` class and `createPlatformClientAuth(config)` factory
- Factory validates `baseUrl`, `clientId`, `clientSecret` up front; throws actionable `Error` with guidance ("find it in the Stigmer Console under IAM > Platform Clients")
- Uses `@connectrpc/connect-node` with `rpcMetadataInterceptor` and `errorStripInterceptor` — no auth interceptor (`mintUserToken` is a public RPC; credentials travel in the request body)
- `MintUserTokenInput` uses camelCase ergonomic fields (`userId`, `userEmail`, `userName`, `orgId`); `MintUserTokenResult` adds `expiresAt: Date` computed from `expires_in * 1000 + Date.now()`
- Input validation throws `StigmerError` with `invalid-argument` code
- `sdk/typescript/src/node.ts` re-exports the factory, types, and class from `@stigmer/sdk/node`
- `sdk/typescript/src/index.ts` (browser entry) unchanged — helper is not accessible from the browser build
- `sdk/typescript/src/__tests__/platform-client-auth.test.ts` — 6 tests covering config validation, factory success, and input validation (all passing via `vitest run`)

### Go SDK (`sdk/go`)

- `sdk/go/platform_client_auth.go` — `PlatformClientAuth` struct, `NewPlatformClientAuth(opts ...PlatformClientAuthOption)` factory, functional options (`WithPlatformClientCredentials`, `WithPlatformClientBaseURL`, `WithPlatformClientInsecure`)
- `MintUserTokenInput` / `MintUserTokenResult` structs; `ExpiresAt` is `time.Time`
- Dials its own `grpc.ClientConn` via the existing `sdk/go/internal/transport` package (no bearer token attached — consistent with the public RPC contract)
- `MintUserToken(ctx, input)` validates `UserID` up front, returns `&gen.Error{Code: CodeInvalidArgument}` via the generated error type
- Implements `Close() error` for clean channel shutdown
- `sdk/go/platform_client_auth_test.go` — 5 tests covering option validation, successful construction, and input validation (all passing via `go test ./...`; `go build ./...` clean)
- `sdk/go/examples/mint_user_token.go` — idiom-matching example following the existing `basic_crud.go` / `error_handling.go` style

### Python SDK (`sdk/python`)

- `sdk/python/src/stigmer/platform_client_auth.py` — `PlatformClientAuth` class with `platform_client_auth(...)` factory
- `MintUserTokenInput` / `MintUserTokenResult` as frozen `@dataclass` types; `expires_at` is timezone-aware UTC `datetime`
- Context manager support (`__enter__`/`__exit__`) so callers can use `with platform_client_auth(...) as auth:`
- No interceptors — consistent with the public-RPC contract
- `ValueError` raised for missing config; `StigmerError` with `ErrorCode.INVALID_ARGUMENT` raised for missing `user_id`
- Re-exported via `sdk/python/src/stigmer/__init__.py` alongside the main client's public surface
- `sdk/python/tests/test_platform_client_auth.py` — pytest suite covering factory validation, success path, context-manager usage, and input validation
- Created `sdk/python/tests/` directory (did not exist previously)

### Java SDK (`sdk/java`)

- `sdk/java/src/main/java/ai/stigmer/sdk/PlatformClientAuth.java` — public final class with `PlatformClientAuth.builder(baseUrl)` static factory, matching the existing `StigmerClient.builder(...)` idiom
- Builder validates `clientId` and `clientSecret` on `build()` and throws `IllegalArgumentException` with actionable messages
- Implements `AutoCloseable` with graceful shutdown (5-second timeout, matches `StigmerClient.close()`)
- Uses `ManagedChannelBuilder` / `NettyChannelBuilder` for secure/insecure modes; no `ApiKeyInterceptor` (public RPC)
- `MintUserTokenInput.java` — builder-pattern input with `userId`, `userEmail`, `userName`, `orgId`
- `MintUserTokenResult.java` — immutable result with `accessToken()`, `tokenType()`, `expiresIn()`, and `expiresAt()` as `java.time.Instant`
- Input validation throws `StigmerException` with `ErrorCode.INVALID_ARGUMENT` via the generated error type; RPC errors are wrapped by `StigmerException.wrap(StatusRuntimeException)`
- `sdk/java/src/test/java/ai/stigmer/sdk/PlatformClientAuthTest.java` — 7 JUnit 5 tests covering builder validation, successful construction, idempotent close, and input validation

### Documentation

- `docs/guides/platform-client-auth.mdx` — comprehensive integration guide:
  - Mermaid sequence diagram of the end-to-end flow
  - Backend snippets in all four languages (TypeScript/Node, Go, Python, Java)
  - React `StigmerProvider` + `getAccessToken` wiring with a cache-respecting fetcher
  - JIT provisioning configuration table
  - Error handling matrix (UNAUTHENTICATED, NOT_FOUND, FAILED_PRECONDITION, PERMISSION_DENIED) mapped to root causes and remediations
  - Security notes: secret is server-only, rotation is immediate, no JWKS endpoint (yet)
  - "What this is NOT" callout clarifying the boundary with API keys and OIDC federation
- Registered in `docs/guides/meta.json`

### Runnable example

- `sdk/typescript/examples/mint-user-token.ts` — Express-based `/api/stigmer-token` endpoint ready for a React frontend to fetch from via `getAccessToken`

### Session artifacts

- `_projects/2026-04/20260417.01.platform-client/checkpoints/2026-04-17-session-5.md` — session checkpoint with accomplishments, decisions, and file inventory
- `_projects/2026-04/20260417.01.platform-client/next-task.md` — updated to reflect T05 complete and T06 (Console UI + documentation) as next-up

## Benefits

- **Every SDK, same shape, same day.** Enterprise Java platform builders are not a second-class audience; they get PlatformClient support with the same ergonomics as TypeScript, Go, and Python.
- **Discoverable.** `createPlatformClientAuth`, `NewPlatformClientAuth`, `platform_client_auth`, `PlatformClientAuth.builder(...)` — each is the obvious entry point for its language; no digging through a resource CRUD client to find the token method.
- **Minimal required configuration.** Three inputs (`baseUrl`, `clientId`, `clientSecret`) to construct; one required input (`userId`) to mint. Defaults and optional fields are sensible.
- **Actionable errors.** "Find it in the Stigmer Console under IAM > Platform Clients" rather than "client_id must not be null". Error messages are a UX surface; we treat them like one.
- **Safe by construction.** The TypeScript helper physically cannot ship in a browser bundle via the `@stigmer/sdk/node` subpath. No runtime checks; the architecture is the guard.
- **Zero token caching complexity in the SDK.** Platform builders — not the SDK — decide session boundaries, user-keying strategy, and multi-instance coordination. Non-breaking to add later if real-world usage demands it.
- **No change to existing auth modes.** No risk to any existing integrator; `apiKey` and `getAccessToken` behave identically.

## Impact

**Who is affected:**

- **Platform builders integrating Stigmer into their products (primary audience).** They now have a 5-minute path from "I created a PlatformClient in the Console" to "my users can call Stigmer from my React app." The integration guide gives them the complete wiring diagram in their language of choice.
- **Stigmer's own demo and reference integrations.** Future Console demos and scenario flows can use these helpers directly rather than hand-rolling gRPC calls.
- **Internal engineers working on Console UI (T06 audience).** The Console's forthcoming PlatformClient CRUD pages can reference these SDKs for any server-side integration demos.

**What is unaffected:**

- The main `Stigmer` client and all existing SDK operations
- `@stigmer/react` — no new exports, no behavior changes
- The browser `@stigmer/sdk` entry
- All four SDKs' existing tests

## Related Work

- Project root: `_projects/2026-04/20260417.01.platform-client/`
- T01 (proto definition): `2026-04-17-110512-platformclient-proto-definition.md`
- T02 (backend CRUD): `2026-04-17-114806-platform-client-backend-crud.md`
- T03 (mintUserToken public): `2026-04-17-150854-platformclient-mint-user-token-is-public.md`
- T04 (auth chain + JIT): `2026-04-17-160746-platform-client-auth-chain-jit-provisioning.md`
- Supersedes: `_projects/2026-04/20260417.01.platform-client/tasks/T05_0_plan.md` (see DD-005)
- Next up: T06 (Console UI + documentation)

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
