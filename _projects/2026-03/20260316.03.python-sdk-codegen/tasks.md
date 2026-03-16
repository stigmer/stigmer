# Tasks: 20260316.03.python-sdk-codegen

**Created**: 2026-03-16

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Create sdk_client_python.go codegen

**Status**: ✅ DONE
**Created**: 2026-03-16 12:17
**Completed**: 2026-03-16 12:59

### Subtasks
- [x] Create `tools/codegen/generator/sdk_client_python.go` following Go/TS/Java generator patterns
- [x] Generate per-resource client classes: `_agent.py`, `_skill.py`, etc. (underscore-prefixed internal modules)
- [x] Generate input dataclasses from spec schemas: `AgentInput` with `_to_proto()` conversion
- [x] Generate shared types: `DeleteResourceInput`, `ResourceRef`, `Page`, `ListParams`, `ListResult`
- [x] Generate error types: `StigmerError(Exception)`, `ErrorCode` enum, sentinel checks (`is_not_found()`)
- [x] Generate aggregate client module: `_client.py` composing all sub-clients
- [x] Handle Python-specific edge cases: `google.protobuf.Empty`, `Timestamp`, `Struct`, enums
- [x] Register `sdk-client-python` target in `tools/codegen/generator/main.go`

### Notes
- Reuses Stage 1 output (service schema JSON from `proto2schema`) — only Stage 2 is new
- Python naming: snake_case methods, PascalCase classes, `@dataclass` for inputs
- Generated code output to `sdk/python/src/stigmer/_gen/`
- Python proto stubs already exist at `apis/stubs/python/stigmer/` (package name `stigmer-stubs`)
- Import stubs like: `from ai.stigmer.agentic.agent.v1 import api_pb2, command_pb2_grpc` (note: no `stigmer.` prefix)
- Proto field `as` is a Python keyword — handled via `pyFieldName()` with trailing underscore and `setattr()`
- Enum fields default to `0` (int), not `""` (string)
- All 21 generated files pass Python syntax validation

## Task 2: Scaffold sdk/python package

**Status**: ⏸️ TODO
**Created**: 2026-03-16 12:17

### Subtasks
- [ ] Create `sdk/python/pyproject.toml` — package name `stigmer`, version, dependencies
- [ ] Create transport layer: `_transport.py` (gRPC channel factory with TLS + API key interceptor)
- [ ] Create `_interceptors.py` — gRPC `ClientInterceptor` adding `authorization: Bearer <key>` metadata
- [ ] Create `errors.py` — `StigmerError`, `ErrorCode`, `is_not_found()`, `is_unauthenticated()` (handwritten or generated)
- [ ] Create public API surface: `__init__.py` re-exports, `StigmerClient` class
- [ ] Create `_search.py` — `SearchClient` for cross-resource search queries
- [ ] Add `py.typed` marker for PEP 561 type checking support
- [ ] Add type hints throughout (fully typed SDK)
- [ ] Write basic unit tests with pytest
- [ ] Add examples: `basic_crud.py`, `streaming_execution.py`

### Directory Structure
```
sdk/python/
├── pyproject.toml
├── Makefile
├── README.md
├── src/stigmer/
│   ├── __init__.py              (public API: StigmerClient, AgentInput, etc.)
│   ├── py.typed                 (PEP 561 type stub marker)
│   ├── _client.py               (StigmerClient class — handwritten wrapper)
│   ├── _search.py               (SearchClient)
│   ├── _options.py              (ClientOptions — base_url, insecure, etc.)
│   ├── errors.py                (StigmerError, ErrorCode, sentinel checks)
│   ├── _transport.py            (gRPC channel + TLS)
│   ├── _interceptors.py         (API key interceptor)
│   └── _gen/                    (codegen output — wiped on regeneration)
│       ├── __init__.py
│       ├── _agent.py            (AgentClient, AgentInput)
│       ├── _skill.py            (SkillClient, SkillInput)
│       ├── ...
│       ├── _types.py            (shared types)
│       └── _errors.py           (generated error wrappers)
├── tests/
│   └── test_client.py
└── examples/
    ├── basic_crud.py
    └── streaming_execution.py
```

