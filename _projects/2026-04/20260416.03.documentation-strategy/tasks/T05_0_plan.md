# Task T05: Final Validation and CI Integration

**Created**: 2026-04-16
**Status**: COMPLETE
**Type**: Validation + Infrastructure

## Objective

End-to-end validation of all documentation pipelines and CI gates. Ensure everything works together: CLI docs, Ink SDK docs, OSS path, and README links.

## Task Breakdown

### Step 1: Run All Doc Generation Pipelines
- `make gen-cli-docs` — verify CLI docs regenerate cleanly
- `make gen-ink-sdk-docs` — verify Ink SDK docs regenerate cleanly
- `make gen-react-sdk-docs` — verify React SDK docs still work (no regressions)

### Step 2: Run All Doc Check Targets
- `make gen-cli-docs-check` — verify freshness
- `make gen-ink-sdk-docs-check` — verify freshness
- `make gen-react-sdk-docs-check` — verify no regressions

### Step 3: Run Coverage and Quality Checks
- CLI Go coverage test passes
- `cd sdk/ink && npm run tsdoc:check` passes with zero warnings
- `cd sdk/ink && npm run tsdoc:coverage` reports acceptable coverage
- `cd sdk/react && npm run tsdoc:check` still passes (no regressions)

### Step 4: Validate Docs Site Build
- `cd site && yarn build` succeeds with all new pages
- No broken internal links in Fumadocs build
- Navigation sidebar shows: Getting Started, Guides, SDK (React, Ink, Streaming, Resources), CLI (Overview, Commands), Concepts

### Step 5: Validate README Links
- Every link in README.md resolves (relative file paths and live URLs)
- No 404s from documentation links

### Step 6: Walk the User Journeys
- Cloud path: quickstart → first-skill → connect-tools → create-agent (all steps work)
- Local path: local → first-skill (CLI tab) → connect-tools (CLI tab) → create-agent (CLI tab) (all steps work)
- CLI reference: docs homepage → CLI → command pages (navigation works)
- Ink SDK: docs homepage → SDK → Ink → integration guide + reference pages

## Success Criteria

- [x] All `make gen-*-docs-check` targets pass
- [x] All coverage/quality checks pass
- [x] Site builds without errors
- [x] Both user journeys complete without dead ends
- [x] README has zero broken links

## Dependencies

- T01, T02, T03, T04 all complete
