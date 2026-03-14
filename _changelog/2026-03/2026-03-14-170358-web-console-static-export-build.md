# Web Console: Static Export Build Configuration

**Date**: March 14, 2026

## Summary

Configured the Stigmer Web Console for static HTML/CSS/JS export (`output: "export"`), eliminating the Node.js server runtime dependency. The build produces an `out/` directory containing 14 static pages and 4 SSG pages with placeholder pre-renders, ready for `//go:embed` integration in T05. This required removing legacy server-side rendering directives, splitting dynamic routes into server/client component pairs, and working around a Next.js 16 Cache Components limitation.

## Problem Statement

The web console, migrated from stigmer-cloud in T02, was configured for server-side rendering — requiring a Node.js process at runtime. For the OSS distribution model (`stigmer server`), the web UI must be embedded into the Go binary via `//go:embed`, which requires pure static files.

### Pain Points

- `next.config.ts` lacked `output: "export"` — Next.js defaulted to server rendering
- 13 page files exported `const dynamic = "force-dynamic"`, explicitly requesting server-side rendering (legacy from stigmer-cloud's server-side auth)
- 4 dynamic `[id]` route pages had no `generateStaticParams` — required for static export to pre-render paths
- `package.json` `start` script ran `next start`, which requires a Node.js server incompatible with static export
- Dynamic routes used `"use client"` directive, which conflicts with `generateStaticParams` exports in the same file

## Solution

Enabled static export with targeted changes across the codebase: a single config addition, removal of server-rendering directives, and an architectural split for dynamic routes. The result is a zero-dependency static build that completes in ~6 seconds and produces all routes as pre-rendered HTML.

## Implementation Details

### 1. Next.js Configuration

Added `output: "export"` to `next.config.ts` — the single switch that enables static site generation.

### 2. Removed `force-dynamic` Directives

Removed `export const dynamic = "force-dynamic"` from 13 page files. This directive was a legacy from stigmer-cloud where server-side auth required every page to be dynamically rendered. With the configurable auth module (T03) operating entirely client-side, these directives were obsolete.

**Files cleaned**: `agents/page.tsx`, `catalog/page.tsx`, `draft/agent/page.tsx`, `draft/mcp-server/page.tsx`, `draft/skill/page.tsx`, `mcp-servers/page.tsx`, `run/page.tsx`, `sessions/page.tsx`, `skills/page.tsx`, and 4 dynamic `[id]/page.tsx` files.

### 3. Server/Client Split for Dynamic Routes

Next.js 16 (Turbopack) explicitly rejects `generateStaticParams` in files with `"use client"`. Each of the 4 dynamic routes was split into two files:

```
agents/[id]/
  page.tsx              — Server component: exports generateStaticParams, renders client component
  AgentDetailPage.tsx   — Client component: "use client", useParams(), full page logic
```

The server `page.tsx` is minimal — it imports and renders the client component. The client component contains the original page logic unchanged.

### 4. Placeholder Params Workaround

Next.js 16's Cache Components feature (enabled by default) rejects `generateStaticParams` returning an empty array `[]`. Since these dynamic routes have no build-time-known IDs (all data is fetched at runtime), a placeholder is used:

```typescript
export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}
```

This generates a harmless pre-rendered page at `/<route>/__placeholder__/` that shows an error state when accessed (no resource with that ID exists).

### 5. Updated Start Script

Changed `package.json` `start` from `next start` (requires Node.js server) to `npx serve out` (serves static files).

## Build Output

```
Route (app)                    Type
├ ○ /                          Static
├ ○ /agents                    Static
├ ● /agents/[id]               SSG → /agents/__placeholder__/
├ ○ /catalog                   Static
├ ○ /draft/agent               Static
├ ○ /draft/mcp-server          Static
├ ○ /draft/skill               Static
├ ○ /mcp-servers               Static
├ ● /mcp-servers/[id]          SSG → /mcp-servers/__placeholder__/
├ ○ /run                       Static
├ ○ /sessions                  Static
├ ● /sessions/[id]             SSG → /sessions/__placeholder__/
├ ○ /skills                    Static
└ ● /skills/[id]               SSG → /skills/__placeholder__/
```

## Benefits

- **Zero runtime dependency**: No Node.js server required — static files can be served by any HTTP server or embedded in a Go binary
- **Fast builds**: ~6 seconds for full static export
- **Embedding-ready**: `out/` directory is the exact artifact that T05 will embed via `//go:embed`
- **Clean architecture**: Server/client split for dynamic routes is the idiomatic Next.js pattern and will remain correct as the app evolves
- **Backward compatible**: `npm run dev` still works identically for development

## Impact

- **T05 unblocked**: The static `out/` directory is the prerequisite for Go binary embedding
- **Build pipeline**: `npm run build -w client-apps/web` now produces deployable static artifacts
- **16 files modified**, **4 files created** across `client-apps/web/`

## Surprises & Learnings

- **Cache Components limitation**: Next.js 16 enables Cache Components by default, which changes validation behavior for `generateStaticParams`. Empty arrays are rejected with a misleading error message ("missing generateStaticParams") instead of indicating the array is empty. The `__placeholder__` workaround is documented in Next.js official docs but not prominently.
- **Misleading error messages**: The error "Page is missing generateStaticParams()" can mean either (a) the function is not exported, or (b) it returns an empty array. This cost significant debugging time.

## Related Work

- [TypeScript Proto Codegen Setup](2026-03-14-154913-typescript-proto-codegen-setup.md) — T01
- [Migrate Web Console to OSS](2026-03-14-160705-migrate-web-console-to-oss.md) — T02
- [Web Console Configurable Auth](2026-03-14-162620-web-console-configurable-auth.md) — T03
- T05 (next): Embed Web UI in stigmer-server via `//go:embed`

---

**Status**: ✅ Production Ready
**Timeline**: Part of 20260314.03.web-console-oss-migration (T04 of 7)
