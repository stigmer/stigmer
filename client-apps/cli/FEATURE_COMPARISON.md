# Feature Comparison: Cloud CLI vs OSS CLI

## Commands Comparison

| Command | Cloud CLI | OSS CLI | Notes |
|---------|-----------|---------|-------|
| **init** | ✅ (Project scaffolding) | ✅ (Backend init) | Different purposes |
| **apply** | ✅ (K8s-style manifest deploy) | ❌ | Cloud-specific, big feature |
| **run** | ✅ (Execute instances) | ❌ | Critical for workflow execution |
| **destroy** | ✅ (Delete resources) | ❌ | Batch delete |
| **auth login/logout** | ✅ | ❌ | Cloud auth only |
| **whoami** | ✅ | ❌ | Show current user |
| **agent create/list/get/delete** | ✅ | ✅ | ✅ We have basic CRUD |
| **agent execute** | ✅ | ❌ | Run agent with input |
| **agent patch** | ✅ | ❌ | Partial update |
| **workflow create/list/get/delete** | ✅ | ✅ | ✅ We have basic CRUD |
| **organization** | ✅ | ❌ | Cloud multi-tenancy |
| **apikey** | ✅ | ❌ | Cloud auth tokens |
| **context** | ✅ | ❌ | Org selection |
| **local start/stop/status** | ❌ | ✅ | OSS daemon management |
| **backend set** | ❌ | ✅ | OSS backend switching |

## Internal Packages Comparison

