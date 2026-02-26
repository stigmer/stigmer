# CLI: Split server_logs.go and Consolidate search/display.go Rendering

**Date**: February 26, 2026

## Summary

Split the oversized `server_logs.go` (442 lines) into two focused files and consolidated the last holdout from the Phase 4 proto rendering consolidation by extracting generic array-aware YAML/JSON rendering utilities into `pkg/display/proto.go`. This completes the display layer cleanup started in Phases 4 and 5.

## Problem Statement

Two code hygiene issues remained after the CLI output system refactor (Phases 1-5):

### Pain Points

- `server_logs.go` at 442 lines exceeded the project's 250-line guideline, mixing command definition with low-level streaming mechanics
- `search/display.go` duplicated `protojson.MarshalOptions` and manually built JSON arrays with fragile `fmt.Println("[")` / comma logic, producing broken indentation where only the first line of each entry was indented within the array
- `search/display.go` used `cliprint.PrintError` for marshal errors, inconsistent with the `fmt.Fprintf(os.Stderr)` pattern established in Phase 4

## Solution

**Item 5 (server_logs split)**: Mechanical 2-file split along a clean responsibility boundary: "what to stream" (command + config) vs "how to stream" (file I/O, Docker exec, tail).

**Item 7 (search/display consolidation)**: Added three Go-generic functions to the shared `pkg/display/proto.go` package — `RenderProtoSliceJSON[T]`, `RenderProtoSliceYAML[T]`, and `DisplayProtoSlice[T]` — mirroring the existing single-message API. Refactored `search/display.go` to delegate YAML/JSON rendering to these shared utilities.

## Implementation Details

### server_logs split

- `server_logs.go` (244 lines): `newServerLogsCommand()`, `getComponentConfigs()`, `getComponentConfigsWithStreamPreferences()`
- `server_logs_stream.go` (200 lines): `streamLogs()`, `getInode()`, `showLastNLines()`, `streamDockerLogs()`, `runDockerLogs()`
- Zero logic changes. Only the file boundary moved.

### Generic proto slice rendering

- `RenderProtoSliceJSON[T proto.Message]`: Marshals each item via shared `protoMarshalOptions`, wraps in `[]json.RawMessage`, then uses `json.MarshalIndent` for correct nested indentation
- `RenderProtoSliceYAML[T proto.Message]`: Round-trips each item through JSON (for proto field naming), collects into `[]map[string]interface{}`, marshals as YAML array
- `DisplayProtoSlice[T proto.Message]`: Convenience dispatcher matching `DisplayProto` signature pattern (fire-and-forget, errors to stderr)
- 8 unit tests covering JSON, YAML, empty slices, and dispatcher behavior

### search/display.go cleanup

- `DisplayResults` simplified from manual format switch to single `display.DisplayProtoSlice(results.Entries, opts.Format, tableFunc)` call
- Removed `displayResultsYAML` and `displayResultsJSON` functions (56 lines)
- Removed direct `protojson` and `yaml.v3` imports and Bazel deps

## Benefits

- All CLI source files in `cmd/stigmer/root/` now comply with the 250-line guideline
- Proto array rendering is no longer duplicated — `pkg/display/proto.go` is the single source of truth for all proto marshaling (single and array)
- JSON array output now has correct nested indentation instead of the previous broken format
- `search` package has two fewer external dependencies (`protojson`, `yaml.v3`)
- Generic slice functions are reusable for any future list command that needs array YAML/JSON output

## Impact

- **CLI maintainers**: Cleaner file boundaries, consistent rendering patterns, fewer places to update when changing marshaling behavior
- **End users**: JSON output from `stigmer list --output json` and `stigmer search --output json` now produces correctly indented arrays

## Related Work

- Phase 4: Consolidated single-proto YAML/JSON rendering into `pkg/display/proto.go` (this extends it to arrays)
- Phase 5: Wired `--json`/`--quiet` flags and cleaned up cliprint dead code
- DD01: Established the two-system output architecture (CommandResult for mutations, `--output table/yaml/json` for reads)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
