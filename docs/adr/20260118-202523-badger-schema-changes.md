I'll remove `orgID` and `projectID`. You are right—keeping the local storage schema strictly focused on what the local environment actually uses (ID, Kind, Data) is cleaner and avoids confusion.

Here is the final **Architecture Decision Record (ADR)**. You can save this as `docs/architecture/013-local-persistence-badgerdb.md` and hand it to Cursor.

---

# ADR 013: Local Persistence with BadgerDB

**Status**: Accepted
**Date**: January 18, 2026
**Context**:

* The Stigmer Local Daemon requires a high-performance, embedded persistence layer.
* We have moved away from SQLite (ADR 006) because the Daemon Architecture (ADR 011) allows a single process to manage all state, removing the need for multi-process file locking.
* We want to store Protobuf messages efficiently without the overhead of converting them to JSON.
* **Constraint**: The local storage schema must remain clean and relevant to the local environment. Fields like `org_id` and `project_id` (used in Cloud multi-tenancy) are irrelevant locally and should be excluded from the persistence layer to prevent confusion.

**Decision**:
We will use **BadgerDB** as the embedded Key-Value store.

* **Storage Format**: We will store raw Protobuf bytes.
* **Schema Pattern**: We will use Key Prefixes (`Kind/ID`) to simulate collections.
* **Data Hygiene**: We will explicitly strip or ignore `org_id` and `project_id` fields. The generic `Resource` struct used for storage will **only** contain the fields necessary for local identification and payload.

## Implementation Details

### 1. The Storage Struct

We define a clean struct for internal handling that excludes cloud-specific tenancy fields.

```go
// pkg/backend/local/store/badger/resource.go

// Resource represents the metadata and payload stored in BadgerDB.
// Note: OrgID and ProjectID are intentionally excluded.
type Resource struct {
    ID        string
    Kind      string
    Data      []byte    // The marshaled Protobuf message
    UpdatedAt time.Time
}

```

### 2. Key Construction Strategy

We use the "Collection Prefix" pattern to organize data.

* **Format**: `<Kind>/<ID>`
* **Example**: `Agent/agent-123`, `Workflow/wf-456`

### 3. The Store Implementation

The `badger.go` implementation provides optimized CRUD operations.

```go
// pkg/backend/local/store/badger/store.go

package badger

import (
    "context"
    "fmt"
    "strings"
    "time"

    "github.com/dgraph-io/badger/v4"
    "google.golang.org/protobuf/proto"
)

type Store struct {
    db *badger.DB
}

func NewStore(dbPath string) (*Store, error) {
    opts := badger.DefaultOptions(dbPath)
    opts.Logger = nil // Disable verbose logging
    
    db, err := badger.Open(opts)
    if err != nil {
        return nil, fmt.Errorf("failed to open badger: %w", err)
    }
    return &Store{db: db}, nil
}

// SaveResource writes the proto message to the DB.
// It relies on the caller to provide the correct Kind and ID.
// It stores the raw proto bytes directly.
func (s *Store) SaveResource(ctx context.Context, kind string, id string, msg proto.Message) error {
    // 1. Marshal the proto payload
    data, err := proto.Marshal(msg)
    if err != nil {
        return fmt.Errorf("marshal error: %w", err)
    }

    // 2. Construct Key: "Kind/ID"
    key := []byte(fmt.Sprintf("%s/%s", kind, id))

    // 3. Write to DB
    return s.db.Update(func(txn *badger.Txn) error {
        return txn.Set(key, data)
    })
}

// GetResource retrieves a generic proto message by Kind and ID.
// The caller MUST provide an initialized proto message pointer (msg) of the correct type.
func (s *Store) GetResource(ctx context.Context, kind string, id string, msg proto.Message) error {
    key := []byte(fmt.Sprintf("%s/%s", kind, id))

    return s.db.View(func(txn *badger.Txn) error {
        item, err := txn.Get(key)
        if err == badger.ErrKeyNotFound {
            return fmt.Errorf("resource not found: %s/%s", kind, id)
        }
        if err != nil {
            return err
        }

        // Zero-copy unmarshal if possible
        return item.Value(func(val []byte) error {
            return proto.Unmarshal(val, msg)
        })
    })
}

// ListResources returns all resources for a specific Kind.
// It uses a Prefix Scan to simulate "GetCollection(Kind)".
func (s *Store) ListResources(ctx context.Context, kind string) ([][]byte, error) {
    prefix := []byte(kind + "/")
    var results [][]byte

    err := s.db.View(func(txn *badger.Txn) error {
        it := txn.NewIterator(badger.DefaultIteratorOptions)
        defer it.Close()

        // Seek to the start of the "Kind" bucket and iterate
        for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
            item := it.Item()
            err := item.Value(func(val []byte) error {
                // Must copy data because 'val' is reused by iterator
                data := make([]byte, len(val))
                copy(data, val)
                results = append(results, data)
                return nil
            })
            if err != nil {
                return err
            }
        }
        return nil
    })

    return results, err
}

// DeleteResource deletes a specific resource.
// Requires 'kind' to construct the key directly (O(1) operation).
func (s *Store) DeleteResource(ctx context.Context, kind string, id string) error {
    key := []byte(fmt.Sprintf("%s/%s", kind, id))
    return s.db.Update(func(txn *badger.Txn) error {
        return txn.Delete(key)
    })
}

// DeleteResourcesByKind wipes all data for a specific resource type.
// Useful for "stigmer local clean --kind=Agent"
func (s *Store) DeleteResourcesByKind(ctx context.Context, kind string) error {
    prefix := []byte(kind + "/")
    
    // 1. Collect keys (Badger doesn't support range delete native in one go without collecting)
    var keys [][]byte
    err := s.db.View(func(txn *badger.Txn) error {
        it := txn.NewIterator(badger.DefaultIteratorOptions)
        defer it.Close()
        for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
            keys = append(keys, it.Item().KeyCopy(nil))
        }
        return nil
    })
    if err != nil {
        return err
    }

    // 2. Batch Delete
    if len(keys) > 0 {
        return s.db.Update(func(txn *badger.Txn) error {
            for _, k := range keys {
                if err := txn.Delete(k); err != nil {
                    return err
                }
            }
            return nil
        })
    }
    return nil
}

func (s *Store) Close() error {
    return s.db.Close()
}

```

## Consequences

### Positive

* **Clean Schema:** We are no longer storing "dead" cloud fields (`org_id`, `project_id`). The local database contains only what is needed for local execution.
* **High Performance:** Protobuf serialization + BadgerDB (LSM Tree) offers extremely high write throughput and low read latency compared to SQL translation.
* **Simplicity:** The "Collection" concept is handled entirely by Key prefixes, matching the mental model of MongoDB collections without the overhead.

### Negative

* **Opaque Storage:** The database file is binary. You cannot inspect it with a text editor. Debugging relies on `stigmer get` CLI commands.
* **Manual Filtering:** If we ever *did* need to filter by `org_id` (e.g., simulating multi-tenancy locally), we would have to deserialize every record to check the field, as we aren't indexing it. (Acceptable for Local Mode).