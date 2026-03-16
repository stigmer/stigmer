# Java SDK Handwritten Public API Layer

**Date**: March 16, 2026

## Summary

Added the handwritten public API layer for the Java SDK, completing the bridge between the 45 generated files (from Task 2) and a Stripe-style developer experience. Users can now create a `StigmerClient`, configure transport, and access all 17 resource sub-clients plus cross-resource search through a clean builder-based API.

## Problem Statement

Task 2 produced a complete set of generated Java SDK code (17 resource clients, 17 input types, 11 shared types) but left them as internal implementation details with no public entry point. Users had no way to:

- Establish a gRPC connection with TLS and API key authentication
- Access resource clients through a unified top-level client
- Perform cross-resource search
- Manage connection lifecycle (shutdown, try-with-resources)

### Pain Points

- Generated code lives in `internal.gen` with no public wrapper
- No transport setup (gRPC channel, TLS, auth interceptor)
- No build tooling (Makefile) for the Java SDK
- No tests for the handwritten layer

## Solution

Created a minimal handwritten layer following the exact same architecture as the Go SDK: transport package for gRPC channel setup, a top-level `StigmerClient` with builder pattern, and a `SearchClient` for cross-resource queries. All resource sub-clients are exposed via plural accessor methods delegating to the generated `GeneratedClient`.

## Implementation Details

### Transport Layer (`ai.stigmer.sdk.internal.transport`)

- **`ApiKeyInterceptor`**: A `ClientInterceptor` that injects `Authorization: Bearer <key>` into gRPC metadata on every call (both unary and streaming). Package-private -- only used by `StigmerChannel`.
- **`StigmerChannel`**: Factory with `static ManagedChannel create(Config)`. Uses `NettyChannelBuilder` with TLS by default (system trust store), falls back to plaintext via `ManagedChannelBuilder.usePlaintext()` when insecure mode is requested.

### Public API (`ai.stigmer.sdk`)

- **`StigmerClient`**: Top-level client implementing `AutoCloseable`. Builder pattern with API key as required constructor parameter: `StigmerClient.builder("sk_live_abc123").baseUrl("...").insecure().build()`. Owns the `ManagedChannel`, `GeneratedClient`, and `SearchClient`. Exposes 17 sub-client accessor methods (`agents()`, `skills()`, `sessions()`, etc.) plus `search()`. Graceful shutdown in `close()` with 5-second timeout.
- **`SearchClient`**: Cross-resource search using `SearchServiceGrpc.SearchServiceBlockingStub`. Inner `SearchParams` class with builder (kinds, query, org, excludePublic, page). Inner `SearchResponse` class (entries, totalCount, totalPages). Wraps gRPC errors via `StigmerException.wrap()`.

### Build Tooling

- Updated `pom.xml`: renamed artifactId from `stigmer-java-sdk` to `stigmer-java`, added `grpc-netty-shaded` (TLS transport), JUnit 5, `maven-compiler-plugin` 3.13.0, `maven-surefire-plugin` 3.5.2.
- New `Makefile` with targets: `codegen-clients`, `codegen`, `build`, `test`, `verify`, `codegen-verify`, `clean`.

### Design Decisions

1. **No separate `StigmerClientOptions`** -- builder on `StigmerClient` encapsulates all options, matching the Go SDK's private `clientConfig` pattern.
2. **No handwritten `StigmerException`/`ErrorCode`** -- generated versions in `internal.gen` are already well-designed (unchecked `RuntimeException`, instance methods like `isNotFound()`). Duplication would create import confusion.
3. **`grpc-netty-shaded`** -- shaded variant avoids Netty version conflicts with user dependencies. Standard choice for server-side Java gRPC clients.
4. **API key as required builder constructor param** -- `StigmerClient.builder(apiKey)` provides compile-time enforcement.

## Benefits

- Java developers can now use the Stigmer API with a familiar, Stripe-style interface
- Try-with-resources support ensures proper connection lifecycle management
- TLS enabled by default with zero configuration
- Consistent architecture across Go, TypeScript, and Java SDKs
- Full codegen pipeline support via Makefile targets

## Impact

- **SDK consumers**: Java developers can now build against the Stigmer platform
- **SDK maintainers**: Makefile provides regeneration, compilation, and test verification in one command
- **Cross-SDK consistency**: Same architectural patterns as Go and TypeScript SDKs

## Files Changed

**New files (6):**
- `sdk/java/src/main/java/ai/stigmer/sdk/StigmerClient.java`
- `sdk/java/src/main/java/ai/stigmer/sdk/SearchClient.java`
- `sdk/java/src/main/java/ai/stigmer/sdk/internal/transport/ApiKeyInterceptor.java`
- `sdk/java/src/main/java/ai/stigmer/sdk/internal/transport/StigmerChannel.java`
- `sdk/java/src/test/java/ai/stigmer/sdk/StigmerClientTest.java`
- `sdk/java/Makefile`

**Modified files (1):**
- `sdk/java/pom.xml`

## Related Work

- `2026-03-16-132834-java-sdk-codegen-all-resources.md` -- Task 2: Java SDK codegen generator
- `2026-03-16-123903-java-proto-stub-generation.md` -- Task 1: Java proto stubs via Buf
- `2026-03-16-112653-go-sdk-stripe-style-restructure.md` -- Go SDK architectural reference

---

**Status**: Production Ready
**Timeline**: Task 3 of 5 in java-sdk-codegen project
