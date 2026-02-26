---
name: Phase 4 Display Consolidation
overview: Extract duplicated proto YAML/JSON marshaling and format-dispatch logic from 7 resource display.go files into shared utilities in pkg/display/, reducing ~210 lines of boilerplate while keeping per-resource table rendering untouched.
todos:
  - id: create-proto-utils
    content: Create pkg/display/proto.go with RenderProtoYAML, RenderProtoJSON, DisplayProto + tests + BUILD.bazel update
    status: completed
  - id: migrate-skill
    content: Migrate skill/display.go — remove displaySkillYAML/JSON, use DisplayProto
    status: completed
  - id: migrate-mcpserver
    content: Migrate mcpserver/display.go — remove displayAsYAML/JSON, use DisplayProto
    status: completed
  - id: migrate-agent
    content: Migrate agent/display.go — remove displayAgentYAML/JSON, use DisplayProto
    status: completed
  - id: migrate-workflow
    content: Migrate workflow/display.go — remove displayWorkflowYAML/JSON, use DisplayProto
    status: completed
  - id: migrate-project
    content: Migrate project/display.go — remove displayProjectYAML/JSON, use DisplayProto for both DisplayProjectInfo and DisplayGetResult
    status: completed
  - id: migrate-session
    content: Migrate session/display.go — remove 4 YAML/JSON functions, use DisplayProto for both get and list
    status: completed
  - id: migrate-execution
    content: Migrate execution/display.go — remove 4 YAML/JSON functions, use DisplayProto for both get and list
    status: completed
  - id: final-verification
    content: Run go build, go vet across affected packages, verify all existing tests pass
    status: completed
isProject: false
---

# Phase 4: Consolidate Display File Boilerplate

## Problem

All 7 resource `display.go` files contain identical proto-to-YAML and proto-to-JSON marshaling code (~~25 lines per function) and identical format-dispatch switch blocks (~~7 lines each). Across all files, this is ~210 lines of pure duplication. The pattern looks the same everywhere:

```go
// Repeated verbatim in every file — only the variable name and error string change
marshaler := protojson.MarshalOptions{
    Indent:          "  ",
    UseProtoNames:   true,
    EmitUnpopulated: false,
}
jsonBytes, err := marshaler.Marshal(resource)
// ... yaml.Unmarshal, yaml.Marshal, fmt.Print ...
```

## Approach: Two-Layer API in `pkg/display/`

Create a new file `[client-apps/cli/pkg/display/proto.go](client-apps/cli/pkg/display/proto.go)` with three functions:

### Layer 1: Pure utility functions (return errors, take `io.Writer`)

- `**RenderProtoYAML(w io.Writer, msg proto.Message) error**` — protojson marshal, roundtrip through `yaml.Unmarshal`/`yaml.Marshal`, write to `w`. Returns error on any failure.
- `**RenderProtoJSON(w io.Writer, msg proto.Message) error**` — protojson marshal with consistent options, write to `w`. Returns error on any failure.

These are fully testable, reusable, and caller-controlled. They encode the marshaling options (`Indent: "  "`, `UseProtoNames: true`, `EmitUnpopulated: false`) exactly once.

### Layer 2: Convenience dispatcher (writes to stdout, handles errors internally)

- `**DisplayProto(msg proto.Message, format string, tableFunc func())**` — switches on format:
  - `"yaml"` -> `RenderProtoYAML(os.Stdout, msg)`, errors written to stderr
  - `"json"` -> `RenderProtoJSON(os.Stdout, msg)`, errors written to stderr
  - default -> `tableFunc()`

This preserves the current fire-and-forget signature of `DisplayGetResult` functions (no return value change, no call-site changes in `get.go` / `list.go`).

### Error handling decision

