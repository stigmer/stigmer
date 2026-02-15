---
name: CLI Tool Display Improvements
overview: "Implement Workstream 2 from the fix_cli_tool_display plan: improve the Go CLI tool call rendering with fallback arg resolution, defense-in-depth repr stripping, and content previews for Read operations."
todos:
  - id: refactor-struct
    content: "Refactor toolDisplayInfo: add previewStyle enum, fallbackFields field, replace showPreview bool, update all toolDisplayMap entries"
    status: completed
  - id: fallback-args
    content: Add extractPrimaryArgWithFallbacks in format.go and update renderKnown to use it
    status: completed
  - id: repr-stripping
    content: Add stripToolMessageRepr, unquote, and integrate into formatResultPreview as defense-in-depth
    status: completed
  - id: read-preview
    content: Add formatFirstLinePreview, firstNonEmptyLine helpers, and previewFirstLine rendering in renderKnown
    status: completed
  - id: tests
    content: Write comprehensive tests for all new functions and integration scenarios, verify existing tests pass
    status: completed
  - id: build-verify
    content: Run bazel test to validate all changes compile and tests pass
    status: completed
isProject: false
---

# Workstream 2: CLI Tool Call Display Improvements (Go)

## Context

From the [logs.md](stigmer/_cursor/logs.md) output, five display defects are visible in the CLI tool rendering:

1. **Repr leaking into previews** (lines 56, 59, 62, 65, 70, 73): Discovery tool previews show raw Python `repr()` output like `content="Directory '/bin/skills' is empty" name='ls' tool_call_id='to...` instead of the clean content string.
2. **Missing path on Read** (line 67): `📖 Read (195 chars, 2ms)` — the file path is absent because the sandbox tool uses a different arg name than `"path"`.

Workstream 1 (backend) fixes the root cause in `_extract_tool_result_content()`. Workstream 2 adds CLI-side resilience and UX improvements.

---

## Architecture Decision: Preview Style Enum vs. Boolean Flags

The original plan proposed adding a second boolean `showReadPreview` alongside the existing `showPreview`. I want to propose a better approach.

Adding a second boolean is fragile — if we later introduce shell output previews or search result previews, we'd keep stacking booleans. Instead, I propose replacing the `showPreview bool` with a `preview previewStyle` enum:

```go
type previewStyle int

const (
    previewNone      previewStyle = iota // No preview line (shell, write, edit, delete)
    previewDiscovery                     // Comma-join multi-line entries (ls, glob, grep)
    previewFirstLine                     // First-line excerpt of content (read, read_file)
)
```

This is a backward-compatible refactor: every existing `showPreview: true` becomes `preview: previewDiscovery`, and every omitted/false becomes `preview: previewNone` (zero value). The rendering logic in `renderKnown` switches on the enum instead of a boolean. No external API changes since `toolDisplayInfo` is unexported.

---

## 2a. Fallback Arg Resolution

**File:** [format.go](client-apps/cli/pkg/toolrender/format.go)

Add a new `fallbackFields []string` to the `toolDisplayInfo` struct in [render.go](client-apps/cli/pkg/toolrender/render.go), and a composed lookup function in `format.go`:

```go
// extractPrimaryArgWithFallbacks tries the primary field first, then each
// fallback in order. Returns the first non-empty value found.
func extractPrimaryArgWithFallbacks(args map[string]interface{}, primary string, fallbacks []string) string {
    if val := extractPrimaryArg(args, primary); val != "" {
        return val
    }
    for _, fb := range fallbacks {
        if val := extractPrimaryArg(args, fb); val != "" {
            return val
        }
    }
    return ""
}
```

The existing `extractPrimaryArg` remains unchanged as a clean primitive.

**Display map updates** in [render.go](client-apps/cli/pkg/toolrender/render.go):

```go
"read":      {icon: "📖", label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFirstLine},
"read_file": {icon: "📖", label: "Read", primaryField: "path", fallbackFields: []string{"file_path", "file"}, preview: previewFirstLine},
```

Also add fallbacks for other tools where arg name variance is plausible (ls, glob, grep already use well-known names, so no fallbacks needed there for now).

**Caller update** in `renderKnown`:

```go
primaryVal := extractPrimaryArgWithFallbacks(tc.Args, info.primaryField, info.fallbackFields)
```

---

## 2b. Defense-in-Depth Repr Stripping

**File:** [format.go](client-apps/cli/pkg/toolrender/format.go)

Add `stripToolMessageRepr()` that detects and extracts clean content from raw Python ToolMessage `repr()` strings. This is a safety net for when the backend sends unextracted ToolMessage objects.

The pattern to detect (from actual logs):

```
content="Directory '/bin/skills' is empty" name='ls' tool_call_id='toolu_...'
content='bin/skills/a34ed...' name='glob' tool_call_id='toolu_...'
```

Detection strategy: string starts with `content=` AND contains  `name='` or  `name="`.

```go
func stripToolMessageRepr(s string) string {
    if !strings.HasPrefix(s, "content=") {
        return s
    }
    // Look for ToolMessage metadata fields that follow the content value.
    for _, marker := range []string{" name='", ` name="`} {
        if idx := strings.Index(s, marker); idx >= 0 {
            content := s[len("content="):idx]
            return unquote(content)
        }
    }
    return s
}

