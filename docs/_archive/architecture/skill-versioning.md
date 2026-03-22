# Skill Versioning Architecture

## Overview

Stigmer implements a versioned, artifact-centric skill system that allows users to package reusable agent capabilities as immutable artifacts. Skills are stored with content-addressable hashing and support both mutable tags and immutable version references.

## Key Concepts

### Artifact-Centric Model

Skills are packaged as Zip artifacts containing:
- **SKILL.md** (required): Interface definition, documentation, usage examples
- **Tools** (optional): Executable scripts or binaries
- **Additional files** (optional): Referenced by SKILL.md

The artifact is the source of truth - all skill metadata is derived from the uploaded Zip.

### Content-Addressable Storage

Each skill version is identified by a **SHA256 hash** of its Zip content:
- Same content = same hash = single storage copy (deduplication)
- Hash changes if content changes (immutability)
- Hash verifies content hasn't been corrupted (integrity)

### Versioning Strategy

Skills support two versioning approaches:

**1. Mutable Tags** (recommended for development):
- User-provided labels: `"stable"`, `"v1.0"`, `"latest"`
- Tags can move to new versions (like Docker tags)
- Old versions preserved in audit history
- Resolved by timestamp ordering

**2. Immutable Hashes** (recommended for production):
- Exact SHA256 hash reference
- Never changes (immutable)
- Guarantees specific version

### Spec vs Status Separation

Following Kubernetes patterns, skills separate user intent from system state:

**SkillSpec** (User Intent):
```protobuf
message SkillSpec {
  string skill_md = 1;  // SKILL.md content for prompt injection
  string tag = 2;       // Optional mutable version pointer
}
```

**SkillStatus** (System State):
```protobuf
message SkillStatus {
  ApiResourceAudit audit = 99;       // Creation/modification timestamps
  string version_hash = 1;            // SHA256 hash (immutable ID)
  string artifact_storage_key = 2;    // Storage location
  SkillState state = 3;               // UPLOADING/READY/FAILED
}
```

## Architecture Components

### 1. Push Operation (Single-Phase)

The `push` RPC handles both creation and updates:

```
User pushes skill → Backend normalizes name to slug
                 ↓
            Find or create skill
                 ↓
       Archive existing version (if update)
                 ↓
   Extract SKILL.md from Zip artifact
                 ↓
       Calculate SHA256 hash
                 ↓
    Check for deduplication (skip if hash exists)
                 ↓
      Store artifact in storage backend
                 ↓
    Update skill spec and status
                 ↓
         Save to MongoDB
```

**Benefits**:
- No weird intermediate states (no empty skill_md)
- One operation for both create and update
- Simplified client workflow

### 2. Storage Abstraction

Skills support multiple storage backends:

**Local Storage** (daemon mode):
- Path: `~/.stigmer/storage/skills/<hash>.zip`
- Direct filesystem access
- No network latency

**Cloud Storage** (hosted mode):
- Path: `skills/<slug>_<hash>.zip`
- CloudFlare R2 buckets
- Globally distributed

The storage backend is determined by configuration (`STIGMER_STORAGE_MODE=local|cloud`).

### 3. MongoDB Schema

**Main Collection** (`skills`):
- Contains current state only
- One record per skill
- Fast lookups for latest version

```json
{
  "_id": "skl-abc123",
  "metadata": {
    "slug": "calculator",
    "owner_scope": "ORGANIZATION",
    "org": "org-xyz"
  },
  "spec": {
    "skill_md": "# Calculator\n\n...",
    "tag": "stable"
  },
  "status": {
    "version_hash": "abc123def456...",
    "artifact_storage_key": "skills/calculator_abc123def456.zip",
    "state": "READY",
    "audit": {
      "spec_audit": {
        "created_at": "...",
        "updated_at": "2026-01-25T14:30:00Z"
      }
    }
  }
}
```

**Audit Collection** (`skill_audit`):
- Complete history of all modifications
- Immutable snapshots
- Indexed for version queries

Every update to the main collection triggers automatic archival:
1. Snapshot current state → `skill_audit`
2. Apply changes to main record
3. Update timestamps

### 4. Version Resolution

**Query with no version** (default):
```
GET /skills/calculator
→ Returns main table record (latest)
```

**Query with tag**:
```
GET /skills/calculator?tag=stable
→ Check main table: if spec.tag == "stable" → return
→ Else, query audit: find latest by timestamp with tag "stable"
```

**Query with hash** (immutable):
```
GET /skills/calculator?hash=abc123def456...
→ Check main table: if status.version_hash matches → return
→ Else, query audit: find exact hash match
```

### 5. Agent Integration

