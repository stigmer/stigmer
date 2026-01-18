# Stigmer CLI Commands

## Currently Implemented

### Initialization & Daemon Management

```bash
# Initialize local backend and start daemon
stigmer init

# Start local daemon
stigmer local start [--anthropic-api-key=...] [--temporal-host=...]

# Stop local daemon
stigmer local stop

# Check daemon status
stigmer local status

# Restart local daemon
stigmer local restart
```

### Backend Configuration

```bash
# Show current backend (local/cloud)
stigmer backend status

# Switch to local backend
stigmer backend set local

# Switch to cloud backend
stigmer backend set cloud
```

### Agent Management (CLI-based)

```bash
# Create agent via CLI flags
stigmer agent create --name <name> --instructions <instructions>

# List all agents
stigmer agent list

# Get agent details
stigmer agent get <agent-id>

# Delete agent
stigmer agent delete <agent-id>
```

### Workflow Management (CLI-based)

```bash
# Create workflow via CLI flags
stigmer workflow create --name <name> [--description <desc>]

# List all workflows
stigmer workflow list

# Get workflow details
stigmer workflow get <workflow-id>

# Delete workflow
stigmer workflow delete <workflow-id>
```

### Version

```bash
# Show CLI version
stigmer version
```

## Not Yet Implemented (Planned)

### YAML-based Resource Management

```bash
# Apply resources from YAML files
stigmer apply -f <file.yaml>
stigmer apply -f <directory>/

# Delete resources from YAML
stigmer delete -f <file.yaml>
```

### Execution

```bash
# Execute an agent
stigmer agent execute <agent-id|name> <prompt>

# Execute a workflow
stigmer workflow execute <workflow-id|name> --input key=value

# Execute resources in current directory (auto-discovery)
stigmer run
```

### Templates & Scaffolding

```bash
# Initialize a new Stigmer project with templates
stigmer init --template <template-name>

# Create example project structure
stigmer init --example
```

### Resource Export/Import

```bash
# Export all resources to YAML
stigmer export --all > backup.yaml
stigmer export agents > agents.yaml

# Import resources from YAML
stigmer import < backup.yaml
```

## Configuration Files

### `~/.stigmer/config.yaml`

```yaml
backend:
  type: local  # or cloud
  local:
    endpoint: localhost:50051
    data_dir: ~/.stigmer/data
  cloud:
    endpoint: api.stigmer.ai:443
    token: <your-token>
```

### `stigmer.yaml` (Project-level)

Not yet implemented. Future project configuration:

```yaml
apiVersion: agentic.stigmer.ai/v1
kind: Project
metadata:
  name: my-project
spec:
  agents:
    - ./agents/*.yaml
  workflows:
    - ./workflows/*.yaml
  environments:
    - name: dev
      secrets:
        - GITHUB_TOKEN
        - ANTHROPIC_API_KEY
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude models | (required, prompts if missing) |
| `TEMPORAL_HOST` | Temporal server address | `localhost:7233` |
| `TEMPORAL_NAMESPACE` | Temporal namespace | `default` |
| `STIGMER_DATA_DIR` | Data directory for BadgerDB and logs | `~/.stigmer` |

## Command-Line Flags

### `stigmer local start`

| Flag | Environment Variable | Default | Description |
|------|---------------------|---------|-------------|
| `--anthropic-api-key` | `ANTHROPIC_API_KEY` | (prompt) | Anthropic API key |
| `--temporal-host` | `TEMPORAL_HOST` | `localhost:7233` | Temporal server address |
| `--temporal-namespace` | `TEMPORAL_NAMESPACE` | `default` | Temporal namespace |
| `--data-dir` | `STIGMER_DATA_DIR` | `~/.stigmer` | Data directory |

## Examples

### Current Usage (Implemented)

```bash
# 1. Initialize
stigmer init

# 2. Create an agent
stigmer agent create \
  --name github-analyzer \
  --instructions "Analyze GitHub repositories for code quality"

# 3. List agents
stigmer agent list

# 4. Check daemon status
stigmer local status
```

### Future Usage (Planned)

```bash
# 1. Initialize project with template
stigmer init --template hello-world

# 2. Apply resources from YAML
stigmer apply -f ./agents/github-analyzer.yaml

# 3. Execute agent
stigmer agent execute github-analyzer "Analyze myorg/myrepo"

# 4. Run all resources in project
stigmer run
```

## Development

```bash
# Build CLI
make build

# Install to GOPATH/bin
make install

# Build, install, and verify (recommended)
make release-local

# Run without installing
make run ARGS="agent list"

# Run tests
make test
```

## Migration Path

The CLI is being developed with backwards compatibility in mind:

1. **Phase 1 (Current)**: CLI-based resource management
   - Direct commands: `stigmer agent create --name ...`
   - Daemon management
   - Backend switching

2. **Phase 2 (Next)**: YAML-based resource management
   - `stigmer apply -f file.yaml`
   - `stigmer run` (auto-discovery)
   - Template scaffolding

3. **Phase 3 (Future)**: Advanced features
   - Agent/workflow execution
   - Real-time streaming
   - Advanced debugging tools

All Phase 1 commands will continue to work in Phase 2 and 3.