func unquote(s string) string {
    if len(s) >= 2 {
        if (s[0] == '\'' && s[len(s)-1] == '\'') || (s[0] == '"' && s[len(s)-1] == '"') {
            return s[1 : len(s)-1]
        }
    }
    return s
}
```

This is called at the top of `formatResultPreview()` and in the new `formatFirstLinePreview()`, providing defense-in-depth regardless of which preview style is used.

---

## 2c. Read Content Previews

**File:** [render.go](client-apps/cli/pkg/toolrender/render.go)

Currently Read tools show: `📖 Read: inputs/agent-spec.proto (12 KB, 4ms)`

With `previewFirstLine`, they will show:

```
📖 Read: inputs/agent-spec.proto (12 KB, 4ms)
     syntax = "proto3";
```

**File:** [format.go](client-apps/cli/pkg/toolrender/format.go)

Add a new formatting function for first-line previews:

```go
func formatFirstLinePreview(result string) string {
    result = strings.TrimSpace(result)
    if result == "" {
        return ""
    }
    result = stripToolMessageRepr(result)
    // Extract first non-empty line.
    firstLine := firstNonEmptyLine(result)
    if firstLine == "" {
        return ""
    }
    return truncate(firstLine, previewMaxWidth)
}
```

Update `formatResultPreview()` to also call `stripToolMessageRepr` at the top (defense for discovery tools).

Update `renderKnown` to switch on the preview style:

```go
switch info.preview {
case previewDiscovery:
    if tc.Result != "" {
        if preview := formatResultPreview(tc.Result); preview != "" {
            line += "\n" + dimStyle.Render("     "+preview)
        }
    }
case previewFirstLine:
    if tc.Result != "" {
        if preview := formatFirstLinePreview(tc.Result); preview != "" {
            line += "\n" + dimStyle.Render("     "+preview)
        }
    }
}
```

---

## 2d. Tests

**File:** [render_test.go](client-apps/cli/pkg/toolrender/render_test.go)

New test sections:

- **Fallback field resolution**: `read_file` with `file_path` arg instead of `path` should still show the path.
- **Repr stripping in discovery previews**: `ls` result containing `content="..." name='ls' tool_call_id='...'` should show clean content.
- **Repr stripping in read previews**: `read` result containing repr should show clean first line.
- **Read content preview**: `read` with a multi-line result shows first-line excerpt.
- **Read content preview truncation**: Long first lines get truncated with `...`.
- **Read with empty result**: No preview line shown.
- **PreviewStyle migration**: Existing discovery preview tests continue to pass (regression guard).

New unit tests for format helpers:

- `TestStripToolMessageRepr_*` — double-quoted, single-quoted, no-match passthrough, empty string.
- `TestUnquote_*` — various quote combinations.
- `TestFormatFirstLinePreview_*` — single line, multi-line, empty, whitespace-only, repr-contaminated.
- `TestExtractPrimaryArgWithFallbacks_*` — primary found, fallback found, none found, nil args.

**BUILD.bazel** does not need changes since no new `.go` files are being created.

---

## File Change Summary


| File                                            | Changes                                                                                                                                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client-apps/cli/pkg/toolrender/render.go`      | Add `previewStyle` enum, `fallbackFields` to struct, replace `showPreview` with `preview`, update `toolDisplayMap` entries, update `renderKnown`                                    |
| `client-apps/cli/pkg/toolrender/format.go`      | Add `extractPrimaryArgWithFallbacks`, `stripToolMessageRepr`, `unquote`, `formatFirstLinePreview`, `firstNonEmptyLine`; update `formatResultPreview` to call `stripToolMessageRepr` |
| `client-apps/cli/pkg/toolrender/render_test.go` | Add test cases for fallback fields, repr stripping, read previews, format helpers                                                                                                   |


---

## Execution Sequence

1. **Step 1**: Refactor `toolDisplayInfo` struct — add `fallbackFields`, replace `showPreview` with `preview` enum.
2. **Step 2**: Update `toolDisplayMap` entries to use new fields.
3. **Step 3**: Add `extractPrimaryArgWithFallbacks` and update `renderKnown` to use it.
4. **Step 4**: Add `stripToolMessageRepr`, `unquote`, `firstNonEmptyLine`, `formatFirstLinePreview`.
5. **Step 5**: Update `formatResultPreview` with repr stripping defense.
6. **Step 6**: Update `renderKnown` preview logic to switch on `previewStyle`.
7. **Step 7**: Write all new tests and verify existing tests still pass.
8. **Step 8**: Run `bazel test //client-apps/cli/pkg/toolrender:toolrender_test` to validate.

---

## Expected Output After Changes

Before (from logs):

```
📂 List: /bin/skills/a34ed... (163 chars, 1ms)
     content="Directory '/bin/skills/a34ed6ddb7e2b131cc2cb980c89c50c563405...
🔍 Find: **/*.py (103 chars, 20ms)
     content="No files matching pattern '**/*.py'" name='glob' tool_call_i...
📖 Read (195 chars, 2ms)
```

After:

```
📂 List: /bin/skills/a34ed... (163 chars, 1ms)
     Directory '/bin/skills/a34ed...' is empty
🔍 Find: **/*.py (103 chars, 20ms)
     No files matching pattern '**/*.py'
📖 Read: inputs/agent-spec.proto (195 chars, 2ms)
     syntax = "proto3";
```

