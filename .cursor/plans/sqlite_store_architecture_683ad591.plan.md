---
name: SQLite Store Architecture
overview: Redesign the SQLite store layer to eliminate BadgerDB key-value patterns and implement a proper relational model with a dedicated audit table, foreign key relationships, and idiomatic SQL operations.
todos:
  - id: schema-migration
    content: Add migration versioning system and create resource_audit table with foreign key to resources table
    status: completed
  - id: interface-evolution
    content: Add audit-specific methods to Store interface (SaveAudit, GetAuditByHash, GetAuditByTag, ListAuditHistory) and deprecate DeleteResourcesByIdPrefix
    status: completed
  - id: sqlite-implementation
    content: Implement new audit methods in SQLite store with proper indexes and enable foreign_keys pragma
    status: completed
  - id: data-migration
    content: Write migration logic to move existing skill_audit/* prefixed records to the new resource_audit table
    status: completed
  - id: controller-push
    content: Update ArchiveCurrentSkillStep in push.go to use SaveAudit instead of prefixed ID
    status: completed
  - id: controller-load
    content: Update LoadSkillByReferenceStep to use GetAuditByHash/GetAuditByTag instead of full table scan
    status: completed
  - id: controller-delete
    content: Simplify or remove DeleteSkillArchivesStep since CASCADE DELETE handles audit cleanup
    status: completed
  - id: test-updates
    content: Update store_test.go and skill_controller_test.go for new audit methods and remove prefix-based tests
    status: completed
isProject: false
---

# SQLite Store Architecture Redesign

## Problem Analysis

The current store implementation carries over key-value patterns from the BadgerDB era:

**Current State:**

- Single `resources` table with `(kind, id)` composite key
- Audit records stored in same table with prefixed IDs: `skill_audit/<resource_id>/<timestamp>`
- `DeleteResourcesByIdPrefix` uses GLOB pattern matching - a key-value store artifact
- Application-level filtering required to distinguish audit from live records

**Critical Issues:**

1. **Inefficient queries**: `ListResources` returns ALL records (including audit), then filters in code ([load_skill_by_reference.go:130-132](backend/services/stigmer-server/pkg/domain/skill/controller/load_skill_by_reference.go))
2. **No referential integrity**: Audit records can become orphaned
3. **Full table scans**: Version resolution scans ALL skills to find audit records for ONE skill ([load_skill_by_reference.go:182-220](backend/services/stigmer-server/pkg/domain/skill/controller/load_skill_by_reference.go))
4. **Anti-pattern interface**: `DeleteResourcesByIdPrefix` exposes implementation detail in the abstraction

**Reference Implementation**: stigmer-cloud's `SkillAuditRepo` uses a dedicated MongoDB collection with:

- `skillId` field referencing the main resource
- `archivedAt` timestamp
- Proper queries: `findBySkillIdAndVersionHash`, `findMostRecentBySkillIdAndTag`
- Clean deletion: `deleteBySkillId(skillId)` - no prefix matching

---

## Proposed Architecture

### New Schema Design

```sql
-- Live resources (unchanged structure, cleaner data)
CREATE TABLE resources (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data BLOB NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (kind, id)
) WITHOUT ROWID;

-- Dedicated audit table with proper relational design
CREATE TABLE resource_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    resource_id TEXT NOT NULL,           -- References resources(kind, id)
    data BLOB NOT NULL,
    archived_at TEXT NOT NULL DEFAULT (datetime('now')),
    version_hash TEXT,                   -- Extracted for indexed queries
    tag TEXT,                            -- Extracted for indexed queries
    FOREIGN KEY (kind, resource_id) REFERENCES resources(kind, id) ON DELETE CASCADE
);

-- Indexes for efficient audit queries
CREATE INDEX idx_audit_resource ON resource_audit(kind, resource_id);
CREATE INDEX idx_audit_hash ON resource_audit(kind, resource_id, version_hash);
CREATE INDEX idx_audit_tag ON resource_audit(kind, resource_id, tag, archived_at DESC);
```

**Key Design Decisions:**

- **Separate audit table**: Clean separation, no prefix filtering needed
- **Foreign key with CASCADE DELETE**: When resource deleted, audit records automatically deleted
- **Extracted queryable fields**: `version_hash` and `tag` as columns for indexed queries
- **`archived_at` timestamp**: Proper datetime instead of nanoseconds-in-key hack
- **Auto-increment ID**: Simple unique identifier, no composite key encoding

---

## Interface Evolution

### Current Interface (to deprecate)

```go
// DeleteResourcesByIdPrefix - BadgerDB artifact, remove this
DeleteResourcesByIdPrefix(ctx context.Context, kind apiresourcekind.ApiResourceKind, idPrefix string) (int64, error)
```

### New Interface Design

```go
// Store defines the contract for resource persistence.
type Store interface {
    // === Live Resource Operations (unchanged) ===
    SaveResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error
    GetResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error
    ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error)
    DeleteResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string) error
    DeleteResourcesByKind(ctx context.Context, kind apiresourcekind.ApiResourceKind) (int64, error)
    
    // === Audit Operations (new) ===
    
    // SaveAudit archives a resource snapshot for version history.
    // The versionHash and tag are extracted for indexed queries.
    SaveAudit(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string, 
              msg proto.Message, versionHash, tag string) error
    
    // GetAuditByHash retrieves an archived version by exact hash match.
    GetAuditByHash(ctx context.Context, kind apiresourcekind.ApiResourceKind, 
                   resourceId, versionHash string, msg proto.Message) error
    
    // GetAuditByTag retrieves the most recent archived version with matching tag.
    GetAuditByTag(ctx context.Context, kind apiresourcekind.ApiResourceKind, 
                  resourceId, tag string, msg proto.Message) error
    
    // ListAuditHistory retrieves all archived versions for a resource, newest first.
    ListAuditHistory(ctx context.Context, kind apiresourcekind.ApiResourceKind, 
                     resourceId string) ([][]byte, error)
    
    // DeleteAuditByResourceId removes all audit records for a resource.
    // Note: With CASCADE DELETE, this is automatic when resource is deleted.
    // This method exists for explicit cleanup scenarios.
    DeleteAuditByResourceId(ctx context.Context, kind apiresourcekind.ApiResourceKind, 
                            resourceId string) (int64, error)
    
    Close() error
}
```

---

## Implementation Plan

### Phase 1: Schema Migration

**Files to modify:**

- [backend/libs/go/store/sqlite/store.go](backend/libs/go/store/sqlite/store.go) - Add migration version system and new schema
```go
// Migration version constants
const (
    schemaVersion1 = 1 // Initial schema (BadgerDB-style)
    schemaVersion2 = 2 // Separate audit table with foreign keys
)

func runMigrations(db *sql.DB) error {
    // Check current version
    version := getCurrentSchemaVersion(db)
    
    if version < schemaVersion2 {
        // Create resource_audit table
        // Migrate existing skill_audit/* records to new table
        // Enable foreign keys
        // Update version
    }
}
```


### Phase 2: Interface and Implementation

**Files to modify:**

- [backend/libs/go/store/interface.go](backend/libs/go/store/interface.go) - Add audit methods, deprecate `DeleteResourcesByIdPrefix`
- [backend/libs/go/store/sqlite/store.go](backend/libs/go/store/sqlite/store.go) - Implement new methods

**Key implementation details:**

- Enable `PRAGMA foreign_keys=ON` (currently OFF)
- `SaveAudit`: Extract `version_hash` and `tag` from proto, insert into `resource_audit`
- `GetAuditByHash`: Indexed query on `(kind, resource_id, version_hash)`
- `GetAuditByTag`: Indexed query with `ORDER BY archived_at DESC LIMIT 1`
- `DeleteResource`: CASCADE automatically cleans up audit records

### Phase 3: Controller Updates

**Files to modify:**

- [backend/services/stigmer-server/pkg/domain/skill/controller/push.go](backend/services/stigmer-server/pkg/domain/skill/controller/push.go) - Use `SaveAudit` instead of prefixed ID
- [backend/services/stigmer-server/pkg/domain/skill/controller/delete.go](backend/services/stigmer-server/pkg/domain/skill/controller/delete.go) - Remove `DeleteSkillArchivesStep` (CASCADE handles it)
- [backend/services/stigmer-server/pkg/domain/skill/controller/load_skill_by_reference.go](backend/services/stigmer-server/pkg/domain/skill/controller/load_skill_by_reference.go) - Use `GetAuditByHash`/`GetAuditByTag` instead of full scan

**Before (current code):**

```go
// push.go - Prefixed ID hack
auditKey := fmt.Sprintf("skill_audit/%s/%d", skill.Metadata.Id, timestamp)
s.store.SaveResource(ctx, apiresourcekind.ApiResourceKind_skill, auditKey, skill)

// load_skill_by_reference.go - Full scan with application filtering
resources, _ := s.store.ListResources(ctx, apiresourcekind.ApiResourceKind_skill)
for _, data := range resources {
    if strings.HasPrefix(skill.Metadata.Id, "skill_audit/") {
        continue // Skip audit records
    }
}
```

**After (clean relational):**

```go
// push.go - Proper audit method
s.store.SaveAudit(ctx, apiresourcekind.ApiResourceKind_skill, 
                  skill.Metadata.Id, skill, 
                  skill.Status.VersionHash, skill.Spec.Tag)

// load_skill_by_reference.go - Targeted query
s.store.GetAuditByHash(ctx, apiresourcekind.ApiResourceKind_skill, 
                       skillID, versionHash, &skill)
```

### Phase 4: Data Migration

**Migration script in `runMigrations`:**

```go
// Migrate existing skill_audit/* records to new table
rows, _ := db.Query(`SELECT kind, id, data, updated_at FROM resources WHERE id LIKE 'skill_audit/%'`)
for rows.Next() {
    // Parse: skill_audit/<resource_id>/<timestamp>
    // Extract version_hash and tag from proto data
    // Insert into resource_audit with proper columns
}

// Delete migrated records from resources table
db.Exec(`DELETE FROM resources WHERE id LIKE 'skill_audit/%'`)
```

---

## Benefits

| Aspect | Before (BadgerDB Pattern) | After (Relational) |

|--------|---------------------------|---------------------|

| Query efficiency | Full table scan + app filter | Indexed direct lookup |

| Data integrity | Manual cleanup required | CASCADE DELETE |

| Interface abstraction | Exposes prefix implementation | Clean domain methods |

| Version lookup | O(n) scan all skills | O(log n) index lookup |

| Audit deletion | GLOB pattern match | Foreign key cascade |

---

## Migration Safety

- **Backward compatible**: Old data migrated automatically on startup
- **Atomic migration**: Transaction wraps schema change + data migration
- **Rollback path**: Keep schema version tracking for potential rollback
- **Zero downtime**: Migration runs on daemon startup before serving requests