# Design Decision: Skill Proto Structure & Data Model

**Date**: 2026-01-25
**Status**: Approved
**Participants**: Developer, AI Assistant

## Context

We need to design a proper Skill API resource that:
- Follows Stigmer's Kubernetes-inspired API standards
- Supports versioning with both tags and immutable hashes
- Works for both local daemon and cloud storage
- Maintains complete audit history
- Allows content-addressable storage (deduplication)

## Decision Summary

### 1. Proto Structure: Spec vs Status Separation

**Follow Kubernetes pattern: User intent in Spec, System state in Status**

```protobuf
message SkillSpec {
  // User-provided only
  string skill_md = 1;  // SKILL.md content
  string tag = 2;       // Optional tag (e.g., "stable", "v1.0")
}

message SkillStatus {
  // System-generated only
  ai.stigmer.commons.apiresource.ApiResourceAudit audit = 99;
  string version_hash = 1;        // SHA256 (content fingerprint)
  string artifact_storage_key = 2; // Storage location
  SkillState state = 3;            // UPLOADING/READY/FAILED
}
```

**Rationale**:
- Clear ownership: User owns spec, system owns status
- Aligns with all other Stigmer API resources
- `version_hash` is derived FROM content but ASSIGNED BY system → Status
- `artifact_storage_key` is determined by system → Status

### 2. Field Naming: `skill_md` for Content

**Chosen**: `skill_md` (not `content`, `interface_definition`, or `documentation`)

**Rationale**:
- Crystal clear what it contains (SKILL.md content)
- Intuitive in conversation: "Update the skill_md field"
- Format-specific naming is acceptable for clarity
- Better than abstract `content` for this specific use case

### 3. Audit Pattern: Two-Collection Strategy

**Main Collection**: `skills` - Always contains CURRENT state
**Audit Collection**: `skill_audit` - Immutable snapshots of ALL modifications

```javascript
// Main: skills (current state only)
{
  "_id": "uuid",
  "metadata": { "name": "acme/calculator" },
  "spec": { "skill_md": "...", "tag": "v2.0" },
  "status": {
    "version_hash": "def456",
    "artifact_storage_key": "...",
    "audit": {
      "spec_audit": {
        "created_at": "...",
        "updated_at": "..."  // ← Use for ordering
      }
    }
  }
}

// Audit: skill_audit (complete history)
[
  {
    "_id": "uuid_v1",
    "skill_id": "uuid",
    "archived_at": "2026-01-25T10:00:00Z",
    "metadata": {...},  // Full snapshot
    "spec": { "tag": "stable", ... },
    "status": { "version_hash": "abc123", ... }
  },
  {
    "_id": "uuid_v2",
    "skill_id": "uuid",
    "archived_at": "2026-01-25T11:00:00Z",
    "metadata": {...},
    "spec": { "tag": "stable", ... },  // Same tag!
    "status": { "version_hash": "xyz789", ... }
  }
  // ... more versions
]
```

**Archival Trigger**: EVERY modification to main `skills` collection:
1. Snapshot current state → `skill_audit` (immutable)
2. Apply changes to main table
3. Update `status.audit.spec_audit.updated_at`

**Rationale**:
- Simple: Main table always has one record per skill (latest state)
- Complete history: Audit captures every modification
- Performance: Fast lookups for "latest", only search audit when needed
- Time travel: Can reconstruct state at any point in time

### 4. Version Ordering: Use Existing Timestamps (No Version Number Field)

**Decision**: Use `status.audit.spec_audit.updated_at` for ordering, NOT a separate `version_number` field

**Query Pattern**:
```javascript
// Get most recent archived version with tag "stable"
db.skill_audit.find({
  skill_id: "uuid",
  "spec.tag": "stable"
})
.sort({"status.audit.spec_audit.updated_at": -1})  // ← Existing field
.limit(1)
```

**Rationale**:
- Reuse existing audit infrastructure (`ApiResourceAudit`)
- No redundant version_number field
- Timestamps provide same ordering capability
- Follows existing Stigmer patterns

### 5. Tag Strategy: Mutable Tags (Option A)

