# Open-Source Getting Started Path — Two Doors, One House

**Date**: April 16, 2026

## Summary

Made the local/OSS getting-started path a first-class citizen in the docs site. The local quickstart is now visible in the sidebar, linked from the docs homepage, and cross-referenced from the cloud quickstart. Follow-on tutorials (first-skill, connect-tools, create-agent) now guide local users through the same web console + SDK experience with a single "Running locally?" callout per page.

## Problem Statement

The local quickstart (`local.mdx`) existed but was invisible and dead-ended.

### Pain Points

- `local.mdx` was not listed in `getting-started/meta.json` — it never appeared in the docs sidebar
- `local.mdx` was not on the docs homepage — OSS users visiting the docs saw only the cloud path
- `local.mdx` linked to "Your first Skill" as a next step, but `first-skill.mdx` assumed cloud prerequisites (SDK project from the cloud quickstart, `app.stigmer.ai` URLs, `STIGMER_API_KEY` in run commands)
- No cross-references existed between cloud and local quickstarts

## Solution

**Strategy: "Two doors, one house."** Two quickstart entry points (cloud and local) that diverge on setup, then converge on the same web console + SDK tutorial experience. The local Stigmer server runs the same web console at `localhost:8234`, so the follow-on tutorials work identically — only the URL and authentication differ.

Rather than heavy Cloud/CLI dual-track tabs (which would have created nested tabs and doubled page length), each tutorial page gets a single callout covering both differences: substitute `localhost:8234` for `app.stigmer.ai`, and drop the `STIGMER_API_KEY` prefix from run commands.

## Implementation Details

### Navigation wiring
- Added `"local"` to `getting-started/meta.json` between `quickstart` and `first-skill` (cloud first per positioning Decision 3)
- Added Local Quickstart card to `docs/index.mdx` after the cloud Quickstart card

### Cross-references
- Added `<Callout>` to `quickstart.mdx` linking to the Local Quickstart
- Added `<Callout>` to `local.mdx` linking to the Cloud Quickstart

### SDK gap bridge
- Added web console mention to `local.mdx` ("What just happened" section) introducing `localhost:8234` as the bridge to follow-on tutorials
- Added collapsible SDK setup accordion to `local.mdx` with local connection code for all 4 SDK languages (TypeScript, Go, Python, Java)
- Added matching SDK setup accordion to `first-skill.mdx` for local users who skipped the optional step

### Tutorial convergence
- Updated prerequisites in `first-skill.mdx` to accept either quickstart
- Added "Running locally?" callout to `first-skill.mdx`, `connect-tools.mdx`, and `create-agent.mdx` covering URL substitution and API key removal

## Benefits

- OSS users can now discover and follow the local path from the docs homepage and sidebar
- The full getting-started journey works end-to-end for local users: local → first-skill → connect-tools → create-agent
- No tutorial step assumes a cloud account, API key, or org slug without the callout covering the local alternative
- Minimal page complexity — one callout per page instead of nested tabs

## Impact

- **Docs site**: 7 files modified (269 insertions, 6 deletions)
- **Users affected**: OSS/local-first users who install via Homebrew and run `stigmer server`
- **Existing cloud path**: No regressions — cloud quickstart and tutorials unchanged in substance

## Related Work

- Part of project `20260416.03.documentation-strategy` (T02)
- T01 (CLI Reference Docs) runs in parallel
- Follows information architecture and positioning decisions from the content strategy project (`20260331.01`)

---

**Status**: ✅ Production Ready
