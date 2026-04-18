# Design Decision 005: SDK PlatformClient Auth Design Supersedes T05_0_plan.md

**Date**: 2026-04-17
**Task**: T05 (SDK Client Support for PlatformClient Auth)
**Status**: Accepted
**Supersedes**: T05_0_plan.md (original plan, pre-Session-3)

## Context

`tasks/T05_0_plan.md` was authored during initial planning before Session 3's gRPC pivot (see Session 3 notes in `next-task.md`). It makes four assumptions that no longer hold.

## What Changed

### 1. No OAuth2 `client_credentials` Grant

The original plan assumed a two-step flow: exchange `client_id + client_secret` for a backend bearer token via `POST /oauth/token` with `grant_type=client_credentials`, then use that bearer for subsequent API calls.

**Reality**: Session 3 changed the token endpoint from REST to gRPC (Connect). `mintUserToken` (`token.proto`) is a single public RPC that takes `client_id + client_secret + user identity` inline and returns a user-scoped JWT. There is no backend-to-backend bearer. Server-to-server calls from platform builders continue to use `ApiKey`.

### 2. No SDK-Level Token Caching

The original plan called for the SDK to cache the client-credentials token and refresh it before expiry.

**Reality**: The token returned by `mintUserToken` is user-keyed. Caching it requires a user-keyed store (memory bounds, eviction, multi-instance deployment, optional Redis backplane). These are the platform builder's concerns — they know session boundaries and infrastructure. The SDK returns `{ accessToken, expiresAt }` and leaves caching to the caller. Adding caching later is non-breaking; adding it now locks in assumptions.

### 3. Method Name is `mintUserToken`, Not `createUserToken`

Session 1 explicitly chose `mintUserToken` over `createToken` — precise, avoids CRUD collision. The proto follows this. The SDK must mirror it.

### 4. Java SDK Was Omitted

The original plan scoped T05 to "Node/Go/Python." `sdk/java` is a first-class peer SDK published as `ai.stigmer:stigmer-java` with identical architectural shape. Codegen already produced `PlatformClientClient.mintUserToken` in the Java SDK. Shipping without Java violates the cross-surface consistency mandate.

## Decision

Implement a purpose-built, minimal helper per SDK (`createPlatformClientAuth` in TypeScript, `NewPlatformClientAuth` in Go, `platform_client_auth` in Python, `PlatformClientAuth.builder(...)` in Java) that:

- Exposes a single `mintUserToken(input)` method delegating to the generated client
- Maps the wire `expires_in` to an absolute `expiresAt` timestamp
- Maps proto error codes to actionable error messages (UNAUTHENTICATED, NOT_FOUND, FAILED_PRECONDITION, PERMISSION_DENIED)
- Does not modify the main Stigmer client's auth modes
- Does not cache tokens
- Does not export from the browser entry point (TypeScript)

## Why Not Modify the Main Client?

- `clientId + clientSecret` is not a third auth mode. It does not replace `apiKey` for server-to-server calls. Adding it to the main client config would imply it does.
- The helper has a different lifecycle: it doesn't need org context, resource clients, or search. Coupling it to the full client adds weight for no value.
- A separate primitive is easier to document ("mint tokens for your users") and harder to misuse ("this is not for server-to-server calls").

## Consequences

- `T05_0_plan.md` remains in-repo for historical context but is superseded by this decision and the revised implementation.
- All four SDKs (TypeScript, Go, Python, Java) ship the helper simultaneously.
- The browser SDK (`@stigmer/sdk` default entry, `@stigmer/react`) requires no code changes. The existing `StigmerProvider` + `getAccessToken` callback is the complete browser-side story.
