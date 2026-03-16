# Python SDK Codegen Generator

**Date**: March 16, 2026

## Summary

Added a Python code generator (`sdk_client_python.go`) to the Stigmer codegen pipeline that produces a fully-typed, Stripe-style Python SDK for all 17 API resources. The generator reads the same service/spec schema JSON used by the Go and TypeScript generators and emits idiomatic Python client code with `@dataclass` input types, gRPC error wrapping, and SearchService-backed list queries.

## Problem Statement

Stigmer's Go and TypeScript SDKs are generated from a shared schema pipeline, but Python users had no SDK. Adding a hand-written Python SDK for 17 resources with nested input types would be unmaintainable and drift from the proto definitions.

### Pain Points

- No Python SDK existed despite Python proto stubs already being available
- 17 resources with dozens of methods each would require thousands of lines of handwritten code
- Keeping input types, method signatures, and error handling in sync with proto evolution is error-prone without codegen

## Solution

Created `tools/codegen/generator/sdk_client_python.go` — a Go program that plugs into the existing two-stage codegen pipeline (proto2schema JSON → language-specific generator) and emits 21 Python files into `sdk/python/src/stigmer/_gen/`.

## Implementation Details

### New File: `sdk_client_python.go` (~850 lines)

**Naming helpers** map schema types to Python conventions:
- `pyMethodName`: PascalCase → snake_case (`GetByReference` → `get_by_reference`)
- `pyStubMethodName`: PascalCase → lowerCamelCase (`GetByReference` → `getByReference`) — matches Python gRPC stubs
- `pyClientFieldName`: resource slug → plural snake_case (`agentexecution` → `agent_executions`)
- `pyTypeForTypeSpec`: schema TypeSpec → Python type annotation (`list[McpServerUsageInput]`, `dict[str, Any]`, `EnvSpecInput | None`)
- `pyFieldName`: escapes Python keywords with trailing underscore (`as` → `as_`)

**Import tracking** (`pyImports` struct) collects which proto stubs, stdlib, and internal modules each file needs, then emits them sorted and grouped (future annotations, stdlib, grpc, proto stubs, internal).

**Per-resource generation** produces a client class with:
- `__init__` wiring gRPC stubs to the channel
- Unary methods with `try/except grpc.RpcError` wrapping
- Server-streaming methods returning `Iterator[T]` via `yield`
- SearchService-backed `list()` with pagination support
- `@dataclass` input types with `_to_proto()` methods baked into each class body

**Static files**:
- `_errors.py` — `StigmerError(Exception)`, `ErrorCode` enum, `wrap_error()`, sentinel checks (`is_not_found()`, `is_retryable()`)
- `_types.py` — `DeleteResourceInput`, `ResourceRef`, `ListParams/ListResult`, `EnvSpecInput/EnvVarInput` with `_to_proto()` methods
- `_client.py` — `GeneratedClient` composing all 17 sub-clients as properties (`self.agents`, `self.agent_executions`, etc.)
- `__init__.py` — re-exports all public types with `__all__`

### Modified File: `main.go`

Added `sdk-client-python` case to the `--comprehensive` dispatch block alongside existing `sdk-client` (Go) and `sdk-client-ts` targets.

### Bugs Caught During Verification

1. **Enum field defaults**: Fields with `EnumType` were getting `""` (string) defaults instead of `0` (int)
2. **ApiResourceId case ordering**: Commons `ApiResourceId` matched the resource-specific ID path before the commons path because `isIDType("ApiResourceId")` returns true — reordered cases to check commons types first
3. **Python keyword collisions**: Proto field `as` in the Workflow spec caused `SyntaxError` — added `pyFieldName()` to escape keywords with trailing underscore and `setattr()` in proto builders

## Benefits

- **Consistency**: Python SDK stays in sync with Go/TS SDKs — all generated from the same schemas
- **Full coverage**: All 17 API resources with every method, including streaming and search
- **Type safety**: Full type annotations, `@dataclass` input types, proto return types
- **Pythonic**: snake_case methods, keyword arguments, `Iterator` for streams, `from __future__ import annotations`
- **Maintainability**: Adding a new API resource automatically generates its Python client on the next codegen run

## Impact

- **SDK team**: Python is now a first-class SDK target in the codegen pipeline
- **Python developers**: Can use Stigmer with idiomatic Python patterns once the SDK package is scaffolded (Task 2)
- **Codegen infrastructure**: Pattern is proven for 3 languages — adding more (Ruby, etc.) follows the same approach

## Related Work

- [Go SDK Stripe-style restructure](2026-03-16-112653-go-sdk-stripe-style-restructure.md)
- [Go SDK all-resource codegen](2026-03-16-115418-go-sdk-all-resource-codegen.md)
- Project: `_projects/2026-03/20260316.03.python-sdk-codegen/`

---

**Status**: Production Ready
**Timeline**: ~3 hours (planning + implementation + verification)
