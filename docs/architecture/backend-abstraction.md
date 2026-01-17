# Backend Abstraction Layer

Stigmer's backend abstraction ensures feature parity between local (SQLite) and cloud (gRPC) modes.

## Design Philosophy

**Core Principle**: The same CLI commands, SDK code, and workflow definitions must work identically in both local and cloud modes.

This is achieved through a strict Protobuf contract that both backends implement.

## Architecture

```
┌─────────────────────────────────────────┐
│   CLI / SDK / Runners                   │
│   (User-facing components)              │
└─────────────┬───────────────────────────┘
              │
              │ Uses Backend Interface
              ▼
┌─────────────────────────────────────────┐
│   Backend Interface (Go)                │
│   Defined in: internal/backend/         │
│   Generated from: proto/stigmer/backend/│
└─────────────┬───────────────────────────┘
              │
       ┌──────┴──────┐
       │             │
       ▼             ▼
┌─────────────┐  ┌─────────────┐
│   Local     │  │   Cloud     │
│   Backend   │  │   Backend   │
│   (SQLite)  │  │   (gRPC)    │
└─────────────┘  └─────────────┘
       │                  │
       ▼                  ▼
   ~/.stigmer/       api.stigmer.io
   local.db
```

## Protobuf Contract

The backend interface is defined in `proto/stigmer/backend/v1/backend.proto`:

```protobuf
service BackendService {
  // Execution lifecycle
  rpc CreateExecution(CreateExecutionRequest) returns (Execution);
  rpc GetExecution(GetExecutionRequest) returns (Execution);
  rpc UpdateExecutionStatus(UpdateExecutionStatusRequest) returns (Execution);
  rpc ListExecutions(ListExecutionsRequest) returns (ListExecutionsResponse);
  rpc CancelExecution(CancelExecutionRequest) returns (Execution);
  
  // Just-In-Time context (secrets)
  rpc GetExecutionContext(GetExecutionContextRequest) returns (ExecutionContext);
  
  // Resource management
  rpc GetAgent(GetResourceRequest) returns (Agent);
  rpc CreateAgent(CreateAgentRequest) returns (Agent);
  rpc UpdateAgent(UpdateAgentRequest) returns (Agent);
  // ... more operations
}
```

### Why Protobuf?

1. **Type Safety**: Compile-time validation of request/response structures
2. **Language Agnostic**: Go and Python SDKs use the same definitions
3. **Versioning**: Protobuf handles backward compatibility
4. **Documentation**: Single source of truth for the API

## Backend Implementations

### Local Backend (`internal/backend/local/`)

**Implementation**: Direct SQLite queries

**Example**:

```go
func (b *Backend) CreateAgent(ctx context.Context, req *pb.CreateAgentRequest) (*pb.Agent, error) {
    id := generateID("agt")
    slug := slugify(req.Name)
    
    // Check uniqueness
    var count int
    err := b.db.QueryRow("SELECT COUNT(*) FROM agents WHERE slug = ?", slug).Scan(&count)
    if err != nil {
        return nil, fmt.Errorf("failed to check slug: %w", err)
    }
    if count > 0 {
        return nil, fmt.Errorf("agent with slug %s already exists", slug)
    }
    
    // Insert agent
    specJSON, _ := json.Marshal(req.Spec)
    _, err = b.db.ExecContext(ctx, `
        INSERT INTO agents (id, name, slug, spec, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, '{}', datetime('now'), datetime('now'))
    `, id, req.Name, slug, specJSON)
    
    if err != nil {
        return nil, fmt.Errorf("failed to create agent: %w", err)
    }
    
    // Return created agent
    return b.GetAgent(ctx, &pb.GetResourceRequest{Id: id})
}
```

### Cloud Backend (`internal/backend/cloud/`)

**Implementation**: gRPC proxy

**Example**:

```go
func (b *Backend) CreateAgent(ctx context.Context, req *pb.CreateAgentRequest) (*pb.Agent, error) {
    // Simply proxy to cloud service
    return b.client.CreateAgent(ctx, req)
}
```

The cloud service handles multi-tenancy, IAM, and distributed storage.

## Backend Factory

The CLI and runners use a factory to create the appropriate backend:

```go
// Load configuration
cfg := loadConfig() // Reads ~/.stigmer/config.yaml

// Create backend
backend, err := backend.NewBackend(cfg)
if err != nil {
    log.Fatalf("Failed to create backend: %v", err)
}
defer backend.Close()

// Use backend (same code for both local and cloud)
agent, err := backend.CreateAgent(ctx, &pb.CreateAgentRequest{
    Name: "support-bot",
    Spec: &pb.AgentSpec{
        Instructions: "You are a helpful assistant",
    },
})
```

## Configuration

Backend selection is determined by `~/.stigmer/config.yaml`:

### Local Mode

```yaml
backend:
  type: local
  local:
    db_path: ~/.stigmer/local.db
```

### Cloud Mode

```yaml
backend:
  type: cloud
  cloud:
    endpoint: api.stigmer.io:443
    token: stg_xxxxxxxxxxxxxxxxxxxxxxxx
    organization: my-org
```

