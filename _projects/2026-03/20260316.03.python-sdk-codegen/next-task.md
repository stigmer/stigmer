# Next Task: 20260316.03.python-sdk-codegen

## Current State
- **Status**: in-progress
- **Last Session**: 2026-03-16 — Completed Task 1 (Python codegen generator)
- **Active Task**: Task 2 (Scaffold sdk/python package)

## Session Progress (2026-03-16)
- Created `tools/codegen/generator/sdk_client_python.go` (~850 lines)
- Registered `sdk-client-python` target in `main.go`
- Generator produces 21 Python files: 17 resource clients, `_client.py`, `_errors.py`, `_types.py`, `__init__.py`
- Fixed 3 bugs during verification: enum defaults, ApiResourceId case ordering, Python keyword collisions (`as` → `as_`)
- All generated files pass `python3 -c "import ast; ast.parse(...)"` syntax validation
- Verified: import paths (`from ai.stigmer...`), stub method names (lowerCamelCase), type annotations, dataclass field ordering

## Next Steps
1. **Task 2**: Scaffold `sdk/python` package — handwritten transport layer, `StigmerClient` wrapper, `pyproject.toml`, interceptors, `_search.py`
2. **Task 3**: Wire codegen into build pipeline — `Makefile`, root `make protos` integration
3. **Task 4**: PyPI publishing setup — Trusted Publishers, GitHub Actions workflow

## Context for Resume

### Key Decisions Made
- Import paths use `from ai.stigmer...` (no `stigmer.` prefix) — matching the actual pyproject.toml package layout
- Fields that collide with Python keywords get trailing underscore (`as` → `as_`) with `setattr()` for proto assignment
- Target name is `sdk-client-python` (not `sdk-python`) to match existing `sdk-client` / `sdk-client-ts` naming
- Enum fields default to `0` in Python since they're typed as `int`
- `_to_proto()` methods are generated inline within each `@dataclass` — no separate converter module

### Generated File Structure
```
sdk/python/src/stigmer/_gen/
├── __init__.py          (re-exports all public types with __all__)
├── _client.py           (GeneratedClient composing 17 sub-clients)
├── _errors.py           (StigmerError, ErrorCode, wrap_error, sentinels)
├── _types.py            (DeleteResourceInput, ResourceRef, ListParams, etc.)
├── _agent.py            (AgentClient, AgentInput, nested inputs)
├── _agentexecution.py   (AgentExecutionClient — includes streaming)
├── ... (15 more resource files)
└── _workflow.py         (WorkflowClient — contains keyword-escaped fields)
```

### What Still Needs Handwriting (Task 2)
- `src/stigmer/_client.py` — `StigmerClient` wrapping `GeneratedClient` with channel management
- `src/stigmer/_transport.py` — gRPC channel factory (TLS / insecure)
- `src/stigmer/_interceptors.py` — API key metadata interceptor
- `src/stigmer/_search.py` — SearchService client
- `src/stigmer/__init__.py` — public API re-exports
- `pyproject.toml` — package metadata, dependencies
- `py.typed` — PEP 561 marker

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-03/20260316.03.python-sdk-codegen/next-task.md`
