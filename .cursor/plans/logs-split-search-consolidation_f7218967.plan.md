---
name: logs-split-search-consolidation
overview: Split server_logs.go (442 lines) into 2 focused files and consolidate search/display.go by extracting its array-iteration YAML/JSON rendering into generic shared utilities in pkg/display/proto.go.
todos:
  - id: split-server-logs
    content: "Item 5: Split server_logs.go into server_logs.go (command+config) and server_logs_stream.go (streaming), update BUILD.bazel"
    status: completed
  - id: add-proto-slice-funcs
    content: "Item 7a: Add RenderProtoSliceJSON, RenderProtoSliceYAML, DisplayProtoSlice generics to pkg/display/proto.go"
    status: completed
  - id: add-proto-slice-tests
    content: "Item 7b: Add unit tests for the new proto slice functions in proto_test.go"
    status: completed
  - id: migrate-search-display
    content: "Item 7c: Refactor search/display.go to use DisplayProtoSlice, remove displayResultsYAML/JSON, clean up imports"
    status: completed
  - id: update-search-bazel
    content: "Item 7d: Remove protojson and yaml.v3 deps from search/BUILD.bazel"
    status: completed
  - id: verify-build
    content: "Verify: go build, go vet, and all tests pass across affected packages"
    status: completed
isProject: false
---

# Item 5 + 7: server_logs Split and search/display Consolidation

## Item 5: Split `server_logs.go` (442 lines -> 2 files)

Pure mechanical split. No logic changes. No new behavior.

### Proposed split

**File 1: `server_logs.go` (~250 lines)** -- Command definition + component configuration

- `newServerLogsCommand()` (lines 22-179) -- cobra command, flag wiring, orchestration
- `getComponentConfigs()` (lines 182-211) -- builds `[]logs.ComponentConfig`
- `getComponentConfigsWithStreamPreferences()` (lines 217-250) -- same with smart defaults

These belong together: the config helpers are only called from the command's `Run` function. They're "what to stream" logic.

**File 2: `server_logs_stream.go` (~200 lines)** -- All streaming mechanics

- `streamLogs()` (lines 255-349) -- file-based log streaming with inode tracking
- `getInode()` (lines 352-357) -- inode extraction helper
- `showLastNLines()` (lines 360-397) -- static tail
- `streamDockerLogs()` (lines 401-423) -- Docker container log streaming with reconnect
- `runDockerLogs()` (lines 425-441) -- `docker logs` exec wrapper

These belong together: they're all "how to stream" mechanics (file I/O, Docker exec, tail behavior).

### BUILD.bazel change

Add `"server_logs_stream.go"` to `srcs` in [client-apps/cli/cmd/stigmer/root/BUILD.bazel](client-apps/cli/cmd/stigmer/root/BUILD.bazel).

### Observations (NOT in scope, noted for awareness)

- `server_logs.go` uses `clierr.Handle(err)` (which calls `os.Exit(1)`) in 5 places. Phase 4 established that this is disproportionate for non-fatal errors, but migrating `clierr` usage belongs to item 3 (cliprint sunset), not this split.
- `getComponentConfigs()` and `getComponentConfigsWithStreamPreferences()` share ~70% of their code. Deduplication would be a logic change, not a mechanical split. Out of scope.

---

## Item 7: Consolidate `search/display.go` YAML/JSON rendering

### Problem

[search/display.go](client-apps/cli/internal/cli/search/display.go) (300 lines) was excluded from Phase 4 because its YAML/JSON rendering iterates arrays of proto messages, unlike other `display.go` files that render single messages. It currently:

- Duplicates `protojson.MarshalOptions` (identical to `protoMarshalOptions` in `pkg/display/proto.go`)
- Manually builds JSON arrays with `fmt.Println("[")` / comma logic / `fmt.Println("]")` -- fragile and produces **broken indentation** (first line of each entry is indented, subsequent lines are not)
- Uses `cliprint.PrintError` for marshal errors (inconsistent with the `fmt.Fprintf(os.Stderr)` pattern established in Phase 4)

### Approach

Add three generic functions to [pkg/display/proto.go](client-apps/cli/pkg/display/proto.go), mirroring the existing single-message API:

```go
// Testable layer (io.Writer-based, returns errors)
func RenderProtoSliceJSON[T proto.Message](w io.Writer, items []T) error
func RenderProtoSliceYAML[T proto.Message](w io.Writer, items []T) error

// Convenience dispatcher (fire-and-forget, matches DisplayProto signature pattern)
func DisplayProtoSlice[T proto.Message](items []T, format string, tableFunc func())
```

Precedent: generics already used in the CLI codebase at `synthesis/reader.go`:

```88:88:client-apps/cli/internal/cli/synthesis/reader.go
func readProtoFiles[T proto.Message](dir, pattern string) ([]T, error) {
```

### Implementation detail for `RenderProtoSliceJSON`

Use `encoding/json.MarshalIndent` over a `[]json.RawMessage` to produce properly indented JSON arrays. Each entry is marshaled via `protoMarshalOptions` (for proto field naming), then wrapped in `json.RawMessage`, then the whole slice is formatted with `json.MarshalIndent`. This fixes the broken indentation in the current manual approach.

**Behavioral change**: The JSON output will have correct nested indentation instead of the current partially-indented format. This is an improvement -- the current output is visually broken (only the first line of each entry is indented within the array). I will flag this when we reach implementation if you want to discuss further.

### `search/display.go` after consolidation (~240 lines, under 250)

`DisplayResults` simplifies from a manual format switch to:

```go
func DisplayResults(results *Result, opts *DisplayOptions) {
    // ... nil/default handling unchanged ...
    display.DisplayProtoSlice(results.Entries, opts.Format, func() {
        displayResultsTable(results, opts)
    })
}
```

**Removed**: `displayResultsYAML` (~~32 lines), `displayResultsJSON` (~~24 lines), direct `protojson` import, direct `yaml.v3` import.

**Kept**: Everything else -- `DisplayEmptyResults`, `DisplayPaginationInfo`, table rendering, format helpers. These are search-specific and stay.

### Files changed

- `**pkg/display/proto.go`**: Add 3 generic functions (~55 lines), add `encoding/json` import
- `**pkg/display/proto_test.go`**: Add tests for `RenderProtoSliceJSON` and `RenderProtoSliceYAML`
- `**pkg/display/BUILD.bazel**`: No change expected (already has all needed deps; `encoding/json` is stdlib)
- `**search/display.go**`: Replace `displayResultsYAML`/`displayResultsJSON` with `display.DisplayProtoSlice` call
- `**search/BUILD.bazel**`: Remove `@in_gopkg_yaml_v3//:yaml_v3` and `@org_golang_google_protobuf//encoding/protojson` from deps

---

## Execution order

Item 5 first (mechanical, zero-risk, quick), then item 7 (logic change, needs tests, more careful).