## Switching Backends

```bash
# Check current backend
stigmer backend status

# Switch to cloud
stigmer login

# Switch back to local
stigmer backend switch local
```

The CLI updates the config file. No code changes needed.

## Feature Parity Guarantees

### ✅ Guaranteed Parity

These features work identically in both modes:

- Agent execution
- Workflow execution
- Secret resolution (JIT)
- Execution history
- Resource CRUD operations
- MCP server integration

### ❌ Cloud-Only Features

These features require Stigmer Cloud:

- Web console access
- Multi-user collaboration
- IAM policies
- Distributed execution
- Enterprise support

## Testing Strategy

Both backends pass the same test suite:

```go
func TestBackendCompliance(t *testing.T) {
    backends := []backend.Backend{
        setupLocalBackend(t),
        setupCloudBackend(t),
    }
    
    for _, b := range backends {
        t.Run(fmt.Sprintf("%T", b), func(t *testing.T) {
            // Test CreateAgent
            agent, err := b.CreateAgent(ctx, &pb.CreateAgentRequest{
                Name: "test-agent",
                Spec: &pb.AgentSpec{Instructions: "test"},
            })
            assert.NoError(t, err)
            assert.NotEmpty(t, agent.Id)
            
            // Test GetAgent
            retrieved, err := b.GetAgent(ctx, &pb.GetResourceRequest{Id: agent.Id})
            assert.NoError(t, err)
            assert.Equal(t, agent.Id, retrieved.Id)
            
            // ... more tests
        })
    }
}
```

If a test passes for one backend, it must pass for the other.

## Extension Points

To add a new backend operation:

1. **Update proto** (`proto/stigmer/backend/v1/backend.proto`):
   ```protobuf
   rpc GetAgentMetrics(GetMetricsRequest) returns (Metrics);
   ```

2. **Regenerate code**:
   ```bash
   make proto-gen
   ```

3. **Implement in both backends**:
   - `internal/backend/local/local.go`
   - `internal/backend/cloud/cloud.go`

4. **Update interface** (`internal/backend/backend.go`):
   ```go
   GetAgentMetrics(ctx context.Context, req *pb.GetMetricsRequest) (*pb.Metrics, error)
   ```

5. **Write tests** for both backends

## Secret Management

Both backends implement Just-In-Time (JIT) secret resolution:

### Local Backend

```go
func (b *Backend) GetExecutionContext(ctx context.Context, req *pb.GetExecutionContextRequest) (*pb.ExecutionContext, error) {
    // Fetch execution
    exec, err := b.GetExecution(ctx, &pb.GetExecutionRequest{ExecutionId: req.ExecutionId})
    if err != nil {
        return nil, err
    }
    
    // Load environment
    env, err := b.GetEnvironment(ctx, &pb.GetResourceRequest{Id: exec.EnvironmentId})
    if err != nil {
        return nil, err
    }
    
    // Decrypt secrets using OS keychain
    secrets, err := b.decryptSecrets(env.Secrets)
    if err != nil {
        return nil, err
    }
    
    return &pb.ExecutionContext{
        ExecutionId: req.ExecutionId,
        Secrets:     secrets,
        Variables:   env.Variables,
    }, nil
}
```

### Cloud Backend

```go
func (b *Backend) GetExecutionContext(ctx context.Context, req *pb.GetExecutionContextRequest) (*pb.ExecutionContext, error) {
    // Cloud service handles decryption using Vault
    return b.client.GetExecutionContext(ctx, req)
}
```

Runners never see encrypted secrets—only decrypted values at execution time.

## Error Handling

Both backends return consistent error codes:

```go
// Not found
if err != nil {
    return nil, status.Errorf(codes.NotFound, "agent not found: %s", id)
}

// Already exists
if err != nil {
    return nil, status.Errorf(codes.AlreadyExists, "agent with slug %s exists", slug)
}

// Invalid argument
if req.Name == "" {
    return nil, status.Errorf(codes.InvalidArgument, "name is required")
}
```

This ensures consistent error messages across backends.

## Performance Considerations

### Local Backend

- **Reads**: Fast (SQLite in-process, ~1ms)
- **Writes**: Fast (WAL mode, ~5ms)
- **Concurrency**: Limited (single file, but WAL helps)

### Cloud Backend

- **Reads**: Slower (network + distributed DB, ~50-100ms)
- **Writes**: Slower (network + replication, ~100-200ms)
- **Concurrency**: Unlimited (distributed system)

The abstraction layer doesn't hide these differences—it's expected that cloud is slower but more scalable.

## Migration Between Backends

Export from local:

```bash
stigmer export --all > local-backup.yaml
```

Switch to cloud:

```bash
stigmer login
```

Import to cloud:

```bash
stigmer import < local-backup.yaml
```

The export/import format is the same (YAML with protobuf serialization), ensuring seamless migration.

---

The backend abstraction is the foundation of Stigmer's Open Core model. It allows developers to start local and scale to cloud without rewriting code.
