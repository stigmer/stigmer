---
name: Phase 3.2 Approval Rendering
overview: Create rendering primitives for the collapsed post-decision view and approval UI elements in a new `render_approval.go` file. Pure rendering functions only — no event handling changes (that's Phase 3.3).
todos:
  - id: create-render-approval
    content: Create `pkg/toolrender/render_approval.go` with `RenderApprovalResult`, `ApprovalSeparator`, `ApprovalQuestion`, and internal helpers
    status: completed
  - id: create-render-approval-tests
    content: Create `pkg/toolrender/render_approval_test.go` with full test matrix (~30-40 tests)
    status: completed
  - id: update-bazel
    content: Update `pkg/toolrender/BUILD.bazel` to include new source and test files
    status: completed
  - id: verify-tests
    content: Run `go test` and `go vet` to verify all tests pass and code is clean
    status: completed
isProject: false
---

# Phase 3.2: Approval Result Rendering Primitives

## Scope

New rendering functions in `pkg/toolrender/` that Phase 3.3 will compose into the four-state approval flow. This phase creates the **building blocks** — no changes to `run_stream_inline.go` or event handling.

**Applicability**: Only tools that go through the approval pipeline (write, edit, shell, delete, unknown/MCP). Read, discovery, think, and task tools never enter `WAITING_APPROVAL` and are unaffected.

## New File: `pkg/toolrender/render_approval.go`

### 1. `RenderApprovalResult(tc ToolCallInfo, action string, opts CompactOptions) string`

The main entry point — produces the collapsed post-decision view that replaces ALL expanded content (header + streamed content + separator + menu) after the user decides. `action` is one of `"approve"`, `"skip"`, `"reject"`.

**Approved write/edit** (green bullet, content preview):

```
● Write(tests/test_tools.sh)
└ Wrote 241 lines
    #!/usr/bin/env bash
    # ================================================================
    # tests/test_tools.sh
    ... (up to 10 lines)
    … +231 more lines
```

**Rejected write/edit** (red bullet, content preview for scrollback record):

```
● Write(tests/test_tools.sh)
└ Rejected
    #!/usr/bin/env bash
    ... (up to 10 lines)
    … +231 more lines
```

**Skipped** (dim bullet, no preview — user doesn't care):

```
● Write(tests/test_tools.sh)
└ Skipped
```

**Approved shell** (green bullet, no content preview — output streams after):

```
● Shell(go test ./...)
└ Approved
```

**Rejected/skipped shell**:

```
● Shell(rm -rf ./tmp)
└ Rejected
```

**Design decisions baked in:**

- **No path repetition** in `└` line — header already shows the path
- **Action-colored bullets** — green (approved), red (rejected), dim (skipped)
- `**action` is a string** (`"approve"`, `"skip"`, `"reject"`) — avoids `toolrender` depending on the `approval` package; these strings already exist in the `ApprovalResponse` protocol
- **Smart cutoff** on preview — show all lines when count <= `maxApprovalPreviewLines + 1` (avoids pointless "+ 1 more lines"), consistent with existing compact renderers
- **Content via `resolveDisplayContent`** — write tools show args content (the file being written), consistent with existing compact write renderer

### 2. `ApprovalSeparator() string`

Returns a dim horizontal separator for the expanded approval view. Fixed width of 24 characters (`────────────────────────`), matching the visual weight used in the spec. Phase 3.3 places these between header/content and content/question.

### 3. `ApprovalQuestion(tc ToolCallInfo) string`

Returns the approval question line: "Do you want to create tests/test_tools.sh?"

Verb mapping from tool labels:

- Write → "create" / Edit → "edit" / Shell/Execute → "execute" / Delete → "delete"
- Unknown tools → "run {toolName}"

Uses `toolDisplayMap` for label lookup and `extractPrimaryArgWithFallbacks` for the argument — both already exist.

### Internal Helpers

- `approvalBullet(action string) string` — green/red/dim `●` based on action
- `connectorLine(action, tc, info) string` — `└ Wrote N lines` / `└ Rejected` / `└ Skipped` / `└ Approved`
- `renderApprovalPreview(tc, info, opts) string` — content preview (up to 10 lines, 4-space indent, dim), extracted via `resolveDisplayContent`
- `approvalVerb(label string) string` — maps label to question verb ("create", "edit", "execute", "delete")
- `approvedSummary(label string, lineCount int) string` — maps label to past-tense result ("Wrote N lines", "Edited N lines", "Created N lines")

### Constants

```go
const maxApprovalPreviewLines = 10
const approvalSeparatorWidth = 24
```

## New File: `pkg/toolrender/render_approval_test.go`

Test matrix covering all combinations:

**RenderApprovalResult:**

- Approved/rejected/skipped x write/edit/create/shell/delete/unknown
- Content preview truncation (>10 lines, <=11 lines smart cutoff, empty content)
- Hyperlinked paths when `HyperlinksEnabled: true`
- Failed tool with error message
- Shell tool: no preview for approved (output streams separately)
- Delete tool: no content preview (just path confirmation)

**ApprovalSeparator:**

- Returns correct width and dim styling

**ApprovalQuestion:**

- Write/edit/shell/delete/unknown tool type → correct verb
- Path extraction from args (primary + fallback fields)
- Missing args → graceful fallback

Estimated: ~30-40 test functions following the existing pattern in `render_compact_test.go` (helper `assertContains`/`assertNotContains`/`stripANSI`).

## File: `pkg/toolrender/BUILD.bazel`

Add `render_approval.go` to `srcs` and `render_approval_test.go` to test `srcs`. No new dependencies — all imports (`lipgloss`, `strings`, `fmt`) already present.

## Why a New File (Not Extending `render_compact.go`)

`[render_compact.go](client-apps/cli/pkg/toolrender/render_compact.go)` is already 578 lines with 6 completed-state renderers, 2 running-state entry points, grouping logic, and 12+ helpers. Adding approval rendering (a distinct concern with its own constants, styles, and helper set) would push it past 700+ lines and mix two responsibilities: "compact status display" vs "approval flow display."

The existing codebase follows SRP per file: `render.go` (entry points + types), `render_compact.go` (compact format), `render_known.go` (legacy known-tool helpers), `hyperlink.go` (OSC 8). A new `render_approval.go` continues this pattern.

## What This Phase Does NOT Touch

- `run_stream_inline.go` — no event handling changes (Phase 3.3)
- `ToolStreamDeltaEvent` interception — still suppressed (Phase 3.3 re-enables for approval tools)
- `handleApproval` rewrite — Phase 3.3
- `InlinePrompter` / `termctl` integration — Phase 3.3
- Shell approval variant — Phase 3.4
- `approvedToolIDs` suppression map — Phase 3.3

## Key Implementation Patterns to Follow

From the existing codebase:

- **Graduated dispatch**: `RenderApprovalResult` routes by tool label via switch, like `RenderCompact`
- `**resolveDisplayContent`** for content extraction — respects `contentSource` (write tools show args, others show result)
- `**buildHyperlinkedPath`** for clickable file paths in headers
- `**dimStyle`/`bulletStyle`/`labelStyle`** for consistent styling
- **Smart cutoff** for truncation (avoid pointless "+1 more")
- `**extractPrimaryArgWithFallbacks`** for arg extraction with framework variance

