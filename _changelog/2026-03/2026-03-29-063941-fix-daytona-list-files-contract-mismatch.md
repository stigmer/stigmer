# Fix Daytona Backend list_files / is_directory Contract Mismatch

**Date**: March 29, 2026

## Summary

Fixed a crash where the agent's `list` platform tool failed with `'DaytonaBackend' object has no attribute 'list_files'` when running against Daytona cloud sandboxes. The root cause was a backend contract mismatch: graphton's `WorkspaceNormalizingBackend` assumed the inner backend provides `list_files()` and `is_directory()`, but the Daytona sandbox backend (via deepagents' `DaytonaBackend`) implements `SandboxBackendProtocol` which exposes `ls_info()` instead. Introduced normalizer functions that bridge between the two APIs at the adapter boundary.

## Problem Statement

When agents listed directory contents (`list .`, `glob *.py`, etc.) against Daytona cloud sandboxes, the `list` platform tool crashed immediately with an `AttributeError`. The same contract gap affected `is_directory()`, which would crash whenever the `list` or `glob` tool tried to distinguish files from directories.

### Pain Points

- Every `list` tool call against a Daytona sandbox failed — agents could not browse the workspace filesystem in cloud mode
- `glob` and `grep` tools also use `list_files()` internally, so recursive file operations were completely broken
- `is_directory()` also uses a graphton-only method not present on `DaytonaBackend`
- Local filesystem mode worked fine, making this a cloud-only regression invisible during local development
- Existing tests used `MagicMock` which auto-creates any attribute, so the method absence was never caught

### Root Cause

Two different backend APIs use different method names and return types for directory listing:

| Backend | Method | Return Type |
| --- | --- | --- |
| `FilesystemBackend` (graphton) | `list_files(path)` | `list[str]` (bare entry names) |
| `DaytonaBackend` (deepagents_cli) | `ls_info(path)` | `list[FileInfo]` (objects with `path` and `is_dir`) |

`WorkspaceNormalizingBackend.list_files()` unconditionally called `self._inner.list_files()`, crashing on `DaytonaBackend` which only provides `ls_info()`. The same pattern affected `is_directory()` which also does not exist on `SandboxBackendProtocol`.

This is the same class of bug fixed for `execute()` on March 26 (see `2026-03-26-201008-fix-execute-tool-backend-contract-mismatch.md`).

## Solution

Established normalizer functions in `types.py` that bridge between the two backend APIs, following the same pattern as `to_execution_result()`.

## Implementation Details

### 1. `to_file_list()` normalizer (`types.py`)

Probes the inner backend for `list_files()` (graphton native, preferred) or `ls_info()` (deepagents protocol, fallback). When falling back to `ls_info()`, each `FileInfo` is reduced to its `os.path.basename()` so the return type matches graphton's `list[str]` contract.

### 2. `to_is_directory()` normalizer (`types.py`)

Probes the inner backend for `is_directory()` (graphton native, preferred) or `ls_info()` (fallback). When falling back, lists the *parent* directory via `ls_info()` and inspects the matching entry's `is_dir` flag. Returns `False` defensively if the entry is not found or `ls_info()` raises an exception.

### 3. `WorkspaceNormalizingBackend` updates (`daytona.py`)

`list_files()` and `is_directory()` now delegate through the normalizer functions instead of calling `self._inner.list_files()` / `self._inner.is_directory()` directly.

### 4. Backward-compatible re-exports (`__init__.py`)

The package `__init__.py` exports `to_file_list` and `to_is_directory` alongside the existing `to_execution_result`.

## Benefits

- Daytona cloud sandbox agents can list directories, glob files, and grep file contents again
- The normalizer functions follow the same established pattern as `to_execution_result()`
- Existing `FilesystemBackend` behavior is completely unaffected (it has `list_files()` and `is_directory()`, so the native path is always taken)
- `FileInfo` handling supports both dict-style and object-style variants for forward compatibility

## Impact

- **Agent executions on Daytona sandboxes**: Fixed — `list`, `glob`, and `grep` tools now work correctly
- **Local filesystem mode**: Unaffected — `FilesystemBackend` already has `list_files()` and `is_directory()`
- **Test coverage**: 17 new tests (5 for `to_file_list`, 7 for `to_is_directory`, 5 for `WorkspaceNormalizingBackend` integration with ls_info-only backends)

## Related Work

- [Fix Execute Tool Backend Contract Mismatch](2026-03-26-201008-fix-execute-tool-backend-contract-mismatch.md) — Fixed the same class of contract mismatch for `execute()`. This changelog fixes the separate `list_files()` and `is_directory()` methods.

---

**Status**: Production Ready
