# SQLite Generic Resource Storage

Generic resource storage layer using SQLite with JSON documents.

Implements the **"Single Bucket" pattern** from [ADR-007](../../../docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md) to avoid migration hell.

## Why This Exists

Stigmer has 50+ different API Resource Kinds (Agents, Workflows, Skills, etc.).

**Problem**: Traditional SQLite would require 50+ `CREATE TABLE` statements and migration scripts for each new resource kind.

**Solution**: One `resources` table with a `kind` discriminator simulates MongoDB collections.

## Architecture

### Single Table Schema

```sql
CREATE TABLE IF NOT EXISTS resources (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,           -- "Agent", "Workflow", "Skill"
    org_id TEXT DEFAULT '',       -- For cloud parity
    project_id TEXT DEFAULT '',
    data JSON NOT NULL,           -- Full proto serialized to JSON
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_resource_kind ON resources(kind);
CREATE INDEX idx_resource_org ON resources(org_id);
```

### How It Works

Instead of:
```go
InsertAgent(agent)
InsertWorkflow(workflow)
InsertSkill(skill)
```

We have:
```go
SaveResource("Agent", id, agent)
SaveResource("Workflow", id, workflow)
SaveResource("Skill", id, skill)
```

The `kind` field acts as a collection discriminator, simulating MongoDB's collection-based storage.

## Usage

### Create Store

```go
import "github.com/stigmer/stigmer/backend/libs/go/sqlite"

store, err := sqlite.NewStore("/path/to/stigmer.db")
if err != nil {
    log.Fatal(err)
}
defer store.Close()
```

### Save Resource (Upsert)

```go
agent := &agentv1.Agent{
    ApiResourceMetadata: &apiresource.ApiResourceMetadata{
        Id:   "agent-123",
        Name: "My Agent",
        OrgId: "org-456",
    },
    Spec: &agentv1.AgentSpec{
        Description: "A helpful agent",
        Model:       "gpt-4",
    },
}

err = store.SaveResource(ctx, "Agent", agent.ApiResourceMetadata.Id, agent)
```

**Note**: `SaveResource` performs an upsert (INSERT ... ON CONFLICT ... UPDATE). Calling it multiple times with the same ID updates the existing record.

### Get Resource

```go
agent := &agentv1.Agent{}
err = store.GetResource(ctx, "agent-123", agent)
if err != nil {
    log.Printf("Agent not found: %v", err)
}
```

### List Resources

```go
// List all agents
resources, err := store.ListResources(ctx, "Agent")

// Unmarshal results
for _, data := range resources {
    agent := &agentv1.Agent{}
    protojson.Unmarshal(data, agent)
    fmt.Println(agent.ApiResourceMetadata.Name)
}
```

### List Resources by Organization

```go
resources, err := store.ListResourcesByOrg(ctx, "Agent", "org-456")
```

### Delete Resource

```go
err = store.DeleteResource(ctx, "agent-123")
```

### Delete All Resources of a Kind

```go
count, err := store.DeleteResourcesByKind(ctx, "Agent")
fmt.Printf("Deleted %d agents\n", count)
```

## Testing

```bash
cd backend/libs/go/sqlite
go test -v
```

## Benefits

**Zero Schema Migrations**: Add 100 new Resource Kinds to the Stigmer Protocol, and the existing code will support storing them immediately without update.

**Code Simplicity**: One `Save` function replaces 50+ typed Insert functions. ~90% less persistence layer code.

**Cloud Parity**: Behavior closely mirrors MongoDB's document model, reducing the mental gap between Local and Cloud storage logic.

## Trade-offs

**Loss of Type Safety**: The database cannot enforce that an `Agent` row actually contains Agent data. The application layer (Protobuf) is responsible for validation.

**Query Performance**: Querying specific fields *inside* the JSON blob (e.g., `data->'spec'->'model'`) is slower than querying a dedicated column.

**Mitigation**: Local datasets are small (<10k items), so SQLite's JSON extraction remains sub-millisecond, which is acceptable.

## Implementation Details

### Field Extraction

The library automatically extracts `org_id` and `project_id` from proto messages using reflection:

```go
func extractFieldString(msg proto.Message, parentField, fieldName string) string
```

This preserves data fidelity when syncing with Stigmer Cloud.

### Database Pragmas

The store enables:
- `PRAGMA foreign_keys = ON` - Enforce referential integrity
- `PRAGMA journal_mode = WAL` - Write-Ahead Logging for better concurrency

### Error Handling

All functions return descriptive errors:
- `resource not found` - GetResource or DeleteResource on non-existent ID
- `failed to marshal proto to JSON` - Invalid proto message
- `failed to query resources` - Database errors

## Related Documentation

- [ADR-007: Generic Resource Storage Strategy](../../../docs/adr/2026-01/2026-01-19-170000-sqllite-with-json-data.md)
- [Backend Architecture](../../README.md)
- [Stigmer Architecture](../../../docs/architecture/backend-abstraction.md)

---

**Last Updated**: January 19, 2026  
**Maintained By**: Stigmer Engineering Team
