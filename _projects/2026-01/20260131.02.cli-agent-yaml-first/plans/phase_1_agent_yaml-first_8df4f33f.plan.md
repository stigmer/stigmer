---
name: Phase 1 Agent YAML-First
overview: Implement Phase 1 (Agent YAML-First Foundation) in 7 focused sub-tasks, each 45-90 minutes. The implementation mirrors the existing MCP Server pattern, leverages the existing qualified slug parser in `pkg/reference/`, and follows the strict CLI coding guidelines.
todos:
  - id: st1-loader
    content: "Sub-task 1: Create agent YAML loader (loader.go, loader_test.go, BUILD.bazel)"
    status: completed
  - id: st2-validator
    content: "Sub-task 2: Create agent validator (validator.go, validator_test.go)"
    status: completed
  - id: st3-applier
    content: "Sub-task 3: Create agent applier and display (applier.go, display.go)"
    status: completed
  - id: st4-apply-cmd
    content: "Sub-task 4: Create agent command group with apply subcommand (agent.go)"
    status: completed
  - id: st5-validate-get
    content: "Sub-task 5: Add validate and get subcommands"
    status: pending
  - id: st6-list-delete
    content: "Sub-task 6: Add list and delete subcommands"
    status: pending
  - id: st7-run
    content: "Sub-task 7: Add run subcommand and deprecate root run"
    status: pending
isProject: false
---

# Phase 1: Agent YAML-First Foundation

## Key Discovery: Qualified Slug Parser Already Exists

The `pkg/reference/reference.go` already provides complete qualified slug parsing via `Parse(ref, contextOrg)`. This handles:

- `org/slug` format (explicit organization)
- `slug` format (defaults to context organization)
- Resource ID detection (`agt_`, `mcp-`, UUID)

**No new slug resolver needed.** We'll use the existing `reference.Parse()` directly.

---

## Architecture Overview

```
cmd/stigmer/root/
└── agent.go                    # Cobra commands (thin orchestration)

internal/cli/agent/
├── loader.go                   # YAML loading + file resolution
├── validator.go                # Schema + reference validation
├── applier.go                  # gRPC apply flow
└── display.go                  # Output formatting

pkg/reference/reference.go      # Existing - qualified slug parsing
```

---

## Sub-Tasks (7 total, 45-90 min each)

### Sub-task 1: Agent YAML Loader (60-75 min)

**Goal**: Load and parse agent.yaml files into proto messages.

**Files to create**:

- [internal/cli/agent/loader.go](client-apps/cli/internal/cli/agent/loader.go) (~120 lines)
- [internal/cli/agent/loader_test.go](client-apps/cli/internal/cli/agent/loader_test.go) (~200 lines)
- [internal/cli/agent/BUILD.bazel](client-apps/cli/internal/cli/agent/BUILD.bazel)

**Implementation**:

- Mirror pattern from [mcpserver/loader.go](client-apps/cli/internal/cli/mcpserver/loader.go)
- `LoadOptions` struct with `FilePath` field
- `LoadResult` struct with `Agent` proto and `SourcePath`
- `Load()` function: file resolution → read → parse → return
- `resolveFilePath()`: explicit path or auto-detect `agent.yaml`/`AGENT.yaml`
- `parseContent()`: YAML → JSON → `protojson.Unmarshal` → `*agentv1.Agent`

**Tests** (comprehensive):

- File resolution (explicit path, auto-detect, not found)
- YAML parsing (valid, invalid syntax)
- JSON parsing (valid, invalid)
- Proto unmarshaling (valid, missing fields)

**Key imports**:

```go
agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
```

---

### Sub-task 2: Agent Schema Validator (45-60 min)

**Goal**: Validate agent structure and references at load time.

**Files to create/modify**:

- [internal/cli/agent/validator.go](client-apps/cli/internal/cli/agent/validator.go) (~100 lines)
- [internal/cli/agent/validator_test.go](client-apps/cli/internal/cli/agent/validator_test.go) (~150 lines)

**Implementation**:

- `ValidateAgent(agent *agentv1.Agent) error`
- Schema validation:
  - `apiVersion` == `"agentic.stigmer.ai/v1"`
  - `kind` == `"Agent"`
  - `metadata.name` present
  - `spec.instructions` present and >= 10 chars
- Reference validation (uses `reference.Parse()`):
  - Each `skill_refs[].slug` is valid qualified slug format
  - Each `mcp_server_usages[].mcp_server_ref.slug` is valid format
- Domain-specific error messages (per Error Taxonomy in plan)

**Tests**:

- Valid agent passes validation
- Missing apiVersion, kind, name, instructions
- Invalid reference format
- Empty skills list (valid)
- Invalid skill reference

---

### Sub-task 3: Agent Applier (60-75 min)

**Goal**: Apply agent configuration to backend via gRPC.

**Files to create**:

- [internal/cli/agent/applier.go](client-apps/cli/internal/cli/agent/applier.go) (~100 lines)
- [internal/cli/agent/display.go](client-apps/cli/internal/cli/agent/display.go) (~80 lines)

**Implementation** (mirror [mcpserver/applier.go](client-apps/cli/internal/cli/mcpserver/applier.go)):

- `ApplyOptions` struct: Agent, OrgID, Conn, Quiet, DryRun
- `ApplyResult` struct: Agent, Created
- `Apply()` function:
  - Set `metadata.org` if not set
  - Call `AgentCommandControllerClient.Apply()`
  - Return result with created flag

