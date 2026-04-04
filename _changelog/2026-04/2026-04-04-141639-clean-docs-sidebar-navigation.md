# Clean Up Documentation Sidebar Navigation

**Date**: April 4, 2026

## Summary

Removed premature separator headings ("Learn", "Reference", "Resources") from the docs sidebar and restructured SDK Reference so that API resource pages live in a collapsible `resources/` subdirectory. This also fixes a codegen overwrite issue where `sdk_docs.go` would silently destroy hand-authored navigation entries.

## Problem Statement

The docs sidebar used Fumadocs `---Label---` separators to create section headings. These separators render as flat, non-interactive labels — they cannot be collapsed, expanded, or clicked.

### Pain Points

- "Learn" grouped exactly one item (Concepts). "Reference" grouped exactly one item (SDK Reference). Both added visual noise without organizational benefit.
- "Resources" appeared as a static label inside SDK Reference with 18 resource pages listed below it, creating an overwhelming uncollapsible list.
- `sdk_docs.go` overwrites `docs/sdk/meta.json` on every codegen run, silently destroying hand-added `"streaming"` and `"---Resources---"` entries.

## Solution

1. **Remove root-level separators** — the three sidebar items (Getting started, Concepts, SDK Reference) are self-descriptive and need no category headings at this scale.
2. **Create `docs/sdk/resources/` subdirectory** — moves 18 resource `.mdx` files into a real Fumadocs folder node, making the group collapsible in the sidebar.
3. **Retarget codegen** — `sdk_docs.go` and the Makefile now output to `docs/sdk/resources/`, cleanly separating auto-generated content from hand-authored files (`streaming.mdx`, `index.mdx`).

## Implementation Details

- **`docs/meta.json`**: Removed `"---Learn---"` and `"---Reference---"` separator entries.
- **`docs/sdk/resources/`**: Created subdirectory with its own `meta.json` (title: "Resources") listing all 18 resource pages.
- **`docs/sdk/meta.json`**: Now hand-maintained with just `"streaming"` and `"resources"` — codegen no longer touches it.
- **`tools/codegen/generator/sdk_docs.go`**: `docWriteMetaJSON` writes title `"Resources"` instead of `"SDK Reference"`. All `/docs/sdk/commons` link references updated to `/docs/sdk/resources/commons`.
- **`Makefile`**: `gen-sdk-docs` and `gen-sdk-docs-check` targets updated to use `docs/sdk/resources` as the output directory.
- **Cross-links**: Updated all internal links in `streaming.mdx`, `index.mdx`, and all 17 resource pages to use the new `/docs/sdk/resources/` URL prefix.

## Benefits

- Cleaner sidebar with no unnecessary visual noise at the root level.
- Resource pages are now collapsible, reducing sidebar scroll for readers who are not browsing resources.
- Codegen and hand-authored content are cleanly separated — running `make gen-sdk-docs` no longer risks overwriting navigation structure.
- URL paths (`/docs/sdk/resources/agent`) accurately reflect the information hierarchy.

## Impact

- **Docs readers**: Simpler sidebar navigation, collapsible Resources group.
- **Docs maintainers**: Codegen output isolation removes a class of accidental overwrites.
- **CI**: `gen-sdk-docs-check` updated to compare against the new path.
- **URLs**: Resource page paths changed from `/docs/sdk/<resource>` to `/docs/sdk/resources/<resource>`. No external links are known to be affected at this stage.

## Related Work

- SDK docs auto-generation project (`_projects/2026-04/20260403.03.sdk-docs-auto-generation`)
- Streaming how-to guide (2026-04-04-140132)
- SDK overview landing page (2026-04-04-133544)

---

**Status**: Production Ready
