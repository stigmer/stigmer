# Skill & MCP Server Detail View Components

**Date**: March 20, 2026

## Summary

Implemented `SkillDetailView` and `McpServerDetailView` as SDK-first components in `@stigmer/react`, completing the read-only detail view suite for all three Library resource types (Agent, Skill, MCP Server). Console pages and list-to-detail navigation now provide a consistent browsing experience across the Library.

## Problem Statement

After implementing `AgentDetailView` in Round 1, the Library's Skill and MCP Server resources still lacked detail views — clicking a Skill or MCP Server in the list navigated to an edit session instead of a read-only detail page.

### Pain Points

- No way to view Skill content (SKILL.md) or version/provenance metadata without entering an edit session
- No way to inspect MCP Server configuration, discovered tools, resource templates, or validation state
- Inconsistent navigation: Agent list → detail view, but Skill/MCP Server list → edit session
- Markdown rendering components (`MARKDOWN_COMPONENTS`, `REMARK_PLUGINS`) were defined inline in `MessageEntry.tsx` and needed to be reused without duplication

## Solution

Built two new SDK components following the patterns established by `AgentDetailView`, extracted shared markdown infrastructure, created thin Console page wrappers, and unified list page navigation behavior.

## Implementation Details

### Shared Markdown Infrastructure

Extracted `MARKDOWN_COMPONENTS` (styled overrides for `p`, `a`, `h1`–`h4`, `ul`, `ol`, `li`, `pre`, `code`, `blockquote`, `table`, `th`, `td`, `hr`, `strong`, `em`) and `REMARK_PLUGINS` (`remarkGfm`) from `MessageEntry.tsx` into `sdk/react/src/internal/markdown-components.tsx`. This internal module is consumed by both `MessageEntry` and `SkillDetailView` — not exported in the public SDK API.

### SkillDetailView

Three sections:
- **Header**: Name, tag badge, state badge (Ready/Failed/Uploading with color coding), visibility indicator, creation/update timestamps, description
- **Skill Content**: Full SKILL.md rendered via `react-markdown` with shared `MARKDOWN_COMPONENTS`
- **Version Info**: Truncated version hash (with full hash on hover), Git provenance (linked repository URL with SSH/HTTPS normalization, branch/tag ref, short commit hash, subdirectory)

### McpServerDetailView

Seven conditional sections:
- **Validation Banner**: Destructive alert shown only when `validationState === INVALID`
- **Header**: Icon (if `icon_url` present), name, validation state badge, last discovered timestamp, creation/update timestamps, description
- **Server Configuration**: Type-specific display — stdio (command, args, working directory) or HTTP (URL, timeout). Headers and query params intentionally hidden (may contain `${API_TOKEN}` placeholders).
- **Discovered Tools**: Tool name + description list with count in section title
- **Resource Templates**: Name, URI template, and description
- **Environment Variables**: Alphabetical listing with secret/config badge per entry
- **Tags**: Pill badge display

### Console Pages

Thin client wrappers following the established pattern from `AgentDetailPage`:
- `client-apps/web/src/app/library/skills/[slug]/` — `SkillDetailPage.tsx` + `page.tsx` with `generateStaticParams`
- `client-apps/web/src/app/library/mcp-servers/[slug]/` — `McpServerDetailPage.tsx` + `page.tsx` with `generateStaticParams`

### List Page Navigation

Updated `SkillListPage.tsx` and `McpServerListPage.tsx` to navigate to detail routes (`/library/skills/${slug}`, `/library/mcp-servers/${slug}`) instead of edit session URLs. Removed now-unused `getEditSessionUrl` imports.

### Barrel Exports

`SkillDetailView`, `SkillDetailViewProps`, `McpServerDetailView`, and `McpServerDetailViewProps` exported from module barrels and root `sdk/react/src/index.ts`.

## Benefits

- **Complete Library browsing**: All three resource types now have read-only detail views
- **Consistent UX**: Clicking any resource in any Library list navigates to its detail page
- **SDK-first**: Components are embeddable by platform builders via `@stigmer/react` — no Console dependencies
- **DRY markdown rendering**: Shared module eliminates duplication between chat messages and skill documents
- **Zero new dependencies**: Reuses `react-markdown` and `remark-gfm` already in the dependency tree

## Impact

- **Platform builders**: Can embed `<SkillDetailView>` and `<McpServerDetailView>` in their own apps with minimal configuration (`org` + `slug` props)
- **Console users**: Can browse Skill content and MCP Server configuration directly from the Library
- **SDK API surface**: 4 new exports (`SkillDetailView`, `SkillDetailViewProps`, `McpServerDetailView`, `McpServerDetailViewProps`)

## Related Work

- [Agent detail view component](2026-03-20-185319-agent-detail-view-component.md) — Round 1 that established the patterns used here
- [SDK single-resource data hooks](2026-03-20-183646-sdk-single-resource-data-hooks.md) — `useSkill` and `useMcpServer` hooks consumed by these components
- [Resource list view component](2026-03-20-123150-resource-list-view-component.md) — List pages that now link to these detail views

---

**Status**: ✅ Production Ready
**Timeline**: Session 3 of sub-project 20260320.03.sp.resource-detail-views
