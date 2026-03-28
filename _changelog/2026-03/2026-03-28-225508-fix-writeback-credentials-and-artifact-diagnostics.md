# Fix Git Write-Back Credential Gate and Artifact Publish Diagnostics

**Date**: March 28, 2026

## Summary

The entire incremental git write-back pipeline (branch creation, commits, PRs, `WriteBacksWidget`) was structurally disabled in production because a hardcoded `is_local_mode=True` prevented credential configuration as a side effect. A new `configure_credentials` parameter decouples credential setup from the filesystem layout decision, enabling write-back for cloud sandboxes. Diagnostic logging is added to the artifact publish pipeline to trace a content mismatch bug where downloaded artifacts differ from what the write tool confirmed.

## Problem Statement

### Pain Points

- **Write-back never fires (again)**: The previous fix (`2026-03-28-173414`) opened Gate 1 by adding `GIT_WRITE_BACK_MODE_UNSPECIFIED` to the allowlist. But Gate 2 (`git_credentials_configured`) remained locked: the `is_local_mode=True` hardcoded in `execute_graphton.py` caused `sources/git.py` to skip credential configuration on every execution — both fresh clone and existing-repo reuse paths.
- **`WriteBacksWidget` invisible**: A direct consequence. With no eligible entries, the `WriteBackCoordinator` was always set to `None`, producing zero `WorkspaceWriteBack` entries for the widget to render.
- **Artifact content mismatch undiagnosable**: Users report that the artifact preview/download shows content (e.g. `org: default`) that differs from what the write tool confirmed it wrote. No logging exists to compare the tool's content with what was read back from the sandbox during artifact publish.

## Solution

### 1. Decouple Credential Configuration from Filesystem Layout

The `is_local_mode=True` flag was intentional — the comment explains that the sandbox's local overlay filesystem does not need `--separate-git-dir` FUSE hacks. But `is_local_mode` also gated credential setup (`if token and not is_local_mode:`), causing an unintended side effect.

Added a new `configure_credentials: bool` parameter to `provision()`, threaded through the provisioner, that independently controls whether the git credential store is set up. The caller in `execute_graphton.py` now passes `configure_credentials=not worker_config.is_local_mode()`:

- **Cloud mode** (`is_local_mode()` returns `False`): `configure_credentials=True` — credential store is configured, write-back becomes eligible.
- **Local mode** (`is_local_mode()` returns `True`): `configure_credentials=False` — developer's git config is never touched.

### 2. Artifact Publish Diagnostic Logging

Added logging at three points to enable content mismatch diagnosis:

- **Write tool** (`tool_wrappers.py`): Logs the first 200 characters of content the tool wrote.
- **Inline publish** (`execute_graphton.py`): Logs raw tool path, normalized path, sandbox mode, and post-publish artifact metadata (size, hash).
- **Sandbox download** (`publish_artifact.py`): Logs the first 200 bytes of content read from the sandbox before upload to storage.

Operators can now compare the write-side and publish-side logs to identify path normalization mismatches, stale reads, or FS consistency issues.

## Implementation Details

### Files Changed (Hand-Written)

| Area | File | Change |
|------|------|--------|
| Backend | `sources/git.py` | Added `configure_credentials` parameter; changed both credential guards from `not is_local_mode` to `configure_credentials`; updated module docstring |
| Backend | `provisioner.py` | Threaded `configure_credentials` through `provision_all()` → `provision()` → `_dispatch()` |
| Backend | `execute_graphton.py` | Added `configure_credentials=not worker_config.is_local_mode()` to provisioner call; added path resolution and content diagnostic logging to `_publish_file_inline` |
| Backend | `publish_artifact.py` | Added first-200-bytes content preview logging in `_publish_from_sandbox` |
| Backend | `tool_wrappers.py` | Added first-200-chars content logging in `write` tool |
| Tests | `test_git_source.py` | Updated 12 `TestCredentialHelper` tests to pass `configure_credentials=True` where credential setup is expected |

### Key Design Decision: New Parameter vs Changing `is_local_mode`

Chose a new parameter over changing the hardcoded `is_local_mode=True` because the two concerns are orthogonal:

- **`is_local_mode`** controls the git directory layout (`--separate-git-dir`, FUSE compat). Correctly set to `True` for local overlay filesystems.
- **`configure_credentials`** controls whether a credential store is set up for push access. Needed in cloud mode regardless of filesystem type.

Changing `is_local_mode` to `False` would re-enable unnecessary FUSE hacks. A separate parameter is the clean decoupling.

## Benefits

- **Write-back activates in cloud mode**: Git-backed workspaces now get credential stores configured during provisioning, making entries eligible for the `WriteBackCoordinator`. PRs will be created as the agent works.
- **`WriteBacksWidget` renders**: With eligible entries producing `WorkspaceWriteBack` data, the session sidebar widget appears.
- **Artifact mismatches diagnosable**: Operators can now trace content from write tool → sandbox download → storage upload to identify where divergence occurs.
- **Backward compatible**: `configure_credentials` defaults to `False`, matching prior behavior for all existing callers. Only the `execute_graphton.py` call site opts in.

## Impact

- **End users**: Git write-back PRs will appear during agent execution for git-backed workspaces with `GITHUB_TOKEN` configured.
- **Platform builders**: No SDK changes needed — write-back activation is purely server-side.
- **Operators**: New log entries at `INFO` level for artifact content tracing; searchable via `[INLINE_PUBLISH]` and `Artifact content preview` log prefixes.
- **Tests**: All 128 workspace tests and 12 inline publish tests pass.

## Related Work

- Enable git write-back by default (`2026-03-28-173414`) — fixed Gate 1 (mode allowlist)
- Incremental git write-back (`2026-03-28-162537`) — original pipeline implementation
- Fix artifact preview staleness race (`2026-03-28-173126`) — addressed a different staleness vector

---

**Status**: ✅ Production Ready
**Timeline**: Single session
