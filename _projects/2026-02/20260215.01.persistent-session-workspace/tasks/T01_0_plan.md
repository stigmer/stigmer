# Task T01: Session-Scoped Persistent Workspace

**Created**: 2026-02-15 18:35
**Updated**: 2026-02-15 19:10
**Status**: PENDING REVIEW
**Type**: Feature Development

> **This plan requires your review before execution.**

## Problem

Post-approval agent execution fails silently when the Daytona sandbox dies between pause and resume. The current `is_resume` fast-path skips writing skills and attachments to the sandbox — but if the sandbox was recreated (new sandbox, empty filesystem), the agent resumes in an empty workspace with no skills, no attachments, and no previously created files.

The root cause: **filesystem state is coupled to sandbox lifecycle.** When the sandbox dies, the filesystem dies with it.

## Solution

Decouple filesystem from sandbox. Introduce **session-scoped persistent workspaces** using Daytona Volumes (cloud) and session-scoped directories (local).

### Architecture

```
Session (persistent)
├── thread_id    → LangGraph checkpoint (conversation state)
├── sandbox_id   → Sandbox ID (ephemeral compute, runtime packages)
└── Executions[]

Worker (startup-initialized)
└── volume_id    → Single global Daytona Volume (cached at startup)
```

The volume is a **worker-level concern**, not a session-level concern. One global volume serves all sessions; each session gets its own subpath. No proto changes needed.

**Cloud mode (Daytona):**
- One global Daytona Volume: `stigmer-workspaces`
- Auto-created at worker startup via `daytona.volume.get("stigmer-workspaces", create=True)` — idempotent
- Cached in `SandboxManager` for the worker's lifetime
- Each session mounts subpath: `sessions/{session_id}`
- Volume mounted at `/home/daytona/workspace` inside sandbox
- Files persist across sandbox lifecycle — skills, attachments, agent work products
- Session IDs are globally unique UUIDs — no collision risk within a single volume

**Local mode (filesystem):**
- Session-scoped directory: `{SANDBOX_ROOT_DIR}/sessions/{session_id}/`
- Each session gets its own isolated directory
- Files persist as long as the directory exists (cleared on system restart is acceptable)

### Resume Behavior

| Sandbox State | What Happens | Files | Packages |
|---|---|---|---|
| Running | Reuse as-is | Intact (volume) | Intact |
| Stopped | `sandbox.start()` | Intact (volume) | Intact |
| Archived | Restore sandbox | Intact (volume) | Intact |
| Gone | New sandbox + mount volume | Intact (volume) | Lost (acceptable) |

## Decisions (agreed with developer)

| Decision | Choice | Rationale |
|---|---|---|
| Volume strategy | Single global volume, subpath per session | Simplest, no per-org management, no 100-limit risk |
| Volume naming | `stigmer-workspaces` | Single volume for all sessions |
| Volume creation | Auto-created at worker startup | `daytona.volume.get(name, create=True)` — idempotent, no manual setup |
| Volume ID storage | Cached in SandboxManager (memory) | Worker-level concern, not session-level; no proto change needed |
| Session isolation | `subpath=sessions/{session_id}` | Daytona-native isolation via UUID uniqueness |
| Volume mount path | `/home/daytona/workspace` | Dedicated path, no conflict with system files |
| Sandbox auto-delete | Disabled (`-1`) | We manage lifecycle; preserves runtime packages |
| Local mode path | `{SANDBOX_ROOT_DIR}/sessions/{session_id}/` | Session-scoped, consistent with cloud pattern |
| Cleanup | Not in MVP scope | Address after core functionality works |
| Proto changes | None needed | Volume is global (worker config), not per-session |

## Task Breakdown

### T01: Local Mode — Session-Scoped Directories (start here)

**Why first**: This is where you test. Immediate value, lowest risk, smallest change.

**Scope**:
1. Modify `WorkerConfig.get_sandbox_config()` to accept `session_id` parameter
2. When `session_id` is provided, construct root_dir as `{SANDBOX_ROOT_DIR}/sessions/{session_id}/`
3. Create the directory if it doesn't exist
4. Update `execute_graphton.py` to pass `session_id` when building sandbox config
5. Ensure `FilesystemBackend` works correctly with session-scoped paths

**Files to modify**:
- `backend/services/agent-runner/worker/config.py` — `get_sandbox_config()` signature + logic
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — pass session_id to config

**Estimated effort**: Small (< 20 lines changed)

### T02: Daytona Volume — Auto-Create at Worker Startup + Mount on Sandbox Creation

**Scope**:
1. At `SandboxManager.__init__()` (or a dedicated init method called at worker startup):
   - Call `daytona.volume.get("stigmer-workspaces", create=True)`
   - Cache `volume.id` as `self._volume_id`
2. Import `VolumeMount` from Daytona SDK
3. Modify `_create_daytona_sandbox()`:
   - Pass `VolumeMount(volume_id=self._volume_id, mount_path="/home/daytona/workspace", subpath=f"sessions/{session_id}")` to `CreateSandboxFromSnapshotParams`
