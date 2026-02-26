# Task T02: Phase 4 — Consolidate Display File Boilerplate

**Created**: 2026-02-26
**Status**: READY
**Type**: Refactoring
**Depends on**: DD01 (Output Format Architecture)
**Effort**: Medium

## Background

After DD01 resolved the output format architecture question, Phase 4 scope is clear:
eliminate the duplicated YAML/JSON proto rendering boilerplate across the 8 display.go
files, without merging the read-command output system into `clioutput.CommandResult`.

Per DD01, these 8 files belong to **System 2** (read-command data inspection), which is
separate from `clioutput.CommandResult` (System 1, mutating-command operational feedback).

## The Problem

Every resource's display.go file contains nearly identical code for YAML and JSON
rendering. The only difference is the type of the protobuf message passed in.

### Duplicated YAML pattern (repeated 8 times)

```go
func displayXxxYAML(resource *xxxv1.Xxx) {
    marshaler := protojson.MarshalOptions{
        Indent:          "  ",
        UseProtoNames:   true,
        EmitUnpopulated: false,
    }
    jsonBytes, err := marshaler.Marshal(resource)
    if err != nil {
        clierr.Handle(fmt.Errorf("failed to marshal to JSON: %w", err))
        return
    }
    var jsonMap map[string]interface{}
    if err := yaml.Unmarshal(jsonBytes, &jsonMap); err != nil {
        clierr.Handle(fmt.Errorf("failed to parse JSON: %w", err))
        return
    }
    yamlBytes, err := yaml.Marshal(jsonMap)
    if err != nil {
        clierr.Handle(fmt.Errorf("failed to marshal to YAML: %w", err))
        return
    }
    fmt.Print(string(yamlBytes))
}
```

### Duplicated JSON pattern (repeated 8 times)

```go
func displayXxxJSON(resource *xxxv1.Xxx) {
    marshaler := protojson.MarshalOptions{
        Indent:          "  ",
        UseProtoNames:   true,
        EmitUnpopulated: false,
    }
    jsonBytes, err := marshaler.Marshal(resource)
    if err != nil {
        clierr.Handle(fmt.Errorf("failed to marshal to JSON: %w", err))
        return
    }
    fmt.Println(string(jsonBytes))
}
```

### Duplicated format switch (repeated 8 times)

```go
func DisplayGetResult(resource *xxxv1.Xxx, format string) {
    switch format {
    case "yaml":
        displayXxxYAML(resource)
    case "json":
        displayXxxJSON(resource)
    default:
        displayXxxTable(resource)
    }
}
```

### Total duplication

~30 lines per resource x 8 resources = ~240 lines of identical boilerplate.

## Files in Scope

### Target files (reduce boilerplate)

- `client-apps/cli/internal/cli/agent/display.go` (174 lines)
- `client-apps/cli/internal/cli/workflow/display.go` (166 lines)
- `client-apps/cli/internal/cli/mcpserver/display.go` (118 lines)
- `client-apps/cli/internal/cli/skill/display.go` (128 lines)
- `client-apps/cli/internal/cli/project/display.go` (239 lines)
- `client-apps/cli/internal/cli/execution/display.go` (359 lines)
- `client-apps/cli/internal/cli/session/display.go` (195 lines)
- `client-apps/cli/internal/cli/search/display.go` (300 lines)

### Utility package (extend with proto rendering)

- `client-apps/cli/pkg/display/` — add proto rendering utilities here

## Plan

### Step 1: Add generic proto rendering utilities to `pkg/display/`

Create `client-apps/cli/pkg/display/proto.go` with:

```go
// RenderProtoYAML marshals a protobuf message to YAML and writes it to w.
func RenderProtoYAML(w io.Writer, msg proto.Message) error { ... }

// RenderProtoJSON marshals a protobuf message to indented JSON and writes it to w.
func RenderProtoJSON(w io.Writer, msg proto.Message) error { ... }

// DisplayProto renders a protobuf message in the requested format.
// For "yaml" and "json" formats, it uses generic proto marshaling.
// For "table" (default), it calls the provided tableFunc.
// Errors are reported via clierr.Handle.
func DisplayProto(msg proto.Message, format string, tableFunc func()) { ... }
```

The `MarshalOptions` configuration is centralized once:
- `Indent: "  "`
- `UseProtoNames: true`
- `EmitUnpopulated: false`

Update `BUILD.bazel` for `pkg/display/` to add proto dependencies.

### Step 2: Migrate each display.go file

For each resource, replace the duplicated YAML/JSON functions and format switch with
a call to `display.DisplayProto`. Example transformation:

**Before** (agent/display.go, ~40 lines for format handling):
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

func displayAgentYAML(agent *agentv1.Agent) { ... 15 lines ... }
func displayAgentJSON(agent *agentv1.Agent) { ... 10 lines ... }
```

**After** (~5 lines for format handling):
```go
func DisplayGetResult(agent *agentv1.Agent, format string) {
    display.DisplayProto(agent, format, func() {
        displayAgentTable(agent)
    })
}
```

The `displayAgentYAML` and `displayAgentJSON` functions are deleted entirely.

### Step 3: Handle list-specific cases

Some display.go files have list-level YAML/JSON rendering (e.g., execution's
`DisplayListResult` with `displayListYAML` / `displayListJSON`). These also follow
the identical protojson pattern and can use `display.DisplayProto` the same way.

The `search/display.go` file has a slightly different pattern for list rendering
(manually builds a JSON array). Evaluate whether this can use the generic utility
or should remain custom.

### Step 4: Remove dead imports

After removing the per-resource YAML/JSON functions, clean up unused imports
(`protojson`, `yaml`, `clierr` where no longer needed).

### Step 5: Update BUILD.bazel files

Update Bazel BUILD files for:
- `pkg/display/BUILD.bazel` — add `proto.go`, proto dependencies
- Each resource package BUILD.bazel — may need to add `pkg/display` dependency

## What NOT to Do

Per DD01:
- Do NOT create a `Displayable` interface for table rendering
- Do NOT migrate get/list to `clioutput.CommandResult`
- Do NOT add `clioutput.OutputFormat` to get/list commands
- Do NOT touch the table rendering functions — they stay per-resource

## Open Question (from DD01)

The `table` view in get commands currently uses `cliprint.PrintInfo()` (cyan-colored).
Decision needed on whether table views should:
- (A) Stay with `cliprint.PrintInfo()` — data display, cyan info style is fine
- (B) Move to plain `fmt.Fprintf` — data is not status messaging
- (C) Get own lightweight styling via `display` package

This is independent of the boilerplate consolidation and can be deferred to Phase 5
if needed. The current step focuses only on eliminating the YAML/JSON duplication.

## Success Criteria

1. Zero duplicated `protojson.MarshalOptions` blocks across display.go files
2. A single `DisplayProto` utility in `pkg/display/` handles all format dispatch
3. Each display.go file's format handling reduces from ~40 lines to ~5 lines
4. All per-resource table rendering functions remain unchanged
5. `go build`, `go vet`, all tests passing
6. `stigmer get agent foo -o json | jq '.'` still works (piping preserved)
7. `stigmer get agent foo -o yaml` still works (YAML preserved)
