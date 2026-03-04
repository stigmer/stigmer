---
name: Phase 2.4 Other Tools
overview: Add compact renderers for the remaining 5 tool labels (List, Find, Search, Delete, Thinking) so that every known tool in toolDisplayMap has a compact renderer. After this, only unknown/MCP tools and Task (Phase 2.5) fall back to RenderWithBadge.
todos:
  - id: discovery-renderer
    content: Implement renderCompactDiscovery + countResultEntries + discoverySummary for List/Find/Search labels
    status: completed
  - id: delete-renderer
    content: Implement renderCompactDelete for Delete label with hyperlinked path
    status: completed
  - id: think-renderer
    content: Implement renderCompactThink with thought body truncation (maxThinkLines=3, smart cutoff)
    status: completed
  - id: refactor-routing
    content: Refactor RenderCompact to switch-on-label, update RenderCompactRunning for pattern/label-only, update hasCompactRenderer
    status: completed
  - id: tests
    content: Add ~25-30 tests covering all new renderers (completed, failed, running, edge cases)
    status: completed
  - id: verify
    content: Run go vet + go test to verify everything compiles and passes
    status: completed
isProject: false
---

# Phase 2.4: Other Tools Compact Rendering

## Scope

Five tool labels need compact renderers. After this phase, `RenderWithBadge` is only reached by unknown/MCP tools and "Task" (Phase 2.5).


| Label    | Tool names                   | Primary field | Compact format                           |
| -------- | ---------------------------- | ------------- | ---------------------------------------- |
| List     | `list_directory`, `ls`       | `path`        | path (hyperlinked) + "N entries"         |
| Find     | `glob`                       | `pattern`     | pattern (plain text) + "Found N matches" |
| Search   | `grep`                       | `pattern`     | pattern (plain text) + "Found N matches" |
| Delete   | `delete_file`, `remove_file` | `path`        | path (hyperlinked) + "Deleted"           |
| Thinking | `think`                      | *(none)*      | label only + up to 3 lines of thought    |


## Target Output

### Discovery (List, Find, Search) — completed

```
● List(src/)
    12 entries
● Find(*.go)
    Found 15 matches
● Search(TODO)
    Found 8 matches
```

Failed: `● Find(*.go)` / `✗ no readable directories`
Empty: `● Find(*.proto)` / `(no matches)` or `● List(empty/)` / `(empty)`

### Delete — completed

```
● Delete(tmp/old.go)
    Deleted
```

Failed: `● Delete(tmp/old.go)` / `✗ permission denied`

### Think — completed

```
● Thinking
    The user wants to refactor the module structure.
    I should consider the existing patterns in the
    codebase before making changes.
    … +5 more lines
```

Empty thought: `● Thinking` / `(no content)`

### Running state (all new tools)

```
● List(src/) …
● Find(*.go) …
● Search(TODO) …
● Delete(tmp/old.go) …
● Thinking …
```

## Key Design Decisions

### 1. Discovery tools show count-only (confirmed)

Discovery is reconnaissance input to the agent, not output for the user. Count provides scope awareness. Maintains the visual density hierarchy where shell is densest and reads are lightest.

### 2. Item counting uses non-empty lines, not `countLines`

`countLines` is designed for file content (trailing newline = one more line). Discovery results need `countNonEmptyLines` — split on `\n`, trim trailing newline, count entries. Same pattern already used by `renderCompactShell` (`strings.Split(strings.TrimRight(content, "\n"), "\n")`).

### 3. Think header has no parens — intentional visual break

Think has no `primaryField` in `toolDisplayMap`. Rather than forcing `Thinking()` with empty parens, render as just `● Thinking` followed by thought body. This is the only tool where the header drops the `Label(arg)` pattern — correct, because the thought is the body, not a parameter.

### 4. RenderCompact refactored from if-cascade to switch-on-label

With 6 tool categories, the if-cascade is getting unwieldy. A `switch info.label` with case lists (e.g., `case "Write", "Create", "Edit":`) is cleaner and keeps `hasCompactRenderer` in sync. This is a readability improvement, not an architecture change — same routing logic, better structure.

### 5. RenderCompactRunning needs nuanced display logic

Current binary split (shell = truncate command, everything else = hyperlink path) must expand:

- **Shell**: `truncate(firstLine(cmd), 60)` *(existing)*
- **Pattern-based** (Find, Search): `truncate(pattern, 60)` — plain text, not hyperlinked
- **Path-based** (List, Delete, Read, Write, Edit): `buildHyperlinkedPath(path, opts)` *(existing)*
- **Label-only** (Thinking): no parens, just `● Thinking …`

New helper `isPatternBasedLabel(label)` returns true for "Find", "Search" — avoids coupling to field names.

### 6. No changes to run_stream_inline.go

The graduated routing from Phases 2.1-2.3 handles this automatically. `RenderCompact` and `RenderCompactRunning` pick up the new tools without any changes to the event handler. No running state suppression for new tools — discovery, delete, and think all show their running indicator.

## Files Modified

### [render_compact.go](client-apps/cli/pkg/toolrender/render_compact.go)

- Add `maxThinkLines = 3` constant
- Add `isDiscoveryLabel(label)` helper — returns true for "List", "Find", "Search"
- Add `isPatternBasedLabel(label)` helper — returns true for "Find", "Search" (pattern primary field, not a file path)
- Add `renderCompactDiscovery(tc, info, opts)` — header + count summary
- Add `renderCompactDelete(tc, info, opts)` — header + "Deleted"
- Add `renderCompactThink(tc, info, opts)` — label-only header + thought body (truncated)
- Add `countResultEntries(content)` — counts non-empty lines in discovery output
- Add `discoverySummary(label, count)` — maps label to count text ("12 entries", "Found 15 matches")
- Refactor `RenderCompact` from if-cascade to `switch info.label`
- Refactor `RenderCompactRunning` to handle pattern-based and label-only tools
- Update `hasCompactRenderer` to include "List", "Find", "Search", "Delete", "Thinking"

### [render_compact_test.go](client-apps/cli/pkg/toolrender/render_compact_test.go)

New test sections (~25-30 tests):

- **Discovery completed**: basic format for list/find/search, count accuracy, empty results, failed, long errors, hyperlinks on List path, no hyperlinks on Find/Search pattern, aliases
- **Delete completed**: basic format, hyperlinked path, failed, empty error
- **Think completed**: basic format, truncation at 3 lines, smart cutoff (4 lines = show all), empty thought, failed
- **Running state**: discovery with pattern, discovery with path, delete, think (no parens)
- **hasCompactRenderer**: verify all labels return true, Task returns false

### Not modified

- `run_stream_inline.go` — graduated routing picks up automatically
- `render.go` / `toolDisplayMap` — all tool entries already exist
- `BUILD.bazel` — no new files

