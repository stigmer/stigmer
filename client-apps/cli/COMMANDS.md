# Stigmer CLI Commands

## Command Structure

Stigmer CLI follows a **verb-first** command pattern for resource operations:

```bash
stigmer <verb> <type> [args] [flags]
```

- **Verb**: The operation to perform (`apply`, `get`, `run`, etc.)
- **Type**: The resource type with flexible aliases (`agent`, `agents`, `agt`)
- **Args**: Resource reference (ID, slug, or org/slug)
- **Flags**: Command-specific options

## Resource Types

Use `stigmer resources` to see all available types and their supported verbs:

```bash
stigmer resources                    # Show all resource types
stigmer resources --verb run         # Show types that support 'run'
stigmer resources --output yaml      # Output as YAML
```

| Type | Aliases | Supported Verbs |
|------|---------|-----------------|
| Agent | `agent`, `agents`, `agt` | apply, validate, get, list, delete, run, search |
| Workflow | `workflow`, `workflows`, `wfl`, `wf` | apply, validate, get, list, delete, run, search |
| Skill | `skill`, `skills`, `skl` | get, list, delete, push |
| McpServer | `mcpserver`, `mcp-server`, `mcp` | apply, validate, get, list, delete |
| Project | `project`, `projects`, `prj` | apply, validate, get, list, delete |

## Unified Verb Commands

### apply - Deploy Resources

Deploy resources from YAML files or project configuration.

```bash
# File mode - apply from YAML file
stigmer apply -f agent.yaml
stigmer apply -f workflow.yaml
stigmer apply -f ./manifests/              # Apply all YAML files in directory

# File mode with dry-run
stigmer apply -f agent.yaml --dry-run

# Project mode - deploy from stigmer.yaml project
stigmer apply                              # Detect and deploy from current directory
stigmer apply --config /path/to/project/   # Specify project directory
stigmer apply --prune=false                # Don't delete orphaned resources
```

**Flags:**
- `-f, --file`: Path to YAML file or directory (file mode)
- `--config`: Path to project directory (project mode)
- `--dry-run`: Validate without applying
- `--org`: Organization ID override
- `--prune`: Delete orphaned resources (default: true, project mode only)

### validate - Validate Resources

Validate resource files without applying them.

```bash
stigmer validate -f agent.yaml
stigmer validate -f workflow.yaml
stigmer validate -f ./manifests/           # Validate all YAML files
```

**Flags:**
- `-f, --file`: Path to YAML file or directory (required)

### get - Get Resource Details

Retrieve a single resource by type and reference.

```bash
# Get by slug
stigmer get agent my-agent
stigmer get workflow my-workflow

# Get by resource ID
stigmer get agent agt_abc123
stigmer get workflow wfl_xyz789

# Get with org/slug format
stigmer get agent acme-corp/my-agent

# Output as YAML or JSON
stigmer get agent my-agent --output yaml
stigmer get workflow my-wf --output json
```

**Flags:**
- `-o, --output`: Output format: `table` (default), `yaml`, `json`
- `--org`: Organization ID override

### list - List Resources

List all resources of a type.

```bash
stigmer list agents
stigmer list workflows
stigmer list skills
stigmer list mcpservers
stigmer list projects

# Output as YAML or JSON
stigmer list agents --output yaml
stigmer list workflows --output json

# Limit results
stigmer list agents --limit 100
```

**Flags:**
- `-o, --output`: Output format: `table` (default), `yaml`, `json`
- `--org`: Organization ID override
- `--limit`: Maximum number of results (default: 50)

### delete - Delete Resources

Delete a resource by type and reference.

```bash
# Delete by slug (prompts for confirmation)
stigmer delete agent my-agent
stigmer delete workflow my-workflow

# Delete by resource ID
stigmer delete agent agt_abc123

# Skip confirmation prompt
stigmer delete agent my-agent --force
```

**Flags:**
- `-f, --force`: Skip confirmation prompt
- `--org`: Organization ID override

### run - Execute Agents and Workflows

Execute an agent or workflow. The `run` command supports three forms:

