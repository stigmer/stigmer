# DD01: Persistent Volume Over Sandbox Filesystem

**Date**: 2026-02-15
**Status**: Approved
**Decision Maker**: Developer (Suresh)

## Context

Post-approval execution resumption was failing because the agent's workspace files were stored on the Daytona sandbox's filesystem. When the sandbox died (TTL, auto-delete, infrastructure event), all files — skills, attachments, agent work products — were lost. The `is_resume` fast-path compounded this by skipping file writes on resume, leaving the agent in an empty workspace.

## Decision

Decouple workspace filesystem from sandbox compute. Use Daytona Volumes (persistent, S3-backed FUSE mounts) for workspace files. Sandbox becomes ephemeral compute only — like a Kubernetes Pod with a PersistentVolume.

## Pattern

Kubernetes-inspired:
- **Sandbox** = Pod (ephemeral compute, runtime packages)
- **Daytona Volume** = PersistentVolume (durable file storage)
- **Session** = PVC binding (session owns the subpath reference)
- **Single global volume** = shared PV with subpath isolation per session

## Specifics

- Single global Daytona Volume: `stigmer-workspaces` (created once at worker startup, used by all sessions)
- Auto-created via `daytona.volume.get("stigmer-workspaces", create=True)` — idempotent, no manual setup
- Volume ID cached in `SandboxManager` at worker startup (worker-level concern, not session-level)
- Session isolation via subpath: `sessions/{session_id}` (session IDs are globally unique UUIDs)
- Mount path: `/home/daytona/workspace`
- Local mode equivalent: `{SANDBOX_ROOT_DIR}/sessions/{session_id}/`
- No proto changes needed — volume is infrastructure, not per-session state

## Alternatives Considered

1. **File sync to external storage at pause points** — Complex, sync overhead on every pause, risk of partial sync failures
2. **Sandbox snapshot before pause** — Daytona doesn't expose snapshot creation API; would preserve packages but is a black-box
3. **Verify-and-reconstruct on resume** — Defensive but doesn't solve agent work product loss; only handles skills/attachments
4. **One volume per session** — Clean but hits Daytona's 100 volume/org limit quickly
5. **One volume per org** — Better than per-session, but adds org_id dependency in sandbox manager; unnecessary complexity since session IDs are globally unique
6. **Store volume_id in Session proto** — Redundant for a global volume; adds proto changes across repos for no benefit

## Consequences

- Workspace files survive any sandbox lifecycle event
- Sandbox reuse is still valuable (preserves runtime package installations)
- FUSE-based volumes may be slower than local sandbox filesystem for high-frequency operations
- Need to manage volume lifecycle (creation, cleanup) alongside sandbox lifecycle
