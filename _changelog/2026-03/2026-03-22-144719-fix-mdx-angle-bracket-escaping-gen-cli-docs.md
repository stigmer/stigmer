# Fix MDX Angle-Bracket Escaping in gen-cli-docs

**Date**: March 22, 2026

## Summary

Fixed three classes of MDX build errors in the auto-generated CLI reference documentation by adding an `escapeMDX` function to the `gen-cli-docs` generator. Bare `<placeholder>` tokens, bash process substitution `<(`, and curly braces `{ }` in prose paragraphs were being parsed as JSX by the MDX compiler, breaking the entire docs site.

## Problem Statement

After the CLI reference docs were generated (Session 10, T12), navigating to any CLI command page in the docs site produced a fatal build error:

```
apikey.mdx:13:1-15:11: Expected a closing tag for <id> (14:69-14:73) before the end of 'paragraph'
```

### Pain Points

- The docs site was completely broken for CLI reference pages — build errors prevented rendering
- Three separate MDX-unsafe patterns existed across the generated output:
  1. `<id>`, `<agent-ref>`, `<name-or-id>` — CLI placeholders parsed as JSX elements
  2. `source <(stigmer completion bash)` — bash process substitution parsed as JSX
  3. `{ "command": "stigmer" }` — JSON examples with curly braces parsed as JSX expressions
- The generator had no awareness of MDX syntax constraints

## Solution

Added an `escapeMDX` function to the generator that makes prose text safe for MDX using a two-pass approach:

1. **First pass**: Regex matches bare `<placeholder>` tokens and wraps them in backticks for inline-code rendering (e.g., `<id>` becomes `` `<id>` ``)
2. **Second pass**: Character-by-character scan that backslash-escapes remaining `<`, `{`, `}` characters, tracking backtick code spans to avoid double-escaping

## Implementation Details

### Generator changes (`client-apps/cli/cmd/gen-cli-docs/main.go`)

- Added `angleBracketRe` compiled regex: `<([a-zA-Z][a-zA-Z0-9_-]*)>`
- Added `escapeMDX` function (~20 lines) with two-pass escaping logic
- Applied `escapeMDX` in `formatLongDescription` (Cobra `Long` description prose)
- Applied `escapeMDX` in `escapeTable` (table cell text for `Short` descriptions and flag usage)

### Regenerated output

All 20 command pages + index were regenerated, affecting 22 files total. The diff is mostly whitespace normalization from the improved Cobra description formatting, plus the MDX escaping.

## Benefits

- CLI reference docs render without errors across all 20 command pages
- `<placeholder>` tokens display as styled inline code (visual improvement)
- Generator is now resilient to any future Cobra descriptions containing MDX-unsafe characters
- No manual post-processing or MDX knowledge required from CLI developers writing command descriptions

## Impact

- **Docs site**: Unblocked — all CLI command reference pages render cleanly
- **Developer experience**: CLI developers can freely use `<placeholder>`, `{`, and `<(` syntax in Cobra descriptions without worrying about MDX compatibility
- **CI**: The `gen-cli-docs-check` freshness job will catch any future regressions

---

**Status**: Production Ready
