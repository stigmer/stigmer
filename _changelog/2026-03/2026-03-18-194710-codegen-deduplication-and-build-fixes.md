# Codegen Shared Type Deduplication and Build Pipeline Fixes

**Date**: March 18, 2026

## Summary

Fixed multiple build pipeline failures across Go, Python, React, and test suites surfaced by `make check`. The most significant fix was a codegen deduplication issue where shared input types (e.g., `McpServerUsageInput`, `ToolApprovalOverrideInput`) were being duplicated across generated SDK files, causing compilation errors in Go and incorrect proto references in Python. Also cleaned up the Go SDK's `replace` directive handling for releases.

## Problem Statement

Running `make check` revealed failures across several layers of the build:

### Pain Points

- **Go SDK compilation errors**: Shared input types like `McpServerUsageInput` were declared in both `agent.go` and `session.go`, causing `redeclared in this block` errors. Proto type references used incorrect package aliases (e.g., `sessionv1.McpServerUsage` when the proto is defined in `agent.v1`).
- **Python SDK incorrect proto references**: The Python codegen had the same duplication issue. More critically, `_to_proto()` methods in `_session.py` referenced `session_spec_pb2.McpServerUsage`, but the proto message lives in `agent.v1` -- this would cause runtime `AttributeError`s.
- **Python lint error**: Unused `import pytest` in `test_session_context_merge.py`.
- **React ESLint errors**: `set-state-in-effect` violations in `callback/page.tsx` and `UserMenu.tsx`.
- **Failing Python tests**: 4 `test_status_builder.py` tests were out of sync with a recent `StatusBuilder` behavioral change.
- **Go module resolution**: `sdk/go/go.mod` couldn't resolve `platform/github/v1` from the published stubs version, requiring a `replace` directive and proper release-time handling.

## Solution

Implemented a `globalEmitted` map pattern in both Go and Python code generators to track which shared types have already been emitted and by which resource, ensuring each type is defined exactly once in its canonical resource file. Non-canonical files import the type instead of re-declaring it.

## Implementation Details

### Go Codegen (`tools/codegen/generator/sdk_client.go`)
- Added a `globalEmitted map[string]string` (type name -> originating resource) threaded through the generation pipeline.
- When a type is already in `globalEmitted`, its struct and `toProto` method are skipped; the file references the canonical resource's package instead.
- Proto package aliases are derived from the schema's `ProtoType` field to ensure correct cross-package references (e.g., `agentv1.McpServerUsage` instead of `sessionv1.McpServerUsage`).

### Python Codegen (`tools/codegen/generator/sdk_client_python.go`)
- Extended `pyImports` struct with `crossResourceTypes` and `crossProtoPackages` maps.
- Shared types are emitted only in their first-encountered resource; subsequent resources emit `from ._agent import McpServerUsageInput` instead.
- `_to_proto()` methods resolve the correct proto module alias (e.g., `agent_spec_pb2`) by inspecting the schema's `ProtoType` field against the current resource's package.
- `__init__.py` exports each shared type from its canonical module only.

### React Fixes
- Refactored `callback/page.tsx` and `UserMenu.tsx` to use lazy `useState` initializers instead of `setState` inside `useEffect`.

### Test Fixes
- Updated 4 `test_status_builder.py` tests to match the current `StatusBuilder` behavior where tool calls are attached to `MESSAGE_AI` messages rather than creating separate `MESSAGE_TOOL` messages.

### Go Module Release Handling
- `sdk/go/go.mod` uses a `replace` directive for local development (required because `go mod tidy` doesn't respect `go.work`).
- The `Makefile` release target strips the `replace` via `-dropreplace` and pins the stubs dependency to the release tag before committing and tagging.

## Benefits

- `make check` passes clean: all codegen, builds, lints, and 1259 Python tests pass.
- Generated SDKs are correct for external consumers -- no duplicate type declarations, no incorrect proto references.
- Release process produces a publishable `sdk/go/go.mod` without manual intervention.

## Impact

- **Go SDK consumers**: Previously would hit compilation errors from duplicate type declarations.
- **Python SDK consumers**: Previously would hit runtime `AttributeError`s when calling `_to_proto()` on shared types referenced from non-canonical resource files.
- **All SDK languages**: Shared types are now consistently defined once and imported elsewhere, following the DRY principle across generated code.

## Related Work

- Relates to the earlier codegen test coverage work (`_changelog/2026-03/2026-03-18-151923-codegen-integration-tests-and-bug-fixes.md`)
- The shared type schemas (`tools/codegen/schemas/agentic/session/types/mcpserverusage.json`, etc.) drive the cross-resource deduplication logic.

---

**Status**: ✅ Production Ready
**Timeline**: ~3 hours