**Tags are mutable pointers** - can move to new versions

**Behavior**:
```
User pushes with tag "stable":
1. Archive current main record → skill_audit
2. Update main record: new hash, new skill_md, tag="stable"
3. Tag "stable" now points to new version

Result: Tag moves forward, old versions archived
```

**Multiple versions can have same tag in audit history**:
- Main table: tag "stable" points to hash "def456" (current)
- Audit: tag "stable" pointed to hash "abc123" (version 1)
- Audit: tag "stable" pointed to hash "xyz789" (version 2)

**Resolution**: Use timestamp ordering to get "latest version with this tag"

**Rationale**:
- Flexible: Users can update "stable" to point to newest version
- Immutability available: Users can use exact hash for pinning
- Docker-like: "latest" tag behavior familiar to developers
- Audit preserves history of what each tag pointed to over time

### 6. Content-Addressable Storage: Same Content = Same Hash

**Decision**: SHA256 hash is calculated from Zip content. Same content → Same hash.

**Behavior**:
```
Push 1: Content "v1" → Hash "abc123" → Upload
Push 2: Content "v1" (identical) → Hash "abc123" → Skip upload!
Push 3: Content "v2" → Hash "def456" → Upload
```

**Deduplication Logic**:
```java
String hash = calculateSHA256(zipContent);
if (artifactStorage.exists(hash)) {
    logger.info("Artifact {} already exists, skipping upload", hash);
    // Just update metadata/tags, don't re-upload
} else {
    artifactStorage.upload(hash, zipContent);
}
```

**Rationale**:
- Efficiency: No duplicate storage of identical content
- Integrity: Hash verifies content hasn't been corrupted
- Immutability: Hash changes if content changes
- Cache-friendly: Can cache by hash forever

### 7. Audit Framework Implementation

**Approach**: Evaluate during implementation

**Options**:
1. **MongoDB Change Streams** - Listen for changes, auto-create audit records
2. **Spring Data Event Listeners** - `AbstractMongoEventListener` intercepts saves
3. **Custom Interceptor** - Manual audit logic in handlers

**Decision**: Defer to implementation phase

**Requirements**:
- Automatic: Archive happens transparently on every update
- Complete: Capture full snapshot (metadata + spec + status)
- Timestamp: Use existing `ApiResourceAudit` timestamps
- Indexed: Ensure `skill_id` and `archived_at` indexed for performance

## Resolution Logic

### Query: "acme/calculator" (no version)
```
→ Return main table record (always latest)
```

### Query: "acme/calculator:latest"
```
→ Return main table record (always latest)
```

### Query: "acme/calculator:stable" (tag)
```
1. Check main table: if spec.tag == "stable" → Return
2. Else, query audit:
   db.skill_audit.findOne(
     {skill_id: "uuid", "spec.tag": "stable"},
     {sort: {"status.audit.spec_audit.updated_at": -1}}
   )
```

### Query: "acme/calculator:abc123" (exact hash)
```
1. Check main table: if status.version_hash == "abc123" → Return
2. Else, query audit:
   db.skill_audit.findOne(
     {skill_id: "uuid", "status.version_hash": "abc123"}
   )
```

## Proto Field Locations Summary

| Field | Location | Owner | Rationale |
|-------|----------|-------|-----------|
| `skill_md` | Spec | User | User writes content |
| `tag` | Spec | User | User chooses tag name |
| `version_hash` | Status | System | Calculated from content |
| `artifact_storage_key` | Status | System | Determined by storage backend |
| `state` | Status | System | Lifecycle management |
| `audit` | Status | System | Automatic tracking |

## References

- ADR Document: `/Users/suresh/scm/github.com/stigmer/stigmer/_cursor/adr-doc.md`
- AgentExecution Proto Pattern: `apis/ai/stigmer/agentic/agentexecution/v1/`
- ApiResourceAudit: `apis/ai/stigmer/commons/apiresource/status.proto`

## Next Steps

1. Update T01_0_plan.md with these decisions
2. Implement proto definitions following this structure
3. Design audit framework during backend implementation
4. Create examples and documentation

---

**Status**: Ready for implementation in new conversation context
