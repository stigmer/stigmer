# ADR 005 (Revised): Local Persistence Strategy (SQLite)

**Status**: Accepted  
**Date**: January 18, 2026 (Updated: February 4, 2026)  
**Context**:

* We have adopted the **Local Daemon Architecture** (ADR 011), where a single Go process manages all state.
* We no longer require multi-process file locking (since Python connects via gRPC).
* We need to store high-throughput Protobuf messages (Execution state, Logs).
* We want developer-friendly tooling and standard SQL for data inspection.

**Decision**:
We will use **SQLite** with the pure Go modernc.org/sqlite driver as the embedded database for the Local Daemon.

## Historical Context

This ADR was originally written for BadgerDB. During implementation, we evaluated both options and chose SQLite for the following reasons:

1. **Universal Tooling**: sqlite3 CLI, DataGrip, DB Browser for SQLite, Beekeeper Studio
2. **Standard SQL**: Developers already know the query language
3. **Inspectable Data**: `sqlite3 ~/.stigmer/stigmer.db` works immediately
4. **Pure Go Driver**: modernc.org/sqlite has no CGO dependencies
5. **ACID Transactions**: Correctness guarantees for agent state
6. **Built-in FTS5**: Full-text search without external dependencies
7. **Single-file Database**: Simple backups and portability
8. **Industry Standard**: Powers Chrome, Firefox, iOS apps - battle-tested reliability

## Implementation Details

### 1. Data Model

We use a **relational schema** with a resources table:

```sql
CREATE TABLE resources (
    kind TEXT NOT NULL,
    id TEXT NOT NULL,
    data BLOB NOT NULL,  -- Protobuf-serialized resource
    PRIMARY KEY (kind, id)
);

CREATE INDEX idx_kind ON resources(kind);
```

**Full-text search** (optional, for advanced querying):
```sql
CREATE VIRTUAL TABLE resources_fts USING fts5(
    kind, id, content
);
```

### 2. The Store Interface (Go)

```go
// pkg/backend/libs/go/store/sqlite/store.go

func (s *Store) SaveResource(ctx context.Context, kind string, id string, msg proto.Message) error {
    // 1. Serialize directly to bytes
    data, err := proto.Marshal(msg)
    if err != nil {
        return fmt.Errorf("failed to marshal proto: %w", err)
    }
    
    // 2. Upsert to SQLite
    query := `INSERT INTO resources (kind, id, data) 
              VALUES (?, ?, ?) 
              ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data`
    
    _, err = s.db.ExecContext(ctx, query, kind, id, data)
    return err
}

func (s *Store) GetResource(ctx context.Context, kind string, id string, msg proto.Message) error {
    query := `SELECT data FROM resources WHERE kind = ? AND id = ?`
    
    var data []byte
    err := s.db.QueryRowContext(ctx, query, kind, id).Scan(&data)
    if err != nil {
        return err
    }
    
    return proto.Unmarshal(data, msg)
}

func (s *Store) ListResources(ctx context.Context, kind string) ([]*apiresource.ApiResource, error) {
    query := `SELECT data FROM resources WHERE kind = ? ORDER BY id`
    
    rows, err := s.db.QueryContext(ctx, query, kind)
    if err != nil {
        return nil, err
    }
    defer rows.Close()
    
    var results []*apiresource.ApiResource
    for rows.Next() {
        var data []byte
        if err := rows.Scan(&data); err != nil {
            return nil, err
        }
        
        resource := &apiresource.ApiResource{}
        if err := proto.Unmarshal(data, resource); err != nil {
            return nil, err
        }
        results = append(results, resource)
    }
    
    return results, rows.Err()
}
```

### 3. Comparison: SQLite vs BadgerDB

| Feature | BadgerDB (Considered) | SQLite (Chosen) |
| --- | --- | --- |
| **Storage Format** | Key-Value (Binary) | Relational (Binary BLOB) |
| **Query Language** | Prefix Scan | Standard SQL |
| **Tooling** | Custom inspection tools | Universal (sqlite3, DataGrip, etc.) |
| **Dependencies** | Pure Go | Pure Go (modernc.org/sqlite) |
| **Full-text Search** | Not built-in | FTS5 included |
| **ACID Transactions** | Yes | Yes |
| **Developer Experience** | Custom tools needed | Immediate inspection with `sqlite3` |
| **Industry Adoption** | Niche (time-series DBs) | Ubiquitous (Chrome, Firefox, iOS) |

### 4. Why SQLite Won

**Developer Experience Excellence**:
- Developers can inspect data instantly: `sqlite3 ~/.stigmer/stigmer.db "SELECT * FROM resources"`
- Standard SQL queries for debugging and data exploration
- Universal tooling already installed on most systems
- No custom inspection tools needed

**Architectural Fit**:
- Single-file database aligns with local-first philosophy
- ACID transactions guarantee correctness
- FTS5 enables advanced search features without additional dependencies
- Relational model supports future schema evolution

**Trust Through Familiarity**:
- Most deployed database engine in the world
- 20+ years of production use
- Powers mission-critical applications (aviation, browsers, mobile)

### 5. Consequences

**Positive**

* ✅ **Universal Tooling**: sqlite3 CLI works immediately, no custom tools needed
* ✅ **Standard SQL**: Developers already know how to query and inspect data
* ✅ **Developer-Friendly**: `sqlite3 ~/.stigmer/stigmer.db` provides instant access
* ✅ **Pure Go**: modernc.org/sqlite has zero CGO dependencies, builds work everywhere
* ✅ **ACID Transactions**: Correctness guarantees for agent state
* ✅ **Built-in FTS5**: Full-text search without external dependencies
* ✅ **Single-File**: Simple backups, version control, portability
* ✅ **Battle-Tested**: Industry-standard reliability (Chrome, Firefox, iOS apps)

**Tradeoffs**

* **Write Performance**: Slightly slower than BadgerDB for high-throughput writes (not a concern for local development)
  - *Mitigation*: Local agent execution is I/O bound on LLM calls, not database writes
* **Relational Overhead**: SQL layer adds complexity vs pure key-value
  - *Mitigation*: Complexity is hidden behind Store interface, benefits outweigh costs

**Negative (Minimal)**

* None significant - SQLite's benefits far outweigh any theoretical performance differences for the local development use case

---

## Migration Note

The actual codebase uses SQLite (`backend/libs/go/store/sqlite/`). This ADR was renamed from `local-backend-to-use-badgerdb.md` to reflect the implemented decision.

**Historical Artifacts**:
- Original ADR considered BadgerDB
- Migration project documented in `_projects/2026-01/20260125.02.badgerdb-to-sqlite-migration/`
- Implementation uses modernc.org/sqlite driver

---

**Final Verdict:**  
SQLite is the correct choice. It provides world-class developer experience, universal tooling, standard SQL, and industry-proven reliability—perfect for Stigmer's local-first philosophy.
