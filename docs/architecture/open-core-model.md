# Open Core Architecture

Stigmer uses an **Open Core** business model, where the execution plane is open source and the control plane is proprietary.

## Component Classification

### Open Source (Apache 2.0)

Located in `github.com/stigmer/stigmer`:

**Execution Components**:
- **CLI** (`cmd/stigmer/`) - Command-line interface for all operations
- **Workflow Runner** (`runners/workflow/`) - Executes workflow definitions
- **Agent Runner** (`runners/agent/`) - Executes agent instances
- **SDKs** (`sdk/go/`, `sdk/python/`) - Libraries for building workflows

**Backend Implementations**:
- **Local Backend** (`internal/backend/local/`) - SQLite-based storage
- **Cloud Client** (`internal/backend/cloud/`) - gRPC client for Stigmer Cloud
- **Backend Interface** (`proto/stigmer/backend/v1/`) - Protobuf contract

### Proprietary (Stigmer Cloud)

Located in `github.com/leftbin/stigmer` (private):

**Control Plane**:
- **API Service** - Multi-tenant backend service
- **Web Console** - Browser-based UI
- **Auth Service** - User authentication and IAM
- **Orchestration** - Workflow scheduling and distribution

## Why This Split?

**Open Source Benefits**:
- Developers can run Stigmer with zero infrastructure
- Full transparency in execution logic
- Community contributions to core functionality
- No vendor lock-in for execution

**Commercial Benefits**:
- Enterprise teams get collaboration features
- SaaS revenue supports development
- Advanced features remain competitive advantage
- Hosted service reduces operational burden

## Backend Abstraction Layer

The key to this architecture is the **Backend Interface** defined in Protocol Buffers:

```protobuf
service BackendService {
  rpc CreateExecution(...) returns (Execution);
  rpc GetExecutionContext(...) returns (ExecutionContext);
  // ... more operations
}
```

Both backends implement this interface:

**Local Backend**: Stores data in SQLite (`~/.stigmer/local.db`)  
**Cloud Backend**: Proxies calls to Stigmer Cloud via gRPC

This guarantees:
- ✅ Feature parity between local and cloud
- ✅ Zero code changes when switching backends
- ✅ Predictable behavior everywhere

## Feature Parity Matrix

| Feature | Local Backend | Cloud Backend |
|---------|---------------|---------------|
| Agent execution | ✅ | ✅ |
| Workflow execution | ✅ | ✅ |
| Secret storage | ✅ Encrypted | ✅ Vault |
| Execution history | ✅ SQLite | ✅ Postgres |
| MCP server integration | ✅ | ✅ |
| CLI access | ✅ | ✅ |
| Web console | ❌ | ✅ Cloud only |
| Multi-user collaboration | ❌ | ✅ Cloud only |
| IAM policies | ❌ | ✅ Cloud only |
| Distributed execution | ❌ | ✅ Cloud only |
| Enterprise support | ❌ | ✅ Cloud only |

## Migration Path

Users can start with local mode and upgrade to cloud mode seamlessly:

1. **Develop locally**:
   ```bash
   stigmer init
   stigmer agent create my-agent --instructions "..."
   stigmer agent execute my-agent "hello"
   ```

2. **Export resources**:
   ```bash
   stigmer export --all > stigmer-resources.yaml
   ```

3. **Switch to cloud**:
   ```bash
   stigmer login
   stigmer import < stigmer-resources.yaml
   ```

4. **Continue working** - Same CLI, same commands, now backed by cloud

## Security Model

### Local Mode

- **Authentication**: None (trust the local user)
- **Secrets**: Encrypted with OS keychain or local master key
- **Access control**: None needed (single user)
- **Audit**: Basic timestamps in SQLite

### Cloud Mode

- **Authentication**: OAuth 2.0 / API keys
- **Secrets**: HashiCorp Vault
- **Access control**: IAM policies per resource
- **Audit**: Complete audit logs with compliance tracking

## Development Workflow

### Contributing to Open Source

1. Fork `github.com/stigmer/stigmer`
2. Make changes to execution components
3. Test against local backend
4. Submit pull request

### Internal Development (Stigmer Team)

1. Core execution changes go to open source repo
2. Cloud-specific features go to private repo
3. Backend interface changes require coordination
4. Both repos stay in sync via shared protobuf definitions

## License Compliance

**Open Source Code** (Apache 2.0):
- Permissive license allows commercial use
- Attribution required
- Patent grant included
- No copyleft requirements

**Proprietary Code**:
- Stigmer Cloud source code remains private
- Only exposed via gRPC API
- Client libraries (SDK) remain open source

## Community Governance

**Open Source Project**:
- Public roadmap and issue tracker
- Community contributions welcome
- Maintainers from Stigmer team + community
- Releases follow semantic versioning

**Commercial Product**:
- Private roadmap for cloud features
- Enterprise customer feedback prioritized
- SLA and support contracts available

---

This architecture balances the needs of individual developers (free, open, local) with enterprise requirements (collaboration, governance, support).
