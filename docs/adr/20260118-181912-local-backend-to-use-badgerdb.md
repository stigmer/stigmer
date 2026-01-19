# ADR 005 (Revised): Local Persistence Strategy (BadgerDB)

**Status**: Accepted
**Date**: January 18, 2026
**Context**:

* We have adopted the **Local Daemon Architecture** (ADR 011), where a single Go process manages all state.
* We no longer require multi-process file locking (since Python connects via gRPC).
* We need to store high-throughput Protobuf messages (Execution state, Logs).
* We want to minimize translation overhead (avoiding `Proto <-> JSON <-> SQL` conversions).

**Decision**:
We will use **BadgerDB** as the embedded Key-Value store for the Local Daemon.

## Implementation Details

### 1. Data Model

We will use a simple **Key-Value** pattern.

* **Key**: `resource_kind / resource_id` (e.g., `agent_execution/12345`)
* **Value**: Raw Protobuf Bytes.

**Secondary Indexing (Simulated):**
To support listing by "Kind" (e.g., "List all Workflows"), we will use **Key Prefixes**.

* BadgerDB allows ultra-fast iteration over keys with a specific prefix.
* To list all Agents: `it.Seek("agent/")`.

### 2. The Store Interface (Go)

Your DAO will look much cleaner than the SQL version.

```go
// pkg/backend/local/store/badger.go

func (s *BadgerStore) Save(ctx context.Context, kind string, id string, msg proto.Message) error {
    // 1. Serialize directly to bytes (Fastest possible method)
    data, _ := proto.Marshal(msg)
    
    // 2. Construct Key: "kind/id"
    key := []byte(fmt.Sprintf("%s/%s", kind, id))
    
    // 3. Write to DB
    return s.db.Update(func(txn *badger.Txn) error {
        return txn.Set(key, data)
    })
}

func (s *BadgerStore) List(ctx context.Context, kind string) ([][]byte, error) {
    var results [][]byte
    prefix := []byte(kind + "/")
    
    s.db.View(func(txn *badger.Txn) error {
        it := txn.NewIterator(badger.DefaultIteratorOptions)
        defer it.Close()
        
        // Fast Prefix Scan
        for it.Seek(prefix); it.ValidForPrefix(prefix); it.Next() {
            item := it.Item()
            item.Value(func(val []byte) error {
                results = append(results, append([]byte{}, val...))
                return nil
            })
        }
        return nil
    })
    return results, nil
}

```

### 3. Comparison to SQLite (Why this wins)

| Feature | SQLite (Previous Decision) | BadgerDB (New Decision) |
| --- | --- | --- |
| **Storage Format** | JSON String (Text) | Protobuf Bytes (Binary) |
| **Overhead** | Parsing JSON on every read | Zero parsing (Raw bytes) |
| **Concurrency** | File Locking (Complex) | Goroutine Safe (Native) |
| **Dependencies** | CGO or ModernC port | Pure Go Stdlib |
| **Queries** | Flexible SQL | Key-Prefix Scan only |

### 4. Consequences

**Positive**

* **Speed**: Write throughput will be 10x-50x higher than SQLite for large Protobuf blobs.
* **Binary Size**: BadgerDB is lightweight and strips out the SQL engine logic you don't need.
* **Type Safety**: We aren't guessing if the JSON is valid. We are storing the exact binary representation of the object.

**Negative**

* **Debuggability**: You cannot open the file with a generic "DB Browser". You must use the `stigmer` CLI to inspect data (e.g., `stigmer get agent <id>`).
* *Mitigation*: The CLI is already the primary interface for users.



---

**Final Verdict:**
Yes. Proceed with **BadgerDB**. It is the "Cloud Native" choice for Go backends and fits your Daemon architecture perfectly.
