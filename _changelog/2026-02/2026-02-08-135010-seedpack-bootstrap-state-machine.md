# Seedpack Bootstrap State Machine

**Date**: February 8, 2026

## Summary

Implemented the seedpack bootstrap state machine that automatically provisions system skills and agents on server startup. This enables offline-first operation by embedding pre-built artifacts in the binary and applying them idempotently via the existing gRPC APIs.

## Problem Statement

The Stigmer platform needs to provide built-in capabilities (like `skill-creator`) that are available immediately when the server starts, without requiring network connectivity or manual setup.

### Pain Points

- Server startup required network access to fetch system resources
- No mechanism to ensure system skills/agents exist on first boot
- Restarts could create duplicate resources
- Manual bootstrap steps created friction for users

## Solution

Implemented a versioned, idempotent bootstrap system inspired by K3s AddOns and Terraform state management:

1. **Build-time artifact preparation**: Pre-build ZIP artifacts during vendoring
2. **SQLite state tracking**: Persist bootstrap progress with content digests
3. **gRPC API integration**: Use existing Push/Apply APIs for consistency
4. **Graceful degradation**: Server continues even if bootstrap fails

## Implementation Details

### SQLite Schema v4: Bootstrap State Table

```sql
CREATE TABLE IF NOT EXISTS bootstrap_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
) WITHOUT ROWID;
```

State keys track:
- `seedpack_version`: Current seedpack version applied
- `bootstrap_status`: Overall status (pending, in_progress, completed, failed)
- `skill:<name>`: Per-skill state with artifact digest
- `agent:<name>`: Per-agent state with content hash

### Seedpack Schema v2

Updated manifest to include pre-built artifacts:

```json
{
  "schema_version": "2",
  "version": "1.1.0",
  "skills": [{
    "name": "skill-creator",
    "artifact_path": "artifacts/skill-creator.zip",
    "artifact_digest": "sha256:a34ed6ddb7e2..."
  }],
  "system_agents": [{
    "name": "skill-creator-agent",
    "path": "agents/skill-creator-agent.yaml"
  }]
}
```

### Bootstrap Module

New `bootstrap` package with:
- `Bootstrapper` struct holding store and gRPC clients
- `Run()` method that orchestrates the bootstrap flow
- Content digest verification for artifact integrity
- Idempotent resource application (skips unchanged)

### Server Integration

Bootstrap runs after in-process gRPC clients are ready but before the network server starts accepting external connections.

## Benefits

- **Offline-first**: All system resources embedded in binary
- **Idempotent**: Safe to restart - uses content digests for change detection
- **Resumable**: State tracked per-resource, can recover from partial failures
- **Graceful**: Server continues in degraded mode if bootstrap fails
- **Auditable**: Provenance tracking with git commit SHAs and content digests

## Impact

| Component | Change |
|-----------|--------|
| SQLite Store | Schema v4 with 5 new methods |
| Seedpack | Schema v2 with artifact embedding |
| Bootstrap | New 340-line module with tests |
| Server | Integrated bootstrap at startup |
| Agent Client | New `Apply()` method |

**Test Coverage**:
- 15 seedpack tests (7 updated, 2 new)
- 10 new bootstrap state tests
- 7 new bootstrap module tests

## Related Work

- Phase 1.1-1.3: Seedpack infrastructure (previous sessions)
- Research: `research.seedpack-bootstrap-architecture/04.report.gpt.md`
- K3s AddOns pattern: Versioned, idempotent resource application

---

**Status**: ✅ Production Ready
**Project**: 20260207.03.cli-platform-capabilities (Phase 2.1, 2.2)