Current state: 6 files use `clierr.Handle()` (prints to stderr + `os.Exit(1)`), 1 file (`mcpserver`) uses `cliprint.PrintError()` (prints to stderr only). The new `DisplayProto` will print to stderr and return (matching mcpserver's current behavior). Rationale: the proto message was just received from a successful gRPC call — if `protojson.Marshal` fails on it, something is deeply wrong, but `os.Exit(1)` from a display function is disproportionate. This is technically a behavior change for 6 files on an unreachable code path.

## What Each File Looks Like After

**Before** (`agent/display.go` — representative):

```go
func DisplayGetResult(agent *agentv1.Agent, format string) {
    switch format {
    case "yaml":
        displayAgentYAML(agent)
    case "json":
        displayAgentJSON(agent)
    default:
        displayAgentTable(agent)
    }
}
func displayAgentYAML(agent *agentv1.Agent) { /* 15 lines */ }
func displayAgentJSON(agent *agentv1.Agent) { /* 10 lines */ }
```

**After**:

```go
func DisplayGetResult(agent *agentv1.Agent, format string) {
    display.DisplayProto(agent, format, func() { displayAgentTable(agent) })
}
```

The `displayAgentYAML` and `displayAgentJSON` functions are deleted entirely. The `displayAgentTable` function stays unchanged.

## Scope and Boundaries

### Files to modify (7 resource display files)


| File                   | Current lines | Functions removed                            | Estimated after |
| ---------------------- | ------------- | -------------------------------------------- | --------------- |
| `agent/display.go`     | 173           | `displayAgentYAML`, `displayAgentJSON`       | ~120            |
| `workflow/display.go`  | 165           | `displayWorkflowYAML`, `displayWorkflowJSON` | ~110            |
| `skill/display.go`     | 127           | `displaySkillYAML`, `displaySkillJSON`       | ~80             |
| `project/display.go`   | 238           | `displayProjectYAML`, `displayProjectJSON`   | ~190            |
| `mcpserver/display.go` | 117           | `displayAsYAML`, `displayAsJSON`             | ~70             |
| `execution/display.go` | 358           | 4 functions (get+list x yaml+json)           | ~260            |
| `session/display.go`   | 194           | 4 functions (get+list x yaml+json)           | ~100            |


### Files to create

- `client-apps/cli/pkg/display/proto.go` (~50 lines)
- `client-apps/cli/pkg/display/proto_test.go` (~80 lines)

### Files to update

- `client-apps/cli/pkg/display/BUILD.bazel` — add `proto.go` source, add `protojson` and `yaml.v3` deps
- 7 resource package `BUILD.bazel` files — add `//client-apps/cli/pkg/display` dep (where not already present)

### Explicitly out of scope

- `**search/display.go**` — its YAML/JSON rendering iterates over individual search entries and builds arrays manually. Fundamentally different pattern, not proto-message-level marshaling. Stays as-is.
- **No changes to call sites** — `get.go`, `list.go`, `search.go` command handlers are untouched. `DisplayGetResult` / `DisplayListResult` signatures don't change.
- **No `Displayable` interface** — per DD01.
- **No migration to `clioutput.CommandResult`** — per DD01.
- `**truncateString` duplication** — 6 identical copies across resource packages. Adjacent to this work but not proto-rendering boilerplate. Can be addressed as a follow-up if desired.

## Execution Order

Work proceeds file-by-file so we can build + vet after each to catch issues incrementally rather than making all changes and debugging a big bang.

1. Create `proto.go` + `proto_test.go` in `pkg/display/`, update `BUILD.bazel`, verify tests pass
2. Migrate `skill/display.go` (simplest — one `DisplayGetResult`, no list)
3. Migrate `mcpserver/display.go` (simple — one `DisplayGetResult`, no list)
4. Migrate `agent/display.go` (one `DisplayGetResult`, list delegates to search)
5. Migrate `workflow/display.go` (same structure as agent)
6. Migrate `project/display.go` (two display functions: `DisplayProjectInfo` + `DisplayGetResult`)
7. Migrate `session/display.go` (has both `DisplayGetResult` + `DisplayListResult`)
8. Migrate `execution/display.go` (most complex — has both get + list with format dispatch)
9. Final `go build`, `go vet`, verify all existing tests pass

