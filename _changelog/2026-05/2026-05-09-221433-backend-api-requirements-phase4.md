# Backend API Requirements Document for Phase 4 Version History

**Date**: May 9, 2026

## Summary

Completed the final sub-task of Phase 4 (Resource Views UX Overhaul) by writing a formal Backend API Requirements Document specifying the exact backend work needed in both OSS (Go/SQLite) and Cloud (Java/MongoDB) to support the Skill Version Timeline and Multi-File Diff Viewer. This closes Phase 4 — all five sub-tasks (T05-A through T05-E) are complete.

## Problem Statement

The frontend SDK shipped a complete version timeline and diff viewer for Skills (T05-C, T05-D), but the backend `listVersions` RPC remains unimplemented in both editions. The proto contract is defined and code-generated, the frontend gracefully degrades (catches gRPC UNIMPLEMENTED), but the features won't activate end-to-end until the backend ships the handler.

### Pain Points

- No formal spec for backend engineers to implement `listVersions` — only scattered context across proto comments and frontend code
- Archival semantics divergence between OSS and Cloud editions discovered during investigation (OSS archives new version, Cloud archives previous version) — undocumented and potentially confusing for implementers
- `SkillVersionEntry.message` field exists in the proto response but no corresponding input field on `PushSkillRequest` — version messages can't be captured
- No documented artifact retention policy — diff viewer depends on historical ZIPs remaining available

## Solution

Wrote a comprehensive Backend API Requirements Document (`DD-T05E-backend-api-requirements.md`) with six sections that serves as a handoff spec for backend implementation.

## Implementation Details

### Document Sections

1. **Proto Change: `message` field** — Specifies adding `string message` (field 6) to `PushSkillRequest` and `string version_message` to `SkillStatus`. Includes CLI `-m` flag spec, storage recommendation (Option A: store in proto snapshot, not extra columns), and codegen steps.

2. **`listVersions` RPC Implementation Spec** — Complete handler logic for both Go and Java: slug-to-ID resolution, authorization pattern, field mapping table (8 fields from archived `Skill` proto to `SkillVersionEntry`), cursor-based pagination, edge cases (first push, same-content push, deleted skill), and error contract with gRPC status codes.

3. **Archival Semantics Divergence** — Key discovery: OSS `ArchiveCurrentSkillStep` runs after field population (archives the new version on every push, including creates). Cloud `ArchiveCurrentVersion` archives the previous version before overwrite (skips first push and same-hash pushes). Documented the impact on `listVersions` handler logic and recommended aligning Cloud to match OSS, with compensation logic if deferred.

4. **Artifact Retention Policy** — Established the invariant: retain artifacts as long as audit records reference them. Documented future GC considerations (must be atomic: audit + artifact, respecting content-addressable dedup).

5. **Future Agent/MCP Versioning** — Informational sketch confirming neither Agents nor MCP Servers have audit archival in either edition. Captured what would be needed and why to defer.

6. **Future Audit Log API** — Informational sketch of expected proto shape (`AuditLogEntry`, `AuditEventType` enum, `ListAuditLogInput` with filtering) for a future Activity tab.

### Key Discovery

The archival semantics divergence was not previously documented anywhere. This investigation traced the exact pipeline step ordering in both editions:

- **OSS Go**: Validate → Build → Extract → Slug → FindExisting → GenerateID → StoreArtifact → PopulateFields → **Archive** → Persist
- **Cloud Java**: Validate → Authorize → ProcessArtifact → LoadOrCreate → **Archive** → UpdateState → Persist

The difference in step ordering (archive before vs after field population) and skip conditions (Cloud skips first push and same-hash) means the audit tables contain different data in each edition.

## Benefits

- Backend engineers have a single document with everything needed to implement `listVersions` — no need to read frontend code or trace proto definitions
- Archival divergence is documented with a clear alignment recommendation
- Field mapping table eliminates guesswork about how archived protos map to response fields
- Error contract ensures behavioral consistency across editions
- Phase 4 frontend work is formally closed — all SDK components are shipped and awaiting backend activation

## Impact

- **Backend team**: Has a clear implementation spec for 2 handlers (Go + Java) with estimated effort of M each
- **CLI team**: Has spec for `-m` / `--message` flag on `stigmer skill push`
- **Frontend**: Zero additional work — `useSkillVersions` hook will activate automatically when backend ships
- **Platform builders**: Version timeline and diff viewer in `@stigmer/react` SDK will work for their embedded UIs once backend is live

## Related Work

- Phase 4 T05-C: Skill Version Timeline (frontend, Session 14)
- Phase 4 T05-D: Multi-File Diff Viewer (frontend, Session 15)
- Phase 4 T05-A: Detail Page Tabbed Infrastructure (Session 12)
- Phase 4 T05-B: Agent Dependency Graph (Session 13)

---

**Status**: Production Ready
**Timeline**: 1 session (design spike)
