# DD-T05E: Backend API Requirements for Phase 4 (Version History & Diff)

**Created**: 2026-05-09
**Author**: Resource Views UX Overhaul — Phase 4 Design Spike
**Status**: APPROVED
**Audience**: Backend engineers implementing `stigmer-server` (Go/SQLite) and `stigmer-service` (Java/MongoDB)

---

## Executive Summary

The frontend SDK (`@stigmer/react`) has shipped a complete Skill Version Timeline and Multi-File Diff Viewer (Phase 4 sub-tasks T05-C and T05-D). The proto contract is defined and code-generated across all stubs. Two backend gaps remain:

1. **`listVersions` RPC** — proto exists, handler is unimplemented in both editions
2. **`message` field on `PushSkillRequest`** — proto change needed to support version messages

Additionally, this document specifies the artifact retention policy and captures informational notes on future Agent/MCP versioning and audit log API shape.

The frontend gracefully degrades today: `useSkillVersions` catches gRPC `UNIMPLEMENTED` (code 12) and renders an empty state. Once the backend ships these handlers, the version timeline and diff viewer activate automatically with zero frontend changes.

---

## Table of Contents

1. [Proto Change: `message` Field on `PushSkillRequest`](#1-proto-change-message-field-on-pushskillrequest)
2. [`listVersions` RPC Implementation Spec](#2-listversions-rpc-implementation-spec)
3. [Archival Semantics Divergence (Action Required)](#3-archival-semantics-divergence-action-required)
4. [Artifact Retention Policy](#4-artifact-retention-policy)
5. [Future: Agent/MCP Server Versioning (Informational)](#5-future-agentmcp-server-versioning-informational)
6. [Future: Audit Log API Shape (Informational)](#6-future-audit-log-api-shape-informational)

---

## 1. Proto Change: `message` Field on `PushSkillRequest`

### Motivation

`SkillVersionEntry.message` (field 7) exists in the response proto but there is no corresponding input field on `PushSkillRequest`. Without it, the version timeline can only show git commit messages (when available) but has no way to display a human-authored description of what changed in each push.

### Change Required

Add `string message` to `PushSkillRequest` in `apis/ai/stigmer/agentic/skill/v1/io.proto`:

```protobuf
message PushSkillRequest {
  string org = 1 [(buf.validate.field).required = true];
  bytes artifact = 2 [(buf.validate.field).required = true];
  string tag = 3 [(buf.validate.field).string.pattern = "^$|^[a-zA-Z0-9._-]+$"];
  GitProvenance git_provenance = 4;
  reserved 5;

  // Optional human-readable message describing what changed in this version.
  // Displayed in the version timeline alongside the version hash and timestamp.
  // Analogous to a git commit message. If empty, the version timeline falls
  // back to displaying git_provenance.commit message when available.
  // Examples: "Added PDF extraction tool", "Fixed timeout in web scraper"
  string message = 6;
}
```

### Storage

The message must be persisted so it survives in version history:

- **Option A (recommended)**: Store in the archived `Skill` proto's existing fields. Add a `string version_message` field to `SkillStatus` (alongside `version_hash`, `artifact_storage_key`, etc.). The push handler sets `status.version_message = req.message` before archiving.
- **Option B**: Store only in the audit record's extra columns. This requires schema migration in both SQLite and MongoDB. More complex, less aligned with the existing proto-as-snapshot pattern.

**Recommendation**: Option A. The `Skill` proto snapshot already contains everything about a version. Adding `version_message` to `SkillStatus` keeps the data co-located and the `listVersions` handler simply reads it from the archived proto when mapping to `SkillVersionEntry.message`.

### CLI Integration

The `stigmer skill push` command should accept:

```
stigmer skill push ./my-skill --message "Added PDF extraction tool"
stigmer skill push ./my-skill -m "Fixed timeout in web scraper"
```

The `-m` / `--message` flag maps to `PushSkillRequest.message`. When omitted, the field is empty (the timeline shows git commit message as fallback, or nothing).

### Codegen

After proto change:
- **OSS**: `make codegen` — regenerates Go stubs, TS/Dart/Python types
- **Cloud**: `make protos` — regenerates Java, Go, Python, TS, Dart stubs

### Impact

- Non-breaking: new optional field on an existing request message
- `buf breaking` will pass (additive-only change)
- Frontend `useSkillVersions` already maps `SkillVersionEntry.message` — it will display the value as soon as the backend populates it

---

## 2. `listVersions` RPC Implementation Spec

### Proto Contract (Already Defined)

```
apis/ai/stigmer/agentic/skill/v1/query.proto
  rpc listVersions(ListSkillVersionsInput) returns (ListSkillVersionsResponse);

apis/ai/stigmer/agentic/skill/v1/io.proto
  message ListSkillVersionsInput { org, slug, page_token, page_size }
  message SkillVersionEntry { version_hash, pushed_at, pushed_by, tag, is_current, git_provenance, message, artifact_storage_key }
  message ListSkillVersionsResponse { versions[], next_page_token, total_count }
```

### Handler Logic (Pseudocode — Both Editions)

```
listVersions(input):
  1. Validate input (org, slug required)
  2. Resolve skill by org+slug → skill ID
     - OSS: reuse FindResourceBySlug pattern from get_by_reference.go
     - Cloud: reuse skillRepo.findByOrgAndSlug() from SkillGetByReferenceHandler
  3. If skill not found → return NOT_FOUND
  4. Load audit history (newest-first)
     - OSS: store.ListAuditHistory(skill_kind, skill.metadata.id) → [][]byte
     - Cloud: skillAuditRepo.findAllBySkillId(skill.metadata.id) → List<Skill>
  5. Map each archived Skill proto → SkillVersionEntry (see field mapping below)
  6. Deduplicate: skip any audit entry whose version_hash matches the live skill
     (See section 3 — this handles the OSS archival pattern where current version is also in audit)
  7. Prepend current live skill as first entry with is_current=true
  8. Apply pagination (page_token, page_size)
  9. Return ListSkillVersionsResponse with total_count
```

### Field Mapping: Archived `Skill` → `SkillVersionEntry`

| `SkillVersionEntry` field | Source from archived `Skill` proto |
|---|---|
| `version_hash` | `status.version_hash` |
| `pushed_at` | `status.audit.spec_audit.updated_at` (for updates) or `status.audit.spec_audit.created_at` (for first version) |
| `pushed_by` | `status.audit.spec_audit.updated_by` (or `created_by` for first version) |
| `tag` | `spec.tag` |
| `is_current` | `false` for all audit entries; `true` only for the prepended live skill |
| `git_provenance` | `status.git_provenance` |
| `message` | `status.version_message` (after proto change in section 1 is implemented) |
| `artifact_storage_key` | `status.artifact_storage_key` |

### Authorization

Both editions skip proto-level authorization (input has org+slug, not skill ID). The handler must perform authorization after resolving the skill:

- **OSS**: No multi-tenant auth — no authorization step needed (matches `getByReference` pattern)
- **Cloud**: After resolving skill ID, check `can_view` permission via OpenFGA (matches `SkillGetByReferenceHandler` pattern)

### Pagination

- **Cursor**: Use `archived_at` timestamp (or auto-increment `id` in SQLite) as cursor. Encode as opaque base64 token.
- **Default page size**: 50 (matches proto comment)
- **First page**: `page_token` is empty or omitted
- **Last page**: `next_page_token` is empty in response
- **Total count**: Count all audit records + 1 (for live skill). This is a simple `COUNT(*)` query — acceptable at current scale.

### OSS Implementation (Go)

New file: `backend/services/stigmer-server/pkg/domain/skill/controller/list_versions.go`

Update: `backend/services/stigmer-server/pkg/domain/skill/controller/BUILD.bazel` — add `list_versions.go` to `srcs`

The handler follows the existing pipeline pattern. Key steps:

1. `ValidateProtoStep` — validates `ListSkillVersionsInput`
2. `ResolveSkillBySlugStep` — finds skill by org+slug using `FindResourceBySlug` (reuse from `get_by_reference.go`)
3. `ListAuditHistoryStep` — calls `store.ListAuditHistory(skill_kind, skillId)`, unmarshals each `[]byte` into `skillv1.Skill`
4. `MapToVersionEntriesStep` — maps archived protos + live skill → `[]SkillVersionEntry`, deduplicates, paginates

### Cloud Implementation (Java)

New handler class: `SkillListVersionsHandler` extending `CustomOperationHandlerV2<ListSkillVersionsInput, ListSkillVersionsResponse>`

Annotated with: `@RequestRoute(controller = SkillQueryControllerGrpc.class, method = SkillQueryController.Method.listVersions)`

Pipeline steps:
1. `ValidateFieldConstraints` — validate input
2. `ResolveSkillBySlug` — `skillRepo.findByOrgAndSlug(org, slug)`
3. `Authorize` — OpenFGA `can_view` check on resolved skill ID
4. `LoadVersionHistory` — `skillAuditRepo.findAllBySkillId(skillId)`
5. `MapAndPaginate` — map `List<Skill>` → `List<SkillVersionEntry>`, prepend current, apply pagination
6. `SendResponse`

### Edge Cases

| Scenario | Expected behavior |
|---|---|
| Skill exists, never been updated (single version) | Return 1 entry: the live skill with `is_current=true` |
| Skill exists, pushed N times | Return N entries (newest-first). First entry is live skill with `is_current=true` |
| Skill does not exist | Return `NOT_FOUND` |
| Deleted skill | Return `NOT_FOUND` (audit records cascade-deleted in OSS; Cloud TBD) |
| Same content pushed twice (same hash) | OSS: two audit entries with same hash (archival happens every push). Cloud: one audit entry (archival skipped when hash unchanged). Handler should deduplicate by hash — see section 3. |
| `page_size = 0` | Use default (50) |
| `page_token` points past end | Return empty `versions[]` with empty `next_page_token` |

### Error Contract

| Condition | gRPC code | Message |
|---|---|---|
| Missing `org` | `INVALID_ARGUMENT` | `"org is required"` |
| Missing `slug` | `INVALID_ARGUMENT` | `"slug is required"` |
| Skill not found | `NOT_FOUND` | `"Skill '{slug}' not found in organization '{org}'"` |
| Invalid `page_token` | `INVALID_ARGUMENT` | `"Invalid page token"` |
| Internal store failure | `INTERNAL` | `"Failed to load version history"` (with wrapped error for logging) |

---

## 3. Archival Semantics Divergence (Action Required)

### Current State

The two editions archive skill versions differently:

**OSS (Go) — archives the NEW version:**
- Push pipeline step 9 (`ArchiveCurrentSkillStep`) runs AFTER field population (step 8), BEFORE DB persist (step 10)
- Archives the fully-populated new skill with new artifact data
- Runs on EVERY push (both create and update)
- Result: audit table contains ALL versions including the current one

**Cloud (Java) — archives the PREVIOUS version:**
- Push pipeline step `ArchiveCurrentVersion` archives the EXISTING skill BEFORE writing the new one
- Skips archival on first push (no previous version exists)
- Skips archival when content hash is unchanged
- Result: audit table contains all versions EXCEPT the current one and the first-ever version

### Impact on `listVersions`

| Scenario | OSS audit contents | Cloud audit contents |
|---|---|---|
| After push #1 | `[v1]` | `[]` (empty) |
| After push #2 | `[v1, v2]` | `[v1]` |
| After push #3 | `[v1, v2, v3]` | `[v1, v2]` |
| After push #2 (same content) | `[v1, v2-dup]` | `[v1]` (skip, same hash) |

### Recommended Alignment

**Align Cloud to match OSS behavior**: archive the new version (after field population), on every push.

Rationale:
- Simpler `listVersions` handler — just return audit records, no need to synthesize the current version from the live row
- No missing first-version gap — all versions are in audit from day one
- The live `skill` row becomes a fast-path pointer to the latest version, while audit is the complete history
- Easier to reason about: "audit = complete ordered history of all versions ever pushed"

### Migration Steps (Cloud)

1. Move `archiveCurrentVersion` step from its current position (before `updateSkillState`) to after `updateSkillState` (after field population, before `persistSkill`)
2. Remove the `isNew` skip — archive on create too
3. Remove the hash-equality skip — archive every push (the hash column is indexed, dedup is a query concern not a storage concern)
4. Archive the fully-built new skill, not the existing one

### Handler Normalization

With aligned semantics, the `listVersions` handler is identical in both editions:

```
1. Resolve skill by org+slug
2. Load audit history (newest-first)
3. Mark first entry as is_current=true (since audit has the latest version)
4. Paginate and return
```

No prepending of the live skill, no deduplication, no special first-version handling.

### If Alignment Is Deferred

If the Cloud archival change cannot be done in the same PR, the `listVersions` handler must compensate:

1. Prepend the live skill as first entry with `is_current=true`
2. Skip audit entries whose `version_hash` matches the live skill's `status.version_hash` (avoids duplicate in OSS where current is in both audit and live)
3. The total count is `audit_count + 1`

This works but adds complexity to the handler. The recommendation remains to align first.

---

## 4. Artifact Retention Policy

### Context

The diff viewer (`useSkillDiff`) fetches two historical skill artifacts by `artifact_storage_key` from `SkillVersionEntry`, decompresses both ZIPs, and computes a multi-file text diff. This depends on historical artifacts remaining available in storage.

### Current State

- **OSS (Local filesystem)**: Artifacts are stored at `<storagePath>/skills/<sha256>.zip`. Content-addressable, deduplicated by hash. No garbage collection exists — files persist indefinitely.
- **Cloud (Cloudflare R2)**: Artifacts are stored at `skills/{org}/{slug}/{version-hash}.zip`. No garbage collection exists — objects persist indefinitely.

### Required Policy

**Retain artifacts as long as their corresponding audit records exist.**

The invariant: if a `SkillVersionEntry` returned by `listVersions` contains an `artifact_storage_key`, the artifact at that key must be downloadable via `getArtifact`. A `NOT_FOUND` from `getArtifact` for a key referenced in version history is a data integrity violation.

### Future Retention Limits

When/if we add retention limits (e.g., "keep last N versions" or "prune versions older than M days"), the cleanup must be atomic:

1. Delete audit records outside the retention window
2. For each deleted audit record, check if any remaining audit record or the live skill references the same `artifact_storage_key`
3. If no remaining references, delete the artifact from storage
4. If still referenced (content-addressable dedup means multiple versions can share a hash), leave the artifact

This is not needed now — no retention limits exist and the product is in dev stage. Document this as a future consideration.

### Frontend Behavior on Missing Artifacts

The diff viewer already handles this gracefully: `useSkillDiff` catches fetch errors and renders an error state in `SkillDiffDialog`. Individual files that fail to load show inline error messages. The version timeline itself is unaffected — it only needs the `SkillVersionEntry` metadata, not the artifact bytes.

---

## 5. Future: Agent/MCP Server Versioning (Informational)

This section is not for implementation. It captures what would be needed IF Agent and MCP Server versioning is added in the future, based on the architecture established for Skills.

### Current State

- **Skills**: Full audit archival on every push (OSS). `SkillAuditRepo` (Cloud). `ListSkillVersions` RPC (defined, pending implementation).
- **Agents**: No audit archival in either edition. Apply/update overwrites the live row. No version history.
- **MCP Servers**: No audit archival in either edition. Apply/update overwrites the live row. No version history.

### What Would Be Needed

#### Proto Additions

Mirror the Skill pattern for each resource type:

```
ListAgentVersionsInput { org, slug, page_token, page_size }
AgentVersionEntry { version_hash, applied_at, applied_by, is_current, message }
ListAgentVersionsResponse { versions[], next_page_token, total_count }

ListMcpServerVersionsInput { org, slug, page_token, page_size }
McpServerVersionEntry { version_hash, applied_at, applied_by, is_current, message }
ListMcpServerVersionsResponse { versions[], next_page_token, total_count }
```

#### Backend Changes

1. Add `SaveAudit` calls to Agent and MCP Server apply/update pipelines (both editions)
2. Compute content hash from the serialized spec (deterministic proto serialization)
3. Implement `listVersions` handler for each (same pattern as Skill)
4. Cloud: Create `AgentAuditRepo`, `McpServerAuditRepo` with MongoDB collections and indexes

#### Diff Viewer

The existing `DiffViewer`, `MultiFileDiffView`, and diff computation infrastructure is generic. For Agent/MCP diffs, the change is simpler than Skills:
- Skills diff multi-file ZIP contents (complex)
- Agents/MCP Servers would diff serialized YAML specs (single text diff)

A `useAgentDiff(fromVersion, toVersion)` hook would serialize both `AgentSpec` protos to YAML and pass them to the existing `computeDiff()` function.

#### Key Question

Does platform-managed versioning for Agents and MCP Servers add value beyond what GitOps provides? Most teams using Stigmer apply Agent and MCP Server configs from YAML files in a git repository. Git already provides complete version history, diff, and blame for these files. Skills are different — they are content-addressed artifact packages pushed as ZIPs without a guaranteed 1:1 YAML-in-repo equivalent.

**Recommendation**: Defer until real user demand emerges. The version timeline UX is validated with Skills. If users request Agent/MCP versioning, the frontend infrastructure is ready — only the backend audit plumbing and proto additions are needed.

---

## 6. Future: Audit Log API Shape (Informational)

This section is not for implementation. It captures the frontend's expected consumption model for a future audit log feature on resource detail pages.

### Use Case

An "Activity" or "Audit Log" tab on resource detail pages showing a chronological feed of all events — created, updated, deleted, tag changed, visibility changed, permissions modified, etc.

### Expected API Shape

```protobuf
// Informational — not for immediate implementation

message AuditLogEntry {
  string id = 1;
  google.protobuf.Timestamp timestamp = 2;
  ApiResourceAuditActor actor = 3;
  AuditEventType event_type = 4;
  string resource_kind = 5;
  string resource_id = 6;
  string resource_name = 7;
  string description = 8;        // human-readable: "Changed visibility to public"
  map<string, string> metadata = 9;  // event-specific key-value pairs
}

enum AuditEventType {
  AUDIT_EVENT_TYPE_UNSPECIFIED = 0;
  AUDIT_EVENT_TYPE_CREATED = 1;
  AUDIT_EVENT_TYPE_UPDATED = 2;
  AUDIT_EVENT_TYPE_DELETED = 3;
  AUDIT_EVENT_TYPE_TAG_CHANGED = 4;
  AUDIT_EVENT_TYPE_VISIBILITY_CHANGED = 5;
  AUDIT_EVENT_TYPE_PERMISSION_CHANGED = 6;
  AUDIT_EVENT_TYPE_VERSION_PUSHED = 7;
}

message ListAuditLogInput {
  // Scope: either resource-level or org-level
  string org = 1;
  string resource_id = 2;         // optional — omit for org-wide log
  string resource_kind = 3;       // optional — filter by kind

  // Filters
  repeated AuditEventType event_types = 4;
  string actor_id = 5;
  google.protobuf.Timestamp after = 6;
  google.protobuf.Timestamp before = 7;

  // Pagination
  string page_token = 8;
  int32 page_size = 9;
}

message ListAuditLogResponse {
  repeated AuditLogEntry entries = 1;
  string next_page_token = 2;
  int32 total_count = 3;
}
```

### Frontend Consumption

The SDK would provide:
- `useAuditLog(resourceKind, resourceId, filters)` — data hook
- `AuditTimeline` — generic timeline component (could reuse `VersionTimeline` pattern)

### Scope Distinction

The audit log is a **separate concern** from version history:
- **Version history** = content snapshots (what the resource looked like at each version). Used for diff and rollback.
- **Audit log** = event stream (who did what and when). Used for compliance, debugging, and accountability.

Both could share UI primitives (timeline layout, actor display, timestamp formatting) but they serve different purposes and have different data sources.

### Recommendation

This requires a dedicated backend design effort including:
- Event capture pipeline (what triggers audit log entries)
- Storage model (append-only, potentially high-volume for active orgs)
- Retention policy (compliance requirements may dictate minimums)
- Cloud-only or core feature classification

Defer to a dedicated project. The frontend infrastructure (timeline components, filtering patterns) is already in place from the version history work.

---

## Summary of Action Items

| # | Item | Priority | Edition | Effort |
|---|---|---|---|---|
| 1 | Add `message` field to `PushSkillRequest` + `version_message` to `SkillStatus` | High | Both (proto change) | S |
| 2 | Run `make codegen` (OSS) + `make protos` (Cloud) after proto change | High | Both | XS |
| 3 | Implement `listVersions` handler in `stigmer-server` (Go) | High | OSS | M |
| 4 | Implement `SkillListVersionsHandler` in `stigmer-service` (Java) | High | Cloud | M |
| 5 | Align Cloud archival to match OSS (archive new version, every push) | Medium | Cloud | S |
| 6 | Add `-m` / `--message` flag to `stigmer skill push` CLI command | Medium | OSS (CLI) | S |
| 7 | Document artifact retention policy in ops runbook | Low | Both | XS |

Items 1-4 are required for the version timeline and diff viewer to function end-to-end.
Item 5 simplifies the handler logic and ensures behavioral consistency.
Items 6-7 are follow-ups that can be done in subsequent PRs.

---

## References

- Proto definitions: `apis/ai/stigmer/agentic/skill/v1/io.proto`, `query.proto`
- OSS push handler: `backend/services/stigmer-server/pkg/domain/skill/controller/push.go`
- OSS store interface: `backend/libs/go/store/interface.go`
- OSS SQLite audit: `backend/libs/go/store/sqlite/store.go` (lines 1092-1133)
- Cloud push handler: `backend/services/stigmer-service/.../skill/request/handler/SkillPushHandler.java`
- Cloud audit repo: `backend/services/stigmer-service/.../skill/repo/SkillAuditRepo.java`
- Cloud audit indexes: `backend/services/stigmer-service/.../migrations/U20260125_SkillAuditIndexes.java`
- Frontend hook: `sdk/react/src/skill/useSkillVersions.ts` (graceful degradation on UNIMPLEMENTED)
- Frontend diff hook: `sdk/react/src/skill/useSkillDiff.ts`
- Phase 4 plan: `_projects/2026-05/20260508.02.resource-views-ux-overhaul/tasks/T05_0_plan.md`