| Package | Cloud CLI | OSS CLI | Purpose |
|---------|-----------|---------|---------|
| **backend** | ✅ (gRPC client) | ✅ (gRPC client) | ✅ Both have |
| **config** | ✅ (~/.stigmer/config.yaml) | ✅ (~/.stigmer/config.yaml) | ✅ Both have |
| **clierr** | ✅ | ✅ | ✅ Both have |
| **cliprint** | ✅ (with progress bar) | ✅ (basic) | OSS simpler |
| **auth/login** | ✅ (OAuth flow) | ❌ | Cloud only |
| **context** | ✅ (org management) | ❌ | Cloud multi-tenant |
| **deploy/** | ✅ (dependency graph, analyzer) | ❌ | For `apply` command |
| **manifest/** | ✅ (YAML parsing, applier) | ❌ | For `apply` command |
| **instance/** | ✅ (instance manifests) | ❌ | For `run` command |
| **converter** | ✅ (proto↔YAML) | ❌ | For manifest support |
| **agent/execute** | ✅ | ❌ | For `agent execute` |
| **daemon** | ❌ | ✅ | OSS local daemon |
| **flag** | ✅ (flag constants) | ❌ | Nice-to-have |

## Critical Missing Features

### 🔴 High Priority (Core UX)

**1. `stigmer run` Command**
- **Purpose**: Execute workflow/agent instances
- **Cloud Implementation**: `cmd/stigmer/root/run.go` (~200 lines)
- **Why Critical**: Users need to actually RUN workflows!
- **Complexity**: Medium (needs instance creation, execution tracking)

**2. `stigmer agent execute` Command**
- **Purpose**: Run an agent with input
- **Cloud Implementation**: `internal/cli/agent/execute.go`
- **Why Critical**: Execute agents interactively
- **Complexity**: Medium (needs execution, streaming output)

**3. Manifest Support (`apply`)**
- **Purpose**: K8s-style `stigmer apply -f agent.yaml`
- **Cloud Implementation**: 
  - `cmd/stigmer/root/apply.go`
  - `internal/cli/manifest/` (YAML parsing)
  - `internal/cli/deploy/` (dependency graph)
- **Why Critical**: Workflow-as-code pattern (like Terraform/K8s)
- **Complexity**: High (~800 lines total)

### 🟡 Medium Priority (Nice to Have)

**4. `stigmer whoami`**
- **Purpose**: Show current user/backend info
- **Cloud Implementation**: `cmd/stigmer/root/whoami.go`
- **Why Useful**: Confirm you're in local vs cloud mode
- **Complexity**: Low (~50 lines)

**5. Progress Display**
- **Purpose**: Spinner/progress bar for long operations
- **Cloud Implementation**: `internal/cli/cliprint/progress.go`
- **Why Useful**: Better UX during daemon startup, deployments
- **Complexity**: Low (~100 lines)

**6. Flag Constants**
- **Purpose**: Centralized flag name constants
- **Cloud Implementation**: `internal/cli/flag/flag.go`
- **Why Useful**: Avoid typos, consistency
- **Complexity**: Trivial (~30 lines)

### 🟢 Low Priority (Cloud-Specific, Can Skip)

**7. Auth Commands** (`auth login/logout`)
- Cloud OAuth flow - not needed for local mode
- Can add later when cloud backend is ready

**8. Organization/API Key Management**
- Multi-tenancy features - OSS is single-user local
- Not applicable to local mode

**9. Context Management**
- Org selection - OSS doesn't have orgs
- Can skip for local mode

## What Should We Add?

### Recommended: Essential Execution Features

**Priority 1: `stigmer run` (Execute Workflows)**
```bash
stigmer run <workflow-name> [--input key=value]
stigmer run <workflow-name> -f input.yaml
```

**Why**: This is THE core feature - executing workflows! Without this, CLI is just CRUD.

**Implementation**:
1. Create `cmd/stigmer/root/run.go`
2. Load workflow by name
3. Create or use default workflow instance
4. Create workflow execution
5. Stream status updates (using ADR 011 streaming!)
6. Show final output

**Complexity**: Medium (~200-300 lines)

**Priority 2: `stigmer agent execute` (Interactive Agent)**
```bash
stigmer agent execute <agent-name> "What's the weather?"
stigmer agent execute <agent-name> --interactive  # Chat mode
```

**Why**: Run agents interactively for testing/debugging.

**Implementation**:
1. Create `internal/cli/agent/execute.go`
2. Load agent by name
3. Create agent execution
4. Stream responses
5. Interactive mode with readline

**Complexity**: Medium (~150-200 lines)

**Priority 3: Manifest Support (`apply`)**
```bash
stigmer apply -f agent.yaml
stigmer apply -f workflow.yaml
stigmer apply  # Apply all *.yaml in current dir
```

**Why**: Workflow-as-code! Define resources in YAML, version control them.

**Example YAML**:
```yaml
# agent.yaml
apiVersion: ai.stigmer/v1
kind: Agent
metadata:
  name: support-bot
spec:
  instructions: "You are a helpful support agent"
  mcpServers:
    - github
```

**Implementation**:
1. Copy `internal/cli/manifest/` from Cloud
2. Copy `internal/cli/converter/` for proto↔YAML
3. Create `cmd/stigmer/root/apply.go`
4. Parse YAML → Proto → Backend

**Complexity**: High (~800 lines total, but can copy from Cloud)

## Recommendation

### Minimal Viable CLI (For Initial Release)

**Keep current + add**:
1. ✅ Current CRUD commands (agent, workflow)
2. ✅ Current daemon management (local start/stop)
3. ✅ Current backend switching
4. ➕ `stigmer run` - Execute workflows
5. ➕ `stigmer whoami` - Show backend status

**Later (After Initial Testing)**:
6. `stigmer agent execute` - Interactive agents
7. `stigmer apply` - Manifest deployment
8. Progress bars and better UX

### Suggested Action Plan

**Option A: Ship What We Have Now**
- Current CLI is functional for basic CRUD
- Users can create agents/workflows
- Add execution features in next iteration
- **Pro**: Get something out fast
- **Con**: Can't actually RUN anything yet

**Option B: Add Execution Before Shipping** (Recommended)
- Add `stigmer run` command (~200 lines)
- Add `stigmer whoami` command (~50 lines)
- **Pro**: Actually useful - can execute workflows!
- **Con**: ~1-2 more hours of work

**Option C: Full Feature Parity with Cloud**
- Port all Cloud CLI features
- Add `apply`, `run`, `execute`, etc.
- **Pro**: Feature-complete
- **Con**: ~4-6 hours more work, some features not needed for local mode

## My Recommendation

**Go with Option B**: Add `stigmer run` and `stigmer whoami`, then ship.

**Rationale**:
- Without `run`, CLI is just CRUD - not very useful
- `run` is the killer feature - executing workflows is why people use Stigmer
- `whoami` helps confirm which backend you're using
- Can port other features incrementally based on user feedback

**Implementation Time**: ~2 hours
**Value Add**: Massive (goes from "meh" to "wow!")

Want me to implement `stigmer run` and `stigmer whoami` now?