**Display functions**:

- `DisplayApplyResult(result *ApplyResult)` - success message, next steps
- `DisplayAgentPreview(agent)` - dry-run preview

**Key gRPC clients**:

```go
agentv1.NewAgentCommandControllerClient(conn)
agentv1.NewAgentQueryControllerClient(conn)
```

---

### Sub-task 4: Agent Apply Command (45-60 min)

**Goal**: Wire up `stigmer agent apply <file>` command.

**Files to create**:

- [cmd/stigmer/root/agent.go](client-apps/cli/cmd/stigmer/root/agent.go) (~200 lines initially)

**Implementation**:

- `NewAgentCommand()` - command group with aliases `["agt"]`
- `newAgentApplyCommand()` - apply subcommand
- `executeAgentApply()` - orchestration function:
  1. Load configuration (agent.Load())
  2. Validate (agent.ValidateAgent())
  3. If dry-run, preview and return
  4. Load backend config
  5. Resolve organization
  6. Ensure daemon (local mode)
  7. Connect to backend
  8. Apply (agent.Apply())
  9. Display result

**Flags**:

- `--org` - organization override
- `--dry-run` - validate without applying

**Register command** in [root.go](client-apps/cli/cmd/stigmer/root/root.go):

```go
rootCmd.AddCommand(NewAgentCommand())
```

---

### Sub-task 5: Agent Validate + Get Commands (60-75 min)

**Goal**: Add validate and get subcommands.

**Files to modify**:

- [cmd/stigmer/root/agent.go](client-apps/cli/cmd/stigmer/root/agent.go)

**Validate command**:

- `stigmer agent validate <file>`
- Load + Validate without connecting to backend
- Output: "Valid" or list of errors
- Useful for CI/CD pipelines

**Get command** (mirror [mcpserver get](client-apps/cli/cmd/stigmer/root/mcpserver.go:276-396)):

- `stigmer agent get <qualified-slug>`
- Parse reference using `reference.Parse()`
- Get by ID or by org/slug reference
- Output formats: table (default), yaml, json

**Flags**:

- `--output, -o` - output format
- `--org` - organization override (for slug resolution)

---

### Sub-task 6: Agent List + Delete Commands (45-60 min)

**Goal**: Complete CRUD with list and delete.

**Files to modify**:

- [cmd/stigmer/root/agent.go](client-apps/cli/cmd/stigmer/root/agent.go)

**List command**:

- `stigmer agent list`
- If List RPC not available, placeholder with helpful message
- Eventually: pagination, filters

**Delete command** (mirror [mcpserver delete](client-apps/cli/cmd/stigmer/root/mcpserver.go:488-630)):

- `stigmer agent delete <qualified-slug>`
- Parse reference, fetch to confirm existence
- Confirmation prompt (unless `--force`)
- Delete via `AgentCommandControllerClient.Delete()`

**Flags**:

- `--force, -f` - skip confirmation

---

### Sub-task 7: Agent Run Command (75-90 min)

**Goal**: Execute agents via `stigmer agent run`.

**Files to modify**:

- [cmd/stigmer/root/agent.go](client-apps/cli/cmd/stigmer/root/agent.go)

**Run command**:

- `stigmer agent run <qualified-slug>`
- Parse qualified slug
- Support flags:
  - `--message, -m` - initial message
  - `--env` - environment variables (repeatable)
- Integrate with existing execution infrastructure

---

## Files Summary


| File                                   | Lines (est) | Purpose                       |
| -------------------------------------- | ----------- | ----------------------------- |
| `internal/cli/agent/loader.go`         | 120         | YAML loading                  |
| `internal/cli/agent/loader_test.go`    | 200         | Loader tests                  |
| `internal/cli/agent/validator.go`      | 100         | Schema + reference validation |
| `internal/cli/agent/validator_test.go` | 150         | Validator tests               |
| `internal/cli/agent/applier.go`        | 100         | gRPC apply flow               |
| `internal/cli/agent/display.go`        | 80          | Output formatting             |
| `internal/cli/agent/BUILD.bazel`       | 40          | Bazel build                   |
| `cmd/stigmer/root/agent.go`            | 500-600     | All commands                  |


---

## Testing Strategy

Each sub-task includes tests:

1. **Unit tests** for loader, validator, applier
2. **Table-driven tests** with subtests
3. **Temporary files** for file-based tests
4. **Comprehensive edge cases** (empty, invalid, partial)

---

## Coding Guidelines Compliance

Per [coding-guidelines.mdc](client-apps/cli/.cursor/rules/coding-guidelines.mdc):

- Files under 250 lines (split if needed)
- Functions under 50 lines
- Errors wrapped with specific context
- Command handlers are thin orchestration
- Business logic in `internal/cli/agent/`

---

## Execution Order

1. **Sub-task 1**: Loader (foundation)
2. **Sub-task 2**: Validator (depends on loader)
3. **Sub-task 3**: Applier (depends on loader)
4. **Sub-task 4**: Apply command (wires 1-3)
5. **Sub-task 5**: Validate + Get commands
6. **Sub-task 6**: List + Delete commands
7. **Sub-task 7**: Run command

Each sub-task is independently testable and can be reviewed before proceeding.