```bash
# Browse agents interactively (no arguments)
stigmer run

# Smart resolution — resolves as agent by default, falls back to interactive search
stigmer run my-agent
stigmer run acme-corp/code-reviewer
stigmer run agt_01kewqjbtdy0w4d14bnhhy4yc2

# Explicit type + reference (backward-compatible)
stigmer run agent my-agent
stigmer run workflow my-workflow

# Run with initial message
stigmer run my-agent -m "Review this code"
stigmer run workflow my-wf --message "Deploy to production"

# Run with environment variables
stigmer run my-agent --env API_URL=https://api.example.com
stigmer run my-agent --env DEBUG=true --env TIMEOUT=30

# Run with secrets (encrypted)
stigmer run my-agent --secret API_KEY=sk_live_xxx

# Run with environment and secret files
stigmer run my-agent --env-file .env --secret-file .env.secrets

# Combine env files and inline overrides
stigmer run my-agent --env-file .env --secret-file .env.secrets --env DEBUG=true
```

**Flags:**
- `-m, --message`: Initial message/prompt for execution
- `--env`: Runtime environment variable (KEY=VALUE, repeatable)
- `--secret`: Secret environment variable (KEY=VALUE, repeatable, encrypted)
- `--env-file`: Load environment from file (repeatable)
- `--secret-file`: Load secrets from file (repeatable, all values encrypted)
- `--detach`: Start execution and return immediately without streaming
- `--download DIR`: Download artifacts to directory when complete
- `-w, --workspace`: Workspace source (URL or path, repeatable)
- `--org`: Organization ID override

**Environment Variable Precedence** (highest to lowest):
1. `--env` and `--secret` flags (inline values)
2. Later `--env-file` and `--secret-file` flags
3. Earlier `--env-file` and `--secret-file` flags

### resume - Resume an Existing Session

Re-open a session to continue a conversation or re-attach to a running execution.

```bash
# Browse recent sessions interactively
stigmer resume

# Resume a specific session by ID
stigmer resume ses-01abc123xyz456789012345678

# Search sessions by subject
stigmer resume "deploy staging"
```

**Flags:**
- `-v, --verbose`: Show all execution events
- `--org`: Organization ID override

### search - Search Resources

Search for resources matching a text query.

```bash
# Search agents
stigmer search agents "code review"
stigmer search agents "kubernetes"

# Search workflows
stigmer search workflows "deploy"
stigmer search workflows "data pipeline"

# Search within specific organization
stigmer search agents "api" --org acme-corp

# Exclude public/platform resources
stigmer search agents "api" --exclude-public

# Output as JSON for scripting
stigmer search workflows "data" --output json

# Paginate results
stigmer search agents "test" --page 2 --page-size 50
```

**Flags:**
- `-o, --output`: Output format: `table` (default), `yaml`, `json`
- `--org`: Search within specific organization
- `--exclude-public`: Exclude public/platform resources
- `--page`: Page number (1-indexed, default: 1)
- `--page-size`: Results per page (max 100, default: 20)

### push - Push Skills to Registry

Push skills to the Stigmer registry.

```bash
# Push skill from current directory
stigmer push skill

# Push skill from specific directory
stigmer push skill ./my-skill/

# Push with specific tag
stigmer push skill --tag v1.0.0

# Push to specific organization
stigmer push skill --org acme-corp

# Dry run (validate without pushing)
stigmer push skill --dry-run

# Push from remote GitHub repository
stigmer push skill --git-url https://github.com/org/repo.git --git-ref v1.0.0

# Push from GitHub repository subdirectory
stigmer push skill \
  --git-url https://github.com/org/repo.git \
  --git-ref main \
  --subdir skills/calculator
```

**Flags:**
- `--tag`: Version tag (default: "latest")
- `--org`: Organization ID override
- `--dry-run`: Validate without pushing
- `--git-url`: Push from remote git repository URL
- `--git-ref`: Git reference (tag, branch, or commit SHA)
- `--subdir`: Subdirectory within git repository
- `--ignore`: Additional patterns to ignore (repeatable)
- `--include`: Patterns to force-include (repeatable)
- `--no-gitignore`: Don't respect .gitignore patterns
- `--verbose`: Show detailed output including ignore decisions

Skills must contain a `SKILL.md` file with YAML frontmatter defining the skill name.

