# LLM-Friendly Documentation Output (T17)

**Date**: March 24, 2026

## Summary

Added LLM-friendly documentation output following the llms.txt standard. The build pipeline now generates `llms.txt`, `llms-full.txt`, and per-page `.md` files so LLM agents and AI tools can consume Stigmer documentation as clean text. A "Copy as Markdown" button on each doc page lets users share documentation context with AI tools.

## Problem Statement

LLM agents and AI-powered developer tools increasingly need structured access to documentation. HTML pages are noisy — navigation, scripts, and layout markup dilute the actual content. Without a standardized machine-readable format, AI tools must scrape and parse HTML, leading to incomplete or inaccurate context ingestion.

### Pain Points

- No machine-readable documentation format for LLM agents
- Users copying docs content for LLM context had to manually strip HTML formatting
- Sitemap only listed the home page, missing all 57 documentation pages
- No vocabulary entries for LLM-related terms in Vale

## Solution

A post-build TypeScript script generates three LLM output formats after `next build`, following the [llms.txt standard](https://llmstxt.org). A client-side React component provides "Copy as Markdown" functionality on every documentation page.

## Implementation Details

### Post-Build Script (`site/scripts/generate-llms-txt.ts`)

- Scans `docs/` recursively for `.mdx` files, respecting `meta.json` ordering at every level (root sections, section pages, nested directories like `cli/commands/`)
- Parses frontmatter with `gray-matter` for title and description
- Content cleaning pipeline: strips frontmatter, `import`/`export` statements, and MDX comments (`{/* */}`). Deliberately preserves semantic JSX tags (`<Callout>`, `<Tabs>`, `<Term>`) because LLMs understand them as semantic markup
- Generates into `out/`:
  - `llms.txt` (7.3 KB) — curated index with H1 project name, blockquote description, H2 sections with page links and descriptions, "Optional" section for CLI command reference and contributing
  - `llms-full.txt` (89.5 KB) — all 57 pages concatenated with source URLs and `---` separators
  - 57 per-page `.md` files at `out/docs/**/*.md`

### "Copy as Markdown" Button

- Client component at `site/src/components/docs/copy-markdown-button.tsx`
- Fetches the `.md` variant of the current page and copies content to clipboard
- Visual feedback: Copy icon transitions to Check icon for 2 seconds
- Accessible: `aria-label`, keyboard focusable, visible focus ring

### Build Pipeline

- `yarn build` now runs: `generate-images → next build → generate-llms-txt`
- Standalone: `yarn generate-llms` or `make gen-llms`

### Sitemap Enhancement

- `sitemap.ts` now dynamically includes all doc pages via `source.getPages()`
- Includes `llms.txt` as a discoverable entry with priority 0.3

### Key Architecture Decision

`fumadocs-core@15.8.5` does NOT have the built-in `llms()` function or `getText('processed')` API shown in the Fumadocs v16+ docs. We cannot upgrade to v16 (requires Next.js 16 / React 19.2+). The post-build script approach is version-independent and handles per-page `.md` file generation which isn't achievable via route handlers with static export.

## Benefits

- LLM agents can discover Stigmer docs via `/llms.txt` and ingest all content via `/llms-full.txt`
- Individual pages accessible as clean markdown at `{page-url}.md`
- Users can copy any doc page as markdown for LLM context sharing with one click
- Sitemap now includes all 57 doc pages for search engine discovery
- Build time increase is negligible (under 1 second for 57 files)

## Impact

- **LLM agents**: Can now consume Stigmer documentation through the standardized llms.txt protocol
- **Users**: One-click "Copy as Markdown" for sharing docs with AI tools
- **SEO**: Sitemap expanded from 1 page to 59 entries
- **Documentation infrastructure**: Phase 5 (Advanced Features) now 2/4 complete

## Related Work

- T16: Custom MDX Components (Session 12) — the Mermaid, Callout, Tabs, and Term components whose tags are preserved in LLM output
- T14: CI Quality Gates (Session 5) — the docs CI workflow that validates the build including LLM output generation

---

**Status**: ✅ Production Ready
**Timeline**: Single session (Session 14)
