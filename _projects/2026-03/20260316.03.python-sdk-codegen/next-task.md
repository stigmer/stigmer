# Next Task: 20260316.03.python-sdk-codegen

## Current State
- **Status**: in-progress
- **Last Session**: 2026-03-16 — Completed Task 2 (Scaffold sdk/python handwritten runtime layer)
- **Active Task**: Task 3 (Wire codegen into build pipeline)

## Session Progress (2026-03-16, Session 2)
- Created 7 handwritten runtime files for `sdk/python/src/stigmer/`
- `_interceptors.py` — `AuthInterceptor` with `_ClientCallDetails` wrapper, handles unary + server-streaming RPCs
- `_transport.py` — `create_channel()` factory with TLS/insecure support, applies interceptors via `grpc.intercept_channel()`
- `_search.py` — `SearchClient`, `SearchParams`, `SearchResponse` dataclasses for cross-resource search
- `_client.py` — `StigmerClient` wrapping `GeneratedClient` (17 sub-clients) + `SearchClient`, context manager support
- `__init__.py` — Public API surface with 71 exports in `__all__`
- `pyproject.toml` — Package metadata with hatchling build backend, dependencies on grpcio/protobuf/stigmer-stubs
- `py.typed` — PEP 561 marker for inline type support
- Validated: syntax check, editable install, all 71 exports resolve, all 18 sub-client type annotations correct, interceptor metadata injection tested, channel creation tested, context manager verified

## Next Steps
1. **Task 3**: Wire codegen into build pipeline — `sdk/python/Makefile`, root `make protos` integration, `codegen-verify` target
2. **Task 4**: PyPI publishing setup — Trusted Publishers, GitHub Actions workflow, README

## Context for Resume

### Key Decisions Made (Session 2)
- **Transport**: `grpc.intercept_channel()` with custom interceptors (not `composite_channel_credentials`) — works with both secure and insecure channels, matches Go SDK pattern
- **No `_options.py`**: Python keyword args on `StigmerClient.__init__()` replace Go's functional options pattern — simpler, idiomatic
- **No handwritten `errors.py`**: Generated `_gen/_errors.py` provides everything needed; TypeScript's extra `ErrorCategory`/`getUserMessage` layer is UI-specific, not needed for Python
- **Public API excludes internals**: `wrap_error` and `GeneratedClient` are not re-exported — they're implementation details
- **Build backend**: `hatchling` (PEP 517/621) instead of `poetry-core` — lighter, no lockfile requirement
- **Sync-only**: No async (`grpc.aio`) in initial release — follow-up work

### Handwritten File Structure
```
sdk/python/
├── pyproject.toml                    (hatchling build, dependencies)
└── src/stigmer/
    ├── __init__.py                   (71 public exports)
    ├── py.typed                      (PEP 561 marker)
    ├── _client.py                    (StigmerClient — entry point)
    ├── _transport.py                 (gRPC channel factory)
    ├── _interceptors.py              (auth metadata interceptor)
    ├── _search.py                    (cross-resource search client)
    └── _gen/                         (codegen output — 21 files from Task 1)
```

### Validation Results
- All `.py` files pass `ast.parse()` syntax validation
- `pip install -e` succeeds for both `stigmer-stubs` and `stigmer`
- All 71 names in `__all__` resolve to real objects
- All 18 `StigmerClient` attributes properly typed (IDE-discoverable)
- `AuthInterceptor` correctly injects `authorization: Bearer <token>` for both unary and streaming, preserves pre-existing metadata
- Empty API key rejected with `ValueError`
- Context manager (`with StigmerClient(...):`) works correctly

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260316.03.python-sdk-codegen/next-task.md`
