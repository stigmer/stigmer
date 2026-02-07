---
name: T08 Testing and Docs
overview: Add routing/validation tests for unified verb commands, update outdated CLI documentation to reflect verb-first architecture, and implement shell completion for improved UX.
todos:
  - id: routing-tests
    content: Create routing_test.go with type resolution and alias matching tests
    status: completed
  - id: verb-support-tests
    content: Create verb_support_test.go with verb validation and error message tests
    status: completed
  - id: completion-command
    content: Create completion.go with bash/zsh/fish/powershell completion generation
    status: completed
  - id: docs-update
    content: Rewrite COMMANDS.md with verb-first architecture and remove outdated sections
    status: completed
isProject: false
---

# T08: Testing and Documentation

## Current State Assessment

**Testing**: Good unit tests exist for handlers in `internal/cli/`, but zero command-level tests for the new unified verb architecture. The type registry (`internal/cli/types/`) has excellent test coverage.

**Documentation**: [COMMANDS.md](client-apps/cli/COMMANDS.md) is **significantly outdated**:

- Still shows old `stigmer skill push` syntax (should be `stigmer push skill`)
- "Future Commands (Planned)" section lists things that are NOW IMPLEMENTED
- Missing all unified verb commands: `apply`, `validate`, `get`, `list`, `delete`, `run`, `search`, `push`, `resources`

**Shell Completion**: Does not exist. Cobra makes this trivial to add.

---

## Deliverables

### 1. Type Registry Routing Tests

**Location**: `client-apps/cli/cmd/stigmer/root/routing_test.go` (new file)

**What to test**:

- Type resolution from aliases (all variations: `agent`, `agents`, `agt`, `Agent`)
- Verb support validation (e.g., `run` works for `agent` but not `skill`)
- Error messages for unsupported combinations are helpful
- Case-insensitive matching works

**Pattern**: Table-driven tests, no mocks needed, pure logic testing.

```go
// Example structure
func TestTypeResolution(t *testing.T) {
    tests := []struct {
        input    string
        wantType string
        wantErr  bool
    }{
        {"agent", "agent", false},
        {"agents", "agent", false},
        {"agt", "agent", false},
        {"AGENT", "agent", false},
        {"invalid", "", true},
    }
    // ...
}
```

### 2. Verb Support Validation Tests

**Location**: `client-apps/cli/cmd/stigmer/root/verb_support_test.go` (new file)

**What to test**:

- Each verb correctly reports which types it supports
- Unsupported type+verb combinations produce actionable error messages
- The `resources` command correctly reports verb support matrix

**Example test cases**:


| Verb | Type     | Expected                                 |
| ---- | -------- | ---------------------------------------- |
| run  | agent    | supported                                |
| run  | workflow | supported                                |
| run  | skill    | error: "run is not supported for skill"  |
| push | skill    | supported                                |
| push | agent    | error: "push is not supported for agent" |


### 3. Documentation Update (COMMANDS.md)

**Location**: [client-apps/cli/COMMANDS.md](client-apps/cli/COMMANDS.md)

**Required changes**:

1. **Add new "Unified Commands" section** documenting verb-first architecture:
  - `stigmer apply -f <file>` - Apply resources from YAML
  - `stigmer validate -f <file>` - Validate without applying
  - `stigmer get <type> <ref>` - Get resource details
  - `stigmer list <type>` - List resources
  - `stigmer delete <type> <ref>` - Delete resource
  - `stigmer run <type> <ref>` - Run agent/workflow
  - `stigmer search <type> <query>` - Search resources
  - `stigmer push <type> [path]` - Push skill
  - `stigmer resources` - List resource types
2. **Update "Skill Management" section** to use new verb-first syntax:
  - `stigmer push skill` instead of `stigmer skill push`
3. **Remove "Future Commands (Planned)" section** - these are now implemented
4. **Expand "Migration from Old Commands"** table with verb-first migrations:
  - `stigmer agent apply` -> `stigmer apply -f agent.yaml`
  - `stigmer workflow get <id>` -> `stigmer get workflow <id>`
  - etc.

### 4. Shell Completion Command

**Location**: `client-apps/cli/cmd/stigmer/root/completion.go` (new file, ~80 lines)

**Features**:

- `stigmer completion bash` - Generate bash completion
- `stigmer completion zsh` - Generate zsh completion  
- `stigmer completion fish` - Generate fish completion
- `stigmer completion powershell` - Generate PowerShell completion

**Implementation**: Use Cobra's built-in `GenBashCompletion()`, `GenZshCompletion()`, etc.

**Registration**: Add to [root.go](client-apps/cli/cmd/stigmer/root.go)

---

## Quality Gates

Per coding guidelines:

- All new files under 250 lines
- All functions under 50 lines
- All errors wrapped with specific context
- Table-driven tests with clear test case names
- No business logic in command handlers

---

## File Changes Summary


| File                        | Action  | Lines (est.) |
| --------------------------- | ------- | ------------ |
| `root/routing_test.go`      | Create  | ~100         |
| `root/verb_support_test.go` | Create  | ~80          |
| `root/completion.go`        | Create  | ~80          |
| `root/root.go`              | Modify  | +3           |
| `root/BUILD.bazel`          | Modify  | +5           |
| `COMMANDS.md`               | Rewrite | ~250         |


**Total new code**: ~260 lines of tests, ~80 lines of completion command
**Documentation**: Major rewrite of COMMANDS.md

---

## Non-Goals (Explicitly Out of Scope)

- Mock gRPC infrastructure for E2E tests (deferred)
- Automated CLI documentation generation (nice-to-have, not T08)
- Test coverage metrics/CI (infrastructure task)