Agents reference skills with optional version:

```yaml
skills:
  - scope: organization
    org: org-xyz
    slug: calculator
    version: stable  # or hash or empty (latest)
```

**Resolution flow**:
1. Agent execution starts
2. Backend resolves version (tag → hash)
3. Fetches `skill_md` for prompt injection
4. Downloads artifact from storage
5. Extracts to `/bin/skills/calculator/`
6. Mounts read-only
7. Adds to $PATH

**Prompt injection**:
```
### SKILL: Calculator
LOCATION: /bin/skills/calculator/

<Content of SKILL.md>
```

## Design Rationale

### Why Single-Phase Push?

**Problem with two-phase**:
- Create empty skill → intermediate state with invalid `skill_md`
- Requires managing two separate calls
- Complex error handling

**Solution**:
- Artifact is the source of truth
- One operation creates/updates everything
- No invalid intermediate states

### Why Content-Addressable?

**Benefits**:
- **Deduplication**: Same content stored only once
- **Integrity**: Hash verifies no corruption
- **Immutability**: Hash changes if content changes
- **Cache-friendly**: Can cache by hash forever

### Why No Separate create/update RPCs?

**Simplified API**:
- Clients don't need to know if skill exists
- Backend handles find-or-create logic
- Same authorization for both operations
- Less client-side complexity

### Why Name-Based Targeting?

**User Experience**:
- Users provide readable names (e.g., "Math Utils")
- Backend normalizes to slug (e.g., "math-utils")
- Same workflow for create and update
- No need to track skill IDs

## Security Considerations

### Authorization

**Push operation**:
- Checks org-level `can_create_skill` permission
- Works for both create and update
- Field path: `"org"` (from request)

**Additional checks** (backend):
- Verify skill belongs to requested org (if updating)
- Validate scope matches authorization context
- Prevent cross-org skill hijacking

### Artifact Validation

**Required checks**:
- Zip is valid and extractable
- SKILL.md exists and is valid UTF-8
- Total size within limits (e.g., 100MB)
- No malicious files (e.g., symlinks outside Zip)

### Sandbox Isolation

Skills are mounted **read-only** in agent sandboxes:
- Skills cannot modify themselves
- Skills cannot access other skills' directories
- Execution happens in isolated environment

## Performance Optimization

### Deduplication

**Benefits**:
- Reduces storage costs (same content stored once)
- Faster uploads (skip if hash exists)
- Instant "version switch" (just update pointer)

**Example**:
```
Push v1: Content "A" → Hash "abc" → Upload (10MB, 5s)
Push v2: Content "A" → Hash "abc" → Skip upload (0s)
Push v3: Content "B" → Hash "def" → Upload (10MB, 5s)
```

### Caching

**Immutable by hash**:
- Artifacts can be cached indefinitely (content never changes)
- CDN-friendly (CloudFlare R2 caching)
- No cache invalidation needed

**Mutable by tag**:
- Cache with short TTL or invalidate on update
- Resolved to hash before caching artifact

### Indexing

**MongoDB indexes**:
- Main collection: `slug` (unique), `owner_scope + org`
- Audit collection: `skill_id`, `archived_at`, `spec.tag`, `status.version_hash`

## Future Enhancements

### Planned Features

1. **Skill Dependencies**: Allow skills to reference other skills
2. **Version Constraints**: Support semantic versioning constraints (`>=v1.0,<v2.0`)
3. **Skill Marketplace**: Public registry of platform-scoped skills
4. **Differential Updates**: Upload only changed files (delta compression)
5. **Multi-arch Support**: Platform-specific artifacts (Linux/macOS/Windows)

### Extensibility

The versioning system is designed to be extensible:
- Other resources can adopt versioning (agents, workflows)
- ApiResourceReference already supports version field
- Storage abstraction supports new backends (Azure, GCS)

## References

- Proto Definitions: `apis/ai/stigmer/agentic/skill/v1/`
- Design Decisions: `_projects/2026-01/20260125.01.skill-api-enhancement/design-decisions/`
- Implementation Plan: `_projects/2026-01/20260125.01.skill-api-enhancement/tasks/T01_0_plan.md`
- Changelog: `_changelog/2026-01/2026-01-25-143037-implement-skill-api-proto-definitions.md`

## Related Documentation

- [Getting Started: Creating Skills](../getting-started/creating-skills.md) - How to create and upload skills
- [CLI Reference: stigmer apply](../cli/stigmer-apply.md) - Using CLI to upload skills
- [Agent Configuration](../guides/agent-configuration.md) - Attaching skills to agents

---

**Last Updated**: 2026-01-25  
**Status**: Implemented in v0.x
