# Remove Daytona Volume Dependency — Clone to Local Overlay Filesystem

**Date**: March 26, 2026

## Summary

Removed FUSE+S3 volume mounts from Daytona sandbox creation and switched git clone to use the sandbox's local overlay filesystem. This fixes a critical production timeout where git checkout wrote at ~1 file/second on the volume, causing a 123 MB repository clone to take ~149 minutes and exceed the 300-second `_CLONE_TIMEOUT`. The same clone on local overlay completes in 3.79 seconds.

## Problem Statement

Agent executions were failing during workspace provisioning with a `DaytonaError: Read timed out` after 300 seconds. The `ExecuteGraphton` Temporal activity could not clone `stigmer/stigmer` into a Daytona sandbox within the timeout window.

### Pain Points

- Every agent execution targeting the `stigmer/stigmer` repository failed at the workspace provisioning step
- The error manifested as an HTTP read timeout on `proxy.app.daytona.io:443`, masking the real bottleneck
- The 300s timeout was exhausted with only ~3.4% of the checkout complete (280 of 8,302 files)
- Daytona volume creation itself could enter `pending_create` state, adding another failure mode

## Root Cause

The workspace volume was backed by `mountpoint-s3`, a FUSE driver that translates every filesystem operation into S3 API calls. Git checkout writes thousands of small files, and each file requires multiple S3 round-trips (`PutObject`, `CompleteMultipartUpload`). The measured write throughput was **~0.93 files/second**.

With 8,302 tracked files in the repository, checkout would take approximately **8,930 seconds (~149 minutes)** — far exceeding any reasonable timeout.

| Test Environment | Clone Time | Files/sec |
|---|---|---|
| Local machine (SSD) | 7.35s | ~1,130 |
| Sandbox local overlay | **3.79s** | ~2,195 |
| Sandbox FUSE+S3 volume | **~149 min** | ~0.93 |

The FUSE+S3 volume was **~2,360x slower** than local overlay for this workload.

## Solution

Remove volume mounts entirely from sandbox creation. Use the sandbox's local overlay filesystem for all workspace operations. The workspace path (`/home/daytona/workspace`) remains the same — it just points to fast local storage instead of a FUSE+S3 mount.

Git provisioning now always uses local-mode semantics (`is_local_mode=True`), which disables the `--separate-git-dir` flag and all FUSE compatibility workarounds (`safe.directory = *`, `core.fileMode = false`).

## Implementation Details

### Production code (4 files)

1. **`worker/worker.py`** — Removed `_initialize_daytona_volume()` method and its startup call. The worker no longer creates or manages Daytona volumes.

2. **`worker/sandbox_manager.py`** — Disabled volume mount construction in `_create_daytona_sandbox()`. Sandboxes are created without `VolumeMount` or `auto_delete_interval` parameters (except when a snapshot is specified). Added documentation explaining the rationale.

3. **`worker/workspace/__init__.py`** — Simplified cloud-mode workspace root resolution. Instead of branching on `get_daytona_volume_id()`, always uses `DAYTONA_WORKSPACE_MOUNT_PATH` as a local overlay directory. Removed `get_daytona_volume_id` import.

4. **`worker/activities/execute_graphton.py`** — Removed `get_daytona_volume_id` import; `SandboxManager` constructed without `volume_id`. Changed `provision_all()` to pass `is_local_mode=True` always, disabling `--separate-git-dir` and FUSE hacks.

### Test code (2 files)

5. **`tests/test_sandbox_manager_volume.py`** — Updated 2 tests that asserted volume mounts were attached; they now assert the new behavior (no volume mounts).

6. **`tests/test_worker_mongodb_validation.py`** — Removed mock for deleted `_initialize_daytona_volume` method.

### What remains as dead code (intentionally)

The FUSE compatibility code in `git.py` (`_configure_fuse_volume_compat`, `_git_dir_path`, `_prepare_separate_git_dir`) is preserved behind the `is_local_mode=False` path for potential future re-enablement.

## Benefits

- **Clone: 149 min → 3.79s** — Workspace provisioning no longer times out
- **All file I/O ~2,360x faster** — Skills, attachments, and agent file operations benefit equally
- **Eliminated "volume not ready" errors** — No more `pending_create` state failures
- **Simpler architecture** — No volume lifecycle management at worker startup
- **Removed FUSE workarounds** — No `--separate-git-dir`, `safe.directory = *`, or `core.fileMode = false`

## Impact

- **Agent executions**: All executions targeting git repositories will now provision in seconds instead of timing out
- **Worker startup**: Faster boot — no Daytona volume API call at startup
- **Session resumption**: If a sandbox is destroyed and recreated, workspace files are re-provisioned (3.79s) instead of being read from a persistent volume. The `_detect_existing_repo` idempotency check handles this gracefully.
- **HITL resume path**: Skills sentinel check still runs; if the sandbox was replaced, skills are re-written (near-instant on local fs)

## When to Reintroduce Volumes

Volumes should only return when there is a concrete, measured use case:
- Agent produces large generated artifacts that are expensive to recreate
- Multiple sandboxes need to share state within a session
- Regulatory requirement to persist workspace contents beyond sandbox lifecycle

When that happens, the right approach is selective persistence (upload specific outputs to object storage), not mounting the entire workspace on FUSE+S3.

## Related Work

- RCA investigation scripts: `_cursor/investigate_daytona_timeout.py`, `_cursor/investigate_clone_progress.py`
- RCA report: `_cursor/daytona-rca-report.md`

---

**Status**: ✅ Production Ready
**Timeline**: Investigation + fix completed in a single session
