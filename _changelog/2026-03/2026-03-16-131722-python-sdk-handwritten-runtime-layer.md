# Python SDK Handwritten Runtime Layer

**Date**: March 16, 2026

## Summary

Created the 7 handwritten runtime files that form the Python SDK's transport, auth, and public API layer. These sit on top of the 21 generated files from Task 1 and give users a clean `StigmerClient(api_key)` entry point with full type safety, context manager support, and cross-resource search.

## Problem Statement

Task 1 produced 21 generated files under `sdk/python/src/stigmer/_gen/` — resource clients, input dataclasses, error types, and a `GeneratedClient` aggregate. But the generated code requires a raw `grpc.Channel` and exposes internal structure that users should not depend on. Without a handwritten layer, users would need to:

### Pain Points

- Manually create gRPC channels with TLS credentials and interceptors
- Know about `GeneratedClient` (an implementation detail)
- Manage the `authorization: Bearer` header themselves on every call
- Import from `stigmer._gen._agent` instead of just `stigmer`
- Have no `SearchClient` for cross-resource queries

## Solution

A thin handwritten runtime layer following the exact same architecture as the Go SDK (`sdk/go/`): transport factory, auth interceptors, client wrapper, search client, and a clean public API surface. The Python layer adapts Go's patterns to Python idioms (keyword args instead of functional options, context managers for cleanup, dataclasses for search params).

## Implementation Details

### Transport (`_transport.py`)

`create_channel()` factory that produces a `grpc.Channel` with auth interceptors applied:
- TLS via `grpc.ssl_channel_credentials()` by default
- `insecure=True` for local development
- Auth injected via `grpc.intercept_channel()` (not `composite_channel_credentials`, which requires TLS)

### Interceptors (`_interceptors.py`)

`AuthInterceptor` implementing `UnaryUnaryClientInterceptor` and `UnaryStreamClientInterceptor`:
- Pre-computes `Bearer <token>` once at construction (same as Go)
- `_ClientCallDetails` wrapper for metadata modification (required by Python gRPC's read-only `ClientCallDetails`)
- Covers both unary RPCs and server-streaming (`subscribe()`)

### Client (`_client.py`)

`StigmerClient` wrapping `GeneratedClient` + `SearchClient`:
- Validates API key, creates channel, wires all 17 sub-clients as typed attributes
- Context manager support (`with StigmerClient(...) as client:`)
- `close()` for manual channel cleanup
- Class-level type annotations for IDE autocomplete on all 18 attributes

### Search (`_search.py`)

`SearchClient` for cross-resource queries:
- `SearchParams` / `SearchResponse` dataclasses
- `ApiResourceKind` re-exported from proto stubs
- Error wrapping via `_gen._errors.wrap_error`

### Public API (`__init__.py`)

71 exports in `__all__`:
- `StigmerClient`, search types, all resource clients, all input dataclasses, shared types, error types
- Excludes internals: `wrap_error`, `GeneratedClient`

### Package (`pyproject.toml`)

- Build backend: `hatchling` (PEP 517/621)
- Dependencies: `grpcio>=1.60.0`, `protobuf>=6.32.0`, `stigmer-stubs>=0.1.0`
- `py.typed` marker for PEP 561 compliance

## Benefits

- **Clean API**: `StigmerClient("sk_live_abc")` — one line to connect
- **Full type safety**: 71 typed exports, 18 annotated sub-client attributes, PEP 561 compliant
- **Pythonic patterns**: keyword args, context managers, dataclasses
- **Cross-SDK consistency**: Same architecture as Go SDK (transport/interceptors/client/search)
- **Extensible**: Interceptor chain can grow (logging, retries) without API changes

## Impact

- Python developers can now use the Stigmer platform with a fully typed, idiomatic SDK
- The SDK is installable via `pip install -e sdk/python/` for development
- Foundation is set for Task 3 (build pipeline) and Task 4 (PyPI publishing)

## Related Work

- [Python SDK Codegen Generator](2026-03-16-125909-python-sdk-codegen-generator.md) — Task 1 that produced the 21 generated files
- [Go SDK Stripe-style Restructure](2026-03-16-112653-go-sdk-stripe-style-restructure.md) — Architecture pattern this follows
- [TypeScript SDK Codegen](2026-03-16-123359-typescript-sdk-codegen-all-resources.md) — Sibling SDK with similar structure

---

**Status**: Production Ready
**Timeline**: ~1 hour
