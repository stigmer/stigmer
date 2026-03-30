# Seal WorkspaceNormalizingBackend __getattr__ Escape Hatch

**Date**: March 30, 2026

## Summary

Replaced `WorkspaceNormalizingBackend.__getattr__`'s open forwarding with a sealed design that raises `AttributeError` for any attribute not explicitly defined on the wrapper. This eliminates an architectural escape hatch where methods inherited by the inner `DaytonaBackend` from `BaseSandbox` could silently bypass path normalization, the `cd` preamble, and env-var injection.

## Problem Statement

`WorkspaceNormalizingBackend` wraps the inner `DaytonaBackend` to normalize agent-space paths into sandbox-relative paths and prepend a `cd` preamble to shell commands (T01 fix). However, `__getattr__` transparently forwarded any attribute not explicitly overridden to the inner backend — including methods like `ls_info`, `edit`, `grep_raw`, `glob_info`, and `aexecute` that call `self.execute()` on the *inner* backend, bypassing the wrapper entirely.

### Pain Points

- Any code path that called a non-overridden method would silently skip path normalization and the `cd` preamble
- `DeepAgentsBackendAdapter` checked `hasattr(self._inner, "upload_files")` and `hasattr(self._inner, "download_files")`, which resolved to the inner `DaytonaBackend`'s methods via `__getattr__` — a latent path normalization bypass where the Daytona `sandbox.fs` API would receive non-normalized paths
- No compile-time or runtime signal when a forwarded method bypassed safety invariants
- As the inner `DaytonaBackend`'s API surface grows (new methods on `BaseSandbox`), new bypass vectors could appear silently

## Solution

Delete the open forwarding and replace it with a sealed `__getattr__` that raises `AttributeError` with an actionable message. Add an explicit `id` property — the only attribute that genuinely needed pass-through from the inner backend.

## Implementation Details

**Production file** (`graphton/core/backends/daytona.py`):
- Added `id` property that forwards from the inner backend (used by `DeepAgentsBackendAdapter.id`)
- Replaced `__getattr__` forwarding with one that raises `AttributeError`, including guidance on how to add new overrides
- Updated class docstring to document the sealed behavior

**Test file** (`tests/core/test_daytona_backend.py`):
- Replaced `TestGetattr` (2 tests for open forwarding) with `TestGetAttrSealed` (11 tests):
  - Unknown attribute access raises `AttributeError`
  - `id` property correctly forwarded
  - 7 parametrized tests confirming dangerous inner methods are blocked (`ls_info`, `edit`, `grep_raw`, `glob_info`, `aexecute`, `aread`, `awrite`)
  - Sanity check that all overridden methods remain accessible

## Benefits

- Fail-fast on any future code that accidentally accesses a non-overridden method — immediate `AttributeError` with actionable guidance instead of silent bypass
- Fixes latent path normalization bug in `upload_files` / `download_files` paths through `DeepAgentsBackendAdapter` — adapter now falls back to the normalized `write()` / `read()` methods
- Future-proof against inner backend API surface growth — new methods on `BaseSandbox` cannot silently bypass the wrapper
- Net +9 tests (from 94 to 103 in the daytona backend test suite)

## Impact

- `WorkspaceNormalizingBackend` consumers are unaffected — all verified consumers use only explicitly overridden methods
- `DeepAgentsBackendAdapter` now takes safer fallback paths for `upload_files` / `download_files` (uses normalized `write()` / `read()` instead of raw Daytona `sandbox.fs` API)
- Zero changes to `FilesystemBackend`, `tool_wrappers.py`, `sandbox_factory.py`, `subagent_transformer.py`, `setup.py`, or any proto/RPC definitions

## Related Work

- **T01: Fix Daytona Shell Execution Path** — T02 seals the architectural gap that T01 identified and partially addressed (T01 added the `execute_streaming` override to prevent one specific `__getattr__` bypass)
- **Project**: 20260330.02.filesystem-backend-standardization — T02 is the second of four tasks standardizing the filesystem backend abstraction layer

---

**Status**: ✅ Production Ready
**Timeline**: ~1 session
