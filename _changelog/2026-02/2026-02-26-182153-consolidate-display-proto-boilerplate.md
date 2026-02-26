# Consolidate Proto YAML/JSON Display Boilerplate

**Date**: February 26, 2026

## Summary

Extracted duplicated proto-to-YAML and proto-to-JSON marshaling code from 7 resource `display.go` files into a shared two-layer API in `pkg/display/proto.go`. This eliminated 16 per-resource marshaling functions and 9 format-dispatch switch blocks, reducing the codebase by a net 282 lines while centralizing marshaling options and error handling into a single source of truth.

## Problem Statement

Every resource type in the CLI (`agent`, `workflow`, `skill`, `project`, `mcpserver`, `execution`, `session`) had its own `display.go` file containing identical proto marshaling boilerplate. The same 25-line YAML function and 10-line JSON function were copied verbatim across all 7 packages — only the variable name and error string differed.

### Pain Points

- 16 identical marshaling functions scattered across 7 packages (~210 lines of pure duplication)
- 9 identical format-dispatch switch blocks (`case "yaml"`, `case "json"`, `default: table`)
- Inconsistent error handling: 6 packages used `clierr.Handle()` (which calls `os.Exit(1)`), 1 used `cliprint.PrintError()` (which just prints to stderr)
- Marshaling options (`Indent`, `UseProtoNames`, `EmitUnpopulated`) hardcoded in 16 separate locations — changing a default would require editing every file
- Adding a new output format (e.g., TOML) would require touching all 7 packages

## Solution

Created a two-layer API in `pkg/display/proto.go`:

**Layer 1 — Pure utility functions** (testable, `io.Writer`-based, error-returning):
- `RenderProtoYAML(w io.Writer, msg proto.Message) error`
- `RenderProtoJSON(w io.Writer, msg proto.Message) error`

**Layer 2 — Convenience dispatcher** (writes to stdout, handles errors internally):
- `DisplayProto(msg proto.Message, format string, tableFunc func())`

The Layer 1 functions are pure and fully testable. Layer 2 is the fire-and-forget convenience wrapper that preserves the existing `DisplayGetResult` / `DisplayListResult` void signatures, meaning zero changes to call sites in `get.go`, `list.go`, or any command handler.

## Implementation Details

**New files:**
- `client-apps/cli/pkg/display/proto.go` (74 lines) — the two-layer API with a package-level `protoMarshalOptions` variable encoding the canonical marshaling configuration exactly once
- `client-apps/cli/pkg/display/proto_test.go` (102 lines) — 8 tests covering JSON output, YAML output, nil messages, and format dispatch for table/json/yaml/default

**Modified files (7 display.go + 7 BUILD.bazel + 1 pkg BUILD.bazel = 15 files):**
- Each resource's `DisplayGetResult` collapsed from a 7-line switch + two 15/10-line functions into a single-line call: `display.DisplayProto(msg, format, func() { tableFunc(msg) })`
- Per-resource table rendering functions left completely untouched — they contain genuinely resource-specific logic
- Cleaned up now-unused imports (`clierr`, `protojson`, `yaml.v3`) from display.go files
- Removed stale `clierr`, `protojson`, `yaml.v3` Bazel deps from 5 packages where no other file used them

**Error handling unification:**
- Unified to "print to stderr, don't exit" — matching the more proportionate behavior that `mcpserver` already used
- The error paths are practically unreachable (proto messages come from successful gRPC calls), but the unified behavior is correct: a display-layer marshal error should never crash the CLI

**Scope boundary respected:**
- `search/display.go` excluded — its YAML/JSON handling iterates over individual entries and builds arrays, fundamentally different from single-proto marshaling
- No `Displayable` interface created — per DD01 design decision
- No migration of get/list to `clioutput.CommandResult` — per DD01

## Benefits

- **Single source of truth**: Marshaling options defined once in `protoMarshalOptions` — future changes apply everywhere automatically
- **Net -282 lines**: 492 lines removed, 210 added (including tests)
- **Consistent error handling**: All 7 resource packages now handle display errors identically
- **Extensibility**: Adding a new output format requires changing one function (`DisplayProto`) instead of 7 files
- **Testability**: The pure `RenderProtoYAML`/`RenderProtoJSON` functions accept `io.Writer`, enabling buffer-based testing without stdout capture
- **Dependency cleanup**: 5 packages shed unnecessary `clierr`, `protojson`, and `yaml.v3` dependencies

## Impact

- **Display files**: All 7 resource display.go files significantly smaller (45-107 lines removed each)
- **No behavioral change for users**: Output format, content, and command signatures remain identical
- **Developers**: Adding a new resource type's display.go is now simpler — just write the table function and wire `display.DisplayProto`
- **Phase 5 ready**: The remaining `cliprint` usage in table functions is a separate concern for the cleanup phase

## Related Work

- Phase 1: Core `clioutput` package foundation (`pkg/clioutput/`)
- Phase 2: Delete confirmation bug fix
- Phase 3.1-3.3: Migrate delete/server/backend/config/apply to `CommandResult`
- DD01: Output format architecture decision (two separate systems by design)
- Phase 5 (next): Cleanup and polish — remove deprecated `cliprint` functions, icon/vocabulary audit

---

**Status**: Production Ready
**Timeline**: Single session