## Server Management

```bash
# Start Stigmer server (auto-initializes on first run)
stigmer server

# Stop server
stigmer server stop

# Check server status
stigmer server status

# View server logs (last 50 lines)
stigmer server logs

# Stream logs in real-time
stigmer server logs --follow

# View agent-runner logs
stigmer server logs --component agent-runner

# View error logs
stigmer server logs --stderr

# Custom number of recent lines
stigmer server logs --tail 100
```

## Backend Configuration

```bash
# Show current backend (local/cloud)
stigmer backend status

# Switch to local backend
stigmer backend set local

# Switch to cloud backend
stigmer backend set cloud
```

## Project Scaffolding

```bash
# Create in current directory (uses directory name as project name)
mkdir my-project && cd my-project
stigmer new

# Create new directory with specified name
stigmer new my-project
cd my-project

# The generated project includes:
# - AI agent (PR code reviewer)
# - Workflow (analyzes GitHub PRs)
# - Zero configuration setup
# - Complete documentation

# After creation:
stigmer apply
stigmer run <agent-name>
```

## Shell Completion

Generate shell completion scripts for auto-complete support.

```bash
# Bash
source <(stigmer completion bash)

# Zsh
source <(stigmer completion zsh)

# Fish
stigmer completion fish | source

# PowerShell
stigmer completion powershell | Out-String | Invoke-Expression
```

For permanent installation, see `stigmer completion --help`.

## Configuration

### `~/.stigmer/config.yaml`

Auto-created on first run:

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

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `STIGMER_DATA_DIR` | Data directory for storage and logs | `~/.stigmer` |

## Quick Start

### Option 1: Start with a New Project (Recommended)

```bash
# 1. Create a new project with example code
mkdir my-first-project && cd my-first-project
stigmer new

# 2. Start the server
stigmer server

# 3. Deploy the project
stigmer apply

# 4. Run an agent or workflow
stigmer run <agent-name>
```

### Option 2: Apply Individual Resources

```bash
# 1. Start the server
stigmer server

# 2. Apply individual resource files
stigmer apply -f agent.yaml
stigmer apply -f workflow.yaml

# 3. Run
stigmer run my-agent
```

## Migration from Old Commands

| Old Command | New Command |
|-------------|-------------|
| `stigmer init` | `stigmer server` (auto-initializes) |
| `stigmer agent apply -f agent.yaml` | `stigmer apply -f agent.yaml` |
| `stigmer workflow apply -f wf.yaml` | `stigmer apply -f wf.yaml` |
| `stigmer agent get <id>` | `stigmer get agent <id>` |
| `stigmer workflow get <id>` | `stigmer get workflow <id>` |
| `stigmer agent list` | `stigmer list agents` |
| `stigmer workflow list` | `stigmer list workflows` |
| `stigmer agent delete <id>` | `stigmer delete agent <id>` |
| `stigmer workflow delete <id>` | `stigmer delete workflow <id>` |
| `stigmer agent run <id>` | `stigmer run <id>` or `stigmer run agent <id>` |
| `stigmer workflow run <id>` | `stigmer run workflow <id>` |
| `stigmer run ses-xxx` | `stigmer resume ses-xxx` |
| `stigmer skill push` | `stigmer push skill` |
| `stigmer agent search "query"` | `stigmer search agents "query"` |
| `stigmer workflow search "query"` | `stigmer search workflows "query"` |

## Development

```bash
# Build CLI
make build

# Install to GOPATH/bin
make install

# Build, install, and verify (recommended)
make release-local

# Run without installing
make run ARGS="server status"

# Run tests
make test
```

## Architecture

The Stigmer CLI manages a complete local daemon that includes:

- **stigmer-server**: gRPC API server (localhost:7234)
- **Temporal**: Workflow orchestration (localhost:7233, auto-downloaded)
- **workflow-runner**: Zigflow workflow execution (Temporal worker)
- **agent-runner**: AI agent execution (Temporal worker)
- **SQLite**: Local embedded storage

Port allocation:
- **7233** - Temporal gRPC
- **7234** - Stigmer Server (Temporal + 1)
- **8233** - Temporal UI

Everything runs locally with zero external dependencies.
