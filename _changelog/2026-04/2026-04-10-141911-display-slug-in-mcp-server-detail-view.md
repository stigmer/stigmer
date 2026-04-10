# Display Canonical Slug Reference in MCP Server Detail View

**Date**: April 10, 2026

## Summary

Added the canonical `org/slug` reference as a visible element in the MCP server detail view header. Platform users need this identifier for CLI commands (`stigmer get mcp org/slug`), API calls, and cross-referencing — but it was previously hidden when a display name existed.

## Problem Statement

The `McpServerDetailView` header only showed `metadata.name` as the title and `metadata.org` in the metadata row. The slug — the URL-friendly, machine-stable identifier unique within an org — was used internally for routing and API lookups but never surfaced to the user.

### Pain Points

- Users had no way to copy the canonical reference (`org/slug`) from the detail view
- CLI commands like `stigmer get mcp <org/slug>` required users to guess or inspect the URL
- The slug is the stable identifier (names can change), but it wasn't visible

## Solution

Added a monospace `org/slug` line between the title row and the metadata row (dates, badges) in the `Header` component. When only the slug is available (no org), it renders the slug alone.

## Implementation Details

Single addition to the `Header` function in `McpServerDetailView.tsx`:

```tsx
{meta?.slug && (
  <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
    {meta.org ? `${meta.org}/${meta.slug}` : meta.slug}
  </span>
)}
```

Placement: after the title + visibility badge row, before the dates/status metadata row. Uses `font-mono` to visually distinguish the machine identifier from the human-readable display name. `truncate` handles long slugs gracefully.

## Benefits

- Users can see and copy the canonical reference directly from the detail view
- Aligns with the proto documentation: "Combined with org, forms the canonical reference: org/slug"
- Zero additional API calls — slug is already present in the loaded resource metadata

## Impact

- **SDK consumers**: `@stigmer/react` `McpServerDetailView` now shows the slug by default
- **Platform builders**: Embedded detail views will display the reference without additional configuration

---

**Status**: Production Ready