### Notes
- Python version: 3.11+ (match existing `stigmer-stubs` requirement)
- gRPC-Python uses `grpc.insecure_channel()` / `grpc.secure_channel()` + `grpc.ssl_channel_credentials()`
- API key via `grpc.metadata_call_credentials()` or custom interceptor
- Proto stubs dependency: `stigmer-stubs` (existing package at `apis/stubs/python/stigmer/`)
- Use `@dataclass` for input types (no builder pattern needed — Python has keyword args)
- Underscore-prefixed modules (`_client.py`, `_gen/`) = private; `__init__.py` re-exports public API
- Consider `async` support: `grpc.aio` for async gRPC — could be a follow-up

## Task 3: Wire codegen into build pipeline

**Status**: ⏸️ TODO
**Created**: 2026-03-16 12:17

### Subtasks
- [ ] Add `sdk-python` target to `tools/codegen/generator/main.go` dispatch
- [ ] Add `sdk/python/Makefile` with `codegen` target that calls the generator
- [ ] Update root `Makefile` `protos` target to chain Python SDK codegen: `$(MAKE) -C sdk/python codegen`
- [ ] Add `codegen-verify` target: codegen + `python -m py_compile` or pytest
- [ ] Test full pipeline: `make protos` generates all stubs and all SDK code

### Notes
- Pattern follows Go/Java: root `make protos` → stubs → SDK codegen for each language
- Python doesn't need a "compile" step, but type-checking with `mypy` or `pyright` can serve as verification
- `codegen-verify` = regenerate + mypy check + pytest

## Task 4: PyPI publishing setup

**Status**: ⏸️ TODO
**Created**: 2026-03-16 12:17

### Key Insight: PyPI Trusted Publishers (No API Tokens Needed)

PyPI supports **Trusted Publishing** via OpenID Connect (OIDC) with GitHub Actions. This is more secure than API tokens — no long-lived credentials to manage. GitHub Actions exchanges short-lived OIDC tokens for temporary PyPI upload tokens that expire in 15 minutes.

### Subtasks
- [ ] Create PyPI account at https://pypi.org
- [ ] Configure `pyproject.toml` with required metadata (name, version, description, authors, license, urls, classifiers)
- [ ] Set up Trusted Publisher on PyPI (register GitHub repo + workflow file)
- [ ] Create `.github/workflows/release.pypi.yaml` using `pypa/gh-action-pypi-publish`
- [ ] Add `build` step using `python -m build` (produces sdist + wheel)
- [ ] Document version tagging strategy
- [ ] Add SDK README with `pip install stigmer` and usage examples

### GitHub Actions Workflow Template
```yaml
name: Publish to PyPI
on:
  push:
    tags: ['sdk/python/v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    environment: pypi
    permissions:
      id-token: write  # Required for Trusted Publishing
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
      - run: pip install build
      - run: python -m build sdk/python/
      - uses: pypa/gh-action-pypi-publish@release/v1
        with:
          packages-dir: sdk/python/dist/
```

### Owner Action Items (one-time setup)
- [ ] Create account at https://pypi.org
- [ ] Register Trusted Publisher: PyPI → Your Projects → Publishing → Add Trusted Publisher
  - Owner: `stigmer`
  - Repository: `stigmer`
  - Workflow: `release.pypi.yaml`
  - Environment: `pypi`
- [ ] That's it. No API tokens, no GPG keys, no secrets to manage.

### PyPI vs Maven Central Comparison
| Aspect | PyPI | Maven Central |
|--------|------|--------------|
| Account | pypi.org (free) | central.sonatype.com |
| Auth | Trusted Publisher (OIDC) — zero secrets | GPG keys + API tokens — 4 secrets |
| Signing | Not required | GPG required |
| Sources/Docs | Not required (sdist included) | Sources JAR + Javadoc JAR required |
| Namespace | First-come-first-served | Domain ownership verification |
| CI Action | `pypa/gh-action-pypi-publish` | Manual Maven plugin config |

### Notes
- Package name: `stigmer` on PyPI (`pip install stigmer`)
- PyPI package names are first-come-first-served — no namespace verification needed
- Trusted Publishing is the recommended approach (no API tokens to rotate)
- Build produces: `.tar.gz` (sdist) + `.whl` (wheel)
- Consider also publishing `stigmer-stubs` (proto stubs) as a separate PyPI package so SDK users get it as a dependency


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

