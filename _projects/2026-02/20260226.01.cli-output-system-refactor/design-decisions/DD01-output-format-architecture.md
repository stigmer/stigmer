# DD01: Output Format Architecture — Two Separate Systems

**Date**: 2026-02-26
**Status**: Accepted
**Decided by**: Collaborative analysis after Phase 3.3 completion

## Context

The original project plan (T01) assumed a single unified output pipeline where all
commands — including `get`, `list`, `delete`, `apply`, `server`, and `config` — would
route through `clioutput.CommandResult` and its `Renderer` (human/json/quiet). A design
decision was flagged as a prerequisite for Phase 4:

> `--output table/yaml/json` on get/list = data serialization format
> `clioutput.OutputFormat` = CLI chrome format (human/json/quiet)
> Need to decide how these coexist before migrating get/list commands.

After completing Phases 1 through 3.3, we analyzed the actual usage patterns across
both systems. The finding is that these are two fundamentally distinct concerns that
serve different command categories, and they should never coexist on the same command.

## Decision

**The CLI has two separate, non-overlapping output systems. This is by design.**

### System 1: CommandResult + Renderer

**Scope**: Mutating/action commands (delete, apply, server stop, server status,
backend, config set).

**Purpose**: Operational feedback — "did my action succeed?"

**Format control**: `clioutput.OutputFormat` with values `human`, `json`, `quiet`.

**Output schema**: Fixed. Always `CommandResult` (status, message, sections, hints).

Example JSON output:
```json
{
  "status": "success",
  "message": "Agent deleted successfully",
  "sections": [
    {
      "title": "Deleted Agent",
      "fields": [
        {"key": "ID", "value": "agt_123"},
        {"key": "Name", "value": "my-agent"}
      ]
    }
  ]
}
```

### System 2: --output flag (table/yaml/json)

**Scope**: Read/inspection commands (get, list, search).

**Purpose**: Data inspection — "show me the resource."

**Format control**: `--output` / `-o` flag with values `table`, `yaml`, `json`.

**Output schema**: Per-resource protobuf schema. Every resource type produces its own
shape, directly derived from the API protobuf definition.

Example JSON output:
```json
{
  "metadata": {"id": "agt_123", "name": "my-agent", "slug": "my-agent", "org": "stigmer"},
  "spec": {"description": "...", "instructions": "...", "mcp_server_usages": [...]}
}
```

### Command-to-System Mapping

```
Mutating Commands  ──>  clioutput.CommandResult + Renderer (human/json/quiet)
  delete, apply, server stop, server start, server status,
  backend, config set, push, validate, cancel

Read Commands  ──>  --output flag + per-resource display (table/yaml/json)
  get, list, search
```

### Why They Must Not Merge

| Dimension | CommandResult (System 1) | --output flag (System 2) |
|-----------|--------------------------|--------------------------|
| Consumer | Operator checking action results | Developer scripting with resource data |
| Output schema | Fixed (status/message/sections) | Per-resource protobuf schema |
| JSON meaning | Operational metadata | Raw API resource |
| Piping | Not meaningful | Core use case: `stigmer get agent foo -o json \| jq '.spec'` |
| Table format | Key-value pairs in sections | Multi-column tabular rows |
| YAML support | Not applicable | Required (data serialization) |

Forcing get/list through CommandResult would:

1. **Break piping**: `stigmer get agent my-agent -o json | jq '.spec'` would emit
   the CommandResult JSON envelope instead of the raw protobuf, breaking all scripts.
2. **Lose YAML**: CommandResult has no YAML renderer, and adding one would conflate
   data serialization with operational chrome.
3. **Mismodel the data**: CommandResult sections with key-value pairs cannot represent
   multi-row list tables (ID, AGENT, STATUS, STARTED, DURATION columns).

## Impact on Phase 4 (Display File Consolidation)

Phase 4 should consolidate the duplicated boilerplate within System 2 without
attempting to merge the two systems.

### What to consolidate

The 8 display.go files each contain:
- `displayXxxYAML(resource)` — 15-line function, logic identical across all resources
- `displayXxxJSON(resource)` — 10-line function, logic identical across all resources
- `DisplayGetResult(resource, format)` — 7-line switch, structure identical across all

This boilerplate (~30 lines per resource, ~240 lines total) should be extracted into
generic proto rendering utilities in `pkg/display/`:
- `RenderProtoYAML(w io.Writer, msg proto.Message) error`
- `RenderProtoJSON(w io.Writer, msg proto.Message) error`
- `DisplayProto(msg proto.Message, format string, tableFunc func())` — format dispatcher

### What to leave alone

Each resource's table rendering remains resource-specific. Agent shows MCP server
counts, execution shows phases and durations, project shows resource counts. A
`Displayable` interface for table rendering would either be too generic to be useful
or too complex to justify. The table functions stay per-resource.

### What NOT to do

- Do NOT create a `Displayable` interface that generalizes table rendering across
  resource types.
- Do NOT migrate get/list to `clioutput.CommandResult`.
- Do NOT add `--quiet` or `clioutput.OutputFormat` to get/list commands.
- Do NOT add `--output table/yaml/json` to mutating commands.

## Superseded Plan Elements

This decision supersedes the following items from the original T01 plan:

- **Phase 1.2** ("Create `Displayable` interface for resources"): Cancelled. The
  `Displayable` interface was designed to route get/list through CommandResult, which
  this decision rejects. Phase 4 will consolidate boilerplate via generic proto
  rendering utilities instead.
- **Phase 1.3** ("Add global `--output` flag to root command"): Cancelled as originally
  scoped. The root-level `--output` flag was meant to control CommandResult rendering
  for all commands. Since get/list commands already have their own `--output` flag with
  a different value set (`table/yaml/json`), a root-level flag would create ambiguity.
  CommandResult rendering format (human/json/quiet) can be wired separately if needed
  in Phase 5.
- **Phase 3 scope** ("Migrate All Commands"): The directive "every command returns
  CommandResult" no longer applies to get/list/search. Phase 3 migration was correctly
  limited to mutating commands (delete, apply, server, backend, config).
- **Phase 4 scope** ("Consolidate Display Files"): Narrowed from "eliminate 8 display.go
  files via Displayable interface" to "extract shared proto YAML/JSON boilerplate, keep
  per-resource table rendering."
- **Success criterion #6** ("All 8 display.go files under 30 lines each"): Revised.
  Files will shrink meaningfully but will retain their per-resource table functions.

## Alternatives Considered

### A. Merge everything into CommandResult

Rejected. Would break piping, lose YAML, and mismodel tabular data. See analysis above.

### B. Use CommandResult for table view, bypass for yaml/json

Would mean the same command sometimes uses CommandResult (table) and sometimes does not
(yaml/json). This creates a confusing split for maintainers and gains nothing — the
table view of get is data inspection, not an action result.

### C. Create a separate DataResult for get/list

A parallel domain entity alongside CommandResult. Over-engineered for the problem —
the existing `proto.Message` + format switch is the correct abstraction for data
inspection commands.