4. Volume name configurable via env var `DAYTONA_VOLUME_NAME` (default: `stigmer-workspaces`)

**Files to modify**:
- `backend/services/agent-runner/worker/sandbox_manager.py` — volume init + mount config

**Estimated effort**: Medium (~40-60 lines)

### T03: Sandbox Restart/Recovery Before Recreation

**Scope**:
1. Before creating a new sandbox, attempt to **restart** a stopped sandbox
2. Before creating a new sandbox, attempt to **recover** an errored sandbox
3. Only create a new sandbox as last resort
4. Disable `auto_delete_interval` on sandbox creation (`sandbox.set_auto_delete_interval(-1)`)

**Resume priority chain**:
```
sandbox = daytona.get(sandbox_id)
if sandbox.state == "started":   → reuse (fastest)
if sandbox.state == "stopped":   → sandbox.start() (packages preserved)
if sandbox.state == "archived":  → restore + start (packages preserved, slower)
if sandbox.state == "error" and sandbox.recoverable: → sandbox.recover()
else:                            → create new + mount volume (files preserved, packages lost)
```

**Files to modify**:
- `backend/services/agent-runner/worker/sandbox_manager.py` — restart/recovery logic

**Estimated effort**: Medium (~40-60 lines)

### T04: Backend Workspace Root from Volume Mount

**Scope**:
1. When volume is mounted, configure the backend's workspace root to be the volume mount path (`/home/daytona/workspace`)
2. Update `create_daytona_backend()` in graphton to accept and use the mount path as workspace root
3. Ensure `WorkspaceNormalizingBackend` normalizes to the volume mount path
4. Update `execute_graphton.py` to pass mount path through sandbox config

**Files to modify**:
- `backend/libs/python/graphton/src/graphton/core/backends/daytona.py` — workspace root from config
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — pass mount path

**Estimated effort**: Small (~15-25 lines)

### T05: Simplify Resume Fast-Path

**Scope**:
1. The `is_resume` fast-path for skills/attachments is now **safe** because volume persistence guarantees files exist
2. Keep the fast-path for performance (avoids re-downloading artifacts from storage)
3. Add a safety check: if fast-path is active but expected files don't exist (e.g., volume mount failed), fall back to full setup
4. Log clearly whether volume was used: `[RESUME] Volume-backed workspace — skipping skill/attachment writes`

**Files to modify**:
- `backend/services/agent-runner/worker/activities/execute_graphton.py` — fast-path safety check

**Estimated effort**: Small (~15-20 lines)

### T06: Testing

**Scope**:
1. Test local mode: session-scoped directories created and reused across executions
2. Test Daytona mode: volume auto-created, mounted, files persist across sandbox recreation
3. Test resume: after sandbox dies, new sandbox mounts volume, files intact
4. Test restart: stopped sandbox restarted successfully
5. Test fast-path safety: verify fallback when files unexpectedly missing

**Estimated effort**: Medium

## Execution Order

```
T01 (Local mode session dirs)          ← test immediately on your machine
  ↓
T02 (Volume auto-create + mount)       ← core Daytona volume support
  ↓
T03 (Sandbox restart/recovery)         ← preserve runtime packages
  ↓
T04 (Backend workspace root)           ← wire volume mount to backend
  ↓
T05 (Fix resume fast-path)             ← make it safe with volumes
  ↓
T06 (Testing)                          ← verify everything
```

T01 is independent — can start immediately.
T02 has no proto dependency — just needs Daytona SDK.
T03 is independent of T02 (sandbox restart useful even without volumes).
T04 depends on T02 (needs volume mount to exist).
T05 depends on T04 (needs volume-backed workspace root).
T01 and T02 can be done in parallel.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Daytona Volume API behaves differently than documented | Low | High | T02 includes validation; test volume CRUD early |
| FUSE performance too slow for high-frequency file ops | Medium | Medium | Monitor; volume is for workspace files not temp/cache |
| SDK version mismatch (Volume API not in installed version) | Low | High | Verify imports in T02 before writing code |
| Multi-tenancy concern with single volume | Low | Low | Subpath isolation enforced by FUSE; can move to per-org volumes later |
| Existing tests break due to path changes | Medium | Low | T01 is backward-compatible (only adds session path when session_id provided) |
| Worker restart loses cached volume_id | None | None | Re-fetched on startup via idempotent get() call |

## Out of Scope (Future Work)

- Volume cleanup on session deletion
- Volume retention policies
- Snapshot-based sandbox recreation
- Per-tool timeout in LangGraph
- Checkpoint compression/pruning
- Sandbox resource auto-scaling
- Per-org volume isolation (if needed for compliance)

## Review Checklist

Please consider:
- Is the task ordering correct for your testing workflow?
- Any concerns about the `/home/daytona/workspace` mount path?
- Should the volume name be configurable via env var, or is hardcoded `stigmer-workspaces` fine?
- Any other edge cases we should handle in the MVP?
