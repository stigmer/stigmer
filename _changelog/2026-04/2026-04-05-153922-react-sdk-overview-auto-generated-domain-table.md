# React SDK Overview: Auto-Generated Domain Table

**Date**: April 5, 2026

## Summary

Replaced the hand-maintained hook and component counts on the React SDK overview page with an auto-generated table driven by TypeDoc data. The existing docs generator already classified every export by domain — this change captures that data into a JSON file and renders it via a React component, eliminating manual counting whenever the SDK surface changes.

## Problem Statement

The React SDK overview page (`docs/sdk/react/index.mdx`) hardcoded two sets of numbers:

1. An intro paragraph claiming "67 React hooks and 59 UI components"
2. A 15-row domain summary table with per-domain hook and component counts

### Pain Points

- Every new hook or component required manually recounting and updating both the intro and the table
- Numbers drifted silently — no CI check caught stale counts
- The aggregate count ("67 hooks, 59 components") was a vanity metric that added no decision-making value for the reader

## Solution

Extended the React SDK docs generator to emit a `react-sdk-summary.json` data file, created a `ReactSdkDomains` component that renders the domain table from that data, and rewrote the overview page to use the component instead of a hand-written table.

## Implementation Details

### Generator extension (`site/scripts/generate-react-sdk-docs/`)

- Added `renderSummaryJson()` to `renderer.ts` — produces a JSON array of domain entries (slug, title, description, hook count, component count), filtering out the `core` domain
- Updated `index.ts` to write the summary to `site/src/data/react-sdk-summary.json` after generating per-domain MDX pages
- Runs as part of the existing `make gen-react-sdk-docs` pipeline — no new build targets needed

### React component (`site/src/components/docs/ReactSdkDomains.tsx`)

- Static import of the generated JSON (zero runtime cost on a static export site)
- Renders an HTML table with linked domain names, descriptions, and counts
- Displays `—` for zero counts, matching the existing convention
- Registered in `mdx.tsx` alongside existing custom MDX components

### Overview page rewrite (`docs/sdk/react/index.mdx`)

- Intro paragraph: removed hardcoded "67 hooks and 59 components", replaced with "React hooks and UI components for every domain in the Stigmer API"
- Domain table section: replaced 15-row markdown table with `<ReactSdkDomains />`
- All other sections (Installation, Setup, Deployment mode, StigmerProvider, What's next) untouched

## Benefits

- **Zero-maintenance counts**: hook and component numbers update automatically whenever the generator runs
- **Single source of truth**: domain metadata lives in `DOMAIN_META` in `parser.ts`, descriptions flow through to both the per-domain pages and the overview table
- **New domains appear automatically**: adding a new domain folder to `sdk/react/src/` and running the generator adds it to the overview table without editing `index.mdx`
- **Consistent with existing patterns**: uses the same custom MDX component registration pattern as `TypeTable`, `ComponentPreview`, and other site components

## Impact

- **Docs maintainers**: no longer need to count exports or update the overview page when the SDK surface changes
- **SDK developers**: adding hooks or components to any domain automatically reflects in the published docs after the next generator run
- **End users**: see the same domain table with accurate, up-to-date counts

## Related Work

- Builds on the React SDK auto-generation pipeline from project `20260403.03.sdk-docs-auto-generation`
- The `tsdoc-coverage.ts` script uses the same TypeDoc classification logic independently

---

**Status**: ✅ Production Ready
