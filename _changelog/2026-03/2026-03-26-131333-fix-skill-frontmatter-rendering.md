# Fix Skill YAML Frontmatter Rendering in Skill Detail View

**Date**: March 26, 2026

## Summary

Fixed the Skill Detail View in `@stigmer/react` to strip YAML frontmatter before rendering skill markdown content. The `name` and `description` fields from the frontmatter block were being displayed as raw text in the "SKILL CONTENT" section instead of being hidden, since `react-markdown` does not parse YAML frontmatter natively.

## Problem Statement

SKILL.md files use standard YAML frontmatter (a `---` delimited metadata block at the top) to declare `name` and `description`. The backend stores the entire SKILL.md content in `spec.skill_md` as-is, while separately extracting the frontmatter fields into dedicated proto fields (`spec.name`, `spec.description`) that the header already displays.

### Pain Points

- The "SKILL CONTENT" section rendered the raw frontmatter (`name: agent-creator description: > ...`) as a plain text paragraph at the top of the skill body
- This created visual noise and redundancy — the same metadata was shown twice: once properly in the header, and once as unformatted text in the content area
- The issue affected every skill with frontmatter (all standard SKILL.md files)

## Solution

Added a `stripFrontmatter` utility that removes the YAML frontmatter block from markdown content before passing it to `react-markdown`. The approach uses the same regex pattern already proven in `detect-skill-package.ts` within the SDK, requires no new dependencies, and is scoped to skill content only — it does not affect the shared markdown rendering pipeline used by chat messages.

## Implementation Details

- **`sdk/react/src/internal/markdown-components.tsx`**: Added `stripFrontmatter` utility function alongside the existing `REMARK_PLUGINS` and `MARKDOWN_COMPONENTS` exports. Uses a regex (`/^---\r?\n[\s\S]*?\r?\n---\r?\n?/`) to match and remove the frontmatter block.
- **`sdk/react/src/skill/SkillDetailView.tsx`**: Updated `SkillContentSection` to call `stripFrontmatter(content)` before passing content to the `Markdown` component.

Design decisions:
- Chose a simple regex strip over adding `remark-frontmatter` as a dependency to keep the SDK bundle lean
- Kept the fix in the frontend rather than altering the backend `skill_md` storage semantics, which would have required a data migration
- Placed the utility in the shared markdown-components module for potential reuse by other markdown surfaces that may encounter frontmatter

## Benefits

- Clean skill content rendering — the "SKILL CONTENT" section now starts at the actual content heading (e.g., `# Agent Creator`)
- No redundant metadata display
- Zero new dependencies added to `@stigmer/react`
- No impact on chat message markdown rendering

## Impact

- **SDK consumers**: Platform builders embedding `SkillDetailView` will see correctly rendered skill content without raw frontmatter
- **Console users**: Skill detail pages in the Stigmer Console display clean, properly formatted content
- **Scope**: 2 files in `sdk/react`

---

**Status**: ✅ Production Ready
