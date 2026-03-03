# Other Tools Compact Rendering (Phase 2.4)

**Date**: March 4, 2026

## Summary

Added compact renderers for the remaining tool categories — Discovery (List, Find, Search), Delete, and Thinking — completing the compact rendering layer for all known tool types in the inline CLI. Every tool call now displays as a concise, scannable one-to-two-line summary instead of the verbose badge-based format, bringing the Stigmer CLI's inline experience in line with the Claude Code aesthetic.

## Problem Statement

After Phases 2.1–2.3 delivered compact renderers for Read, Write/Edit, and Shell tools, four tool categories still fell back to the verbose `RenderWithBadge` format: discovery tools (List, Find, Search), Delete, and Thinking. This created an inconsistent visual experience where some tool calls were compact and others were not.

### Pain Points

- Discovery tools (glob, grep, list directory) showed full badge chrome for what is essentially a single count
- Delete confirmations displayed with unnecessary verbosity
- The Thinking tool (agent reasoning) had no visual distinction from other tools
- Pattern-based arguments (glob, regex) were being hyperlinked as file paths, producing broken `file://` URIs

## Solution

Implemented three specialized compact renderers that follow the established `● Label(primary) summary` pattern while respecting each tool category's unique display needs:

- **Discovery**: Count-only summary (e.g., `● Find(*.go) Found 12 matches`)
- **Delete**: Path with confirmation (e.g., `● Delete(/tmp/file.txt) Deleted`)
- **Thinking**: Label-only header with truncated body (e.g., `● Thinking` followed by indented thought lines)

## Implementation Details

### New Renderers

- `renderCompactDiscovery` — Handles List, Find, and Search tools. Path-based tools (List) get OSC 8 hyperlinks; pattern-based tools (Find, Search) display the pattern as plain text. Result is a count summary via `discoverySummary`.
- `renderCompactDelete` — Displays the target path (hyperlinked) with a "Deleted" confirmation. Failed deletions show `✗` with error text.
- `renderCompactThink` — Unique format: no parenthesized argument (the thought is the body, not a parameter). Shows up to 3 lines of thought content with smart cutoff truncation.

### Routing Refactor

`RenderCompact` refactored from an if-cascade to a switch-on-label with 6 branches (Read, Write/Edit, Shell, Discovery, Delete, Thinking). `RenderCompactRunning` expanded to three display paths: pattern-based (plain text), path-based (hyperlinked), and label-only (Thinking without parens).

### Helpers

- `countResultEntries` — Counts non-empty lines in discovery results (differs from `countLines` which is designed for file content)
- `discoverySummary` — Label-aware summary formatting ("N entries" for List, "Found N matches" for Find/Search)
- `isDiscoveryLabel`, `isPatternBasedLabel` — Predicates for routing and display decisions

### Test Coverage

51 new test functions covering completed, running, failed, and edge-case states for all three renderers, plus helper function verification.

## Benefits

- **Complete compact coverage**: All 11 known tool labels now have dedicated compact renderers. Only the "Task" label (Phase 2.5, sub-agents) remains on the legacy path.
- **Consistent visual hierarchy**: Dense shell output for user-relevant actions, lighter read/write summaries, lightest discovery counts — each tool type communicates its role through visual density.
- **Zero integration changes**: The graduated routing pattern in `run_stream_inline.go` picked up all new tools automatically, validating the architecture established in Phase 2.1.
- **Pattern safety**: Glob and regex patterns are never wrapped in `file://` URIs, preventing broken hyperlinks.

## Impact

- **CLI users** see a consistent, scannable inline experience across all tool types
- **Future maintainers** have a clear switch-based routing structure and established patterns for adding new tool renderers
- **Phase 2.5** (sub-agent grouping) is the final piece before the inline experience is feature-complete

## Related Work

- Phase 2.0: OSC 8 Hyperlink Foundation
- Phase 2.1: Read Tool Compact Rendering
- Phase 2.1b: Read Tool Consecutive-Event Grouping
- Phase 2.2: Write/Edit Tool Compact Rendering
- Phase 2.3: Shell Tool Compact Rendering
- Phase 2.5 (next): Sub-Agent Tool Grouping

---

**Status**: ✅ Production Ready
**Timeline**: Single session (~2 hours)
