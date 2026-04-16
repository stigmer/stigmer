# Next Task: 20260416.03.documentation-strategy

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260416.03.documentation-strategy

**Description**: Comprehensive documentation strategy covering CLI reference docs with quality gates, Ink SDK reference and integration guide, README overhaul aligned with content strategy, and open-source getting-started path as a first-class citizen in the docs site.

**Goal**: Deliver production-quality documentation across four areas: (1) CLI reference with auto-generation, coverage checks, and CI validation, (2) Ink SDK reference docs and hand-written integration guide mirroring the React SDK pattern, (3) README restructured and aligned with content strategy positioning, (4) open-source/local getting-started path visible and complete in docs navigation.

**Tech Stack**: Go/Cobra (CLI docs), TypeScript/TypeDoc (Ink SDK docs), MDX/Fumadocs (docs site), Makefile (CI)

## Task Overview

| Task | Description | Status | Dependencies |
|------|-------------|--------|-------------|
| T01 | CLI Reference Docs — content quality, generation, docs site, CI | COMPLETE | None |
| T02 | Open-Source Getting Started Path — visibility, callouts, SDK bridge | COMPLETE | None (parallel with T01) |
| T03 | Ink SDK Reference Docs — TypeDoc setup, generator, integration guide | COMPLETE | T01 (nav structure) |
| T04 | README Overhaul — restructure, align positioning, fix links | COMPLETE | T01, T02, T03 |
| T05 | Final Validation — end-to-end checks, CI, journey validation | COMPLETE | T01–T04 |

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/checkpoints/
```

### 2. Current Task Plans
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/tasks/T01_0_plan.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/tasks/T02_0_plan.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/tasks/T03_0_plan.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/tasks/T04_0_plan.md
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/tasks/T05_0_plan.md
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/README.md`

## Key Codebase References

### CLI Documentation Pipeline
- Generator: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/cmd/gen-cli-docs/main.go`
- Cobra commands: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root/*.go`
- CLI Makefile: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/Makefile`

### React SDK Pipeline (analog to follow)
- TypeDoc config: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/react/typedoc.json`
- TSDoc coverage: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/react/scripts/tsdoc-coverage.ts`
- Docs generator: `/Users/suresh/scm/github.com/stigmer/stigmer/site/scripts/generate-react-sdk-docs/`
- Hand-written guide: `/Users/suresh/scm/github.com/stigmer/stigmer/docs/sdk/react/index.mdx`

### Ink SDK
- Source: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/ink/src/`
- Barrel exports: `/Users/suresh/scm/github.com/stigmer/stigmer/sdk/ink/src/index.ts`
- CLI integration: `/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/cli/cmd/stigmer/root/run_stream_ink.go`

### Docs Site
- Docs nav: `/Users/suresh/scm/github.com/stigmer/stigmer/docs/meta.json`
- Docs homepage: `/Users/suresh/scm/github.com/stigmer/stigmer/docs/index.mdx`
- Getting started nav: `/Users/suresh/scm/github.com/stigmer/stigmer/docs/getting-started/meta.json`
- Local quickstart: `/Users/suresh/scm/github.com/stigmer/stigmer/docs/getting-started/local.mdx`
- Root Makefile: `/Users/suresh/scm/github.com/stigmer/stigmer/Makefile`

### Content Strategy (positioning + vocabulary)
- Positioning: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/positioning.md`
- Vocabulary: `/Users/suresh/scm/github.com/stigmer/stigmer/docs/vocabulary.md`
- IA: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/information-architecture.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260416.03.documentation-strategy/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review any design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the next task or complete the current one

## Session Progress (2026-04-16)

### T02 Completed — OSS Getting Started Path
- **Strategy**: "Two doors, one house" — two quickstart entry points (cloud and local) converge on the same web console + SDK tutorial experience
- **Key decision**: Rejected heavy Cloud/CLI dual-track tabs in favor of a single "Running locally?" callout per tutorial page — avoids nested tabs and keeps pages clean
- **Key discovery**: Local `stigmer server` runs the same web console at `localhost:8234`, so follow-on tutorials work identically — only URL and authentication differ
- **Commit**: `edb928ef5` — 7 docs files modified, 1 changelog created (330 insertions)

### Files Modified
- `docs/getting-started/meta.json` — added `local` to sidebar
- `docs/index.mdx` — added Local Quickstart card
- `docs/getting-started/quickstart.mdx` — cross-reference callout
- `docs/getting-started/local.mdx` — cross-reference, web console mention, SDK setup accordion
- `docs/getting-started/first-skill.mdx` — prerequisites, callout, SDK bridge accordion
- `docs/getting-started/connect-tools.mdx` — callout
- `docs/getting-started/create-agent.mdx` — callout

## Session Progress (2026-04-16, Session 2)

### T01 Completed — CLI Reference Documentation

- **Architecture**: Hybrid enrichment system — hand-written `.mdx` templates co-located with Go command source (`root/docs/`), generator replaces `AUTO_*` markers with fresh flags/usage/subcommands from Cobra tree
- **Key design decision**: Enrichments live next to command source (proto `docs/overview.md` pattern), not in the docs output directory — reduces drift, mirrors existing proto convention
- **Key discovery**: T01 original plan listed 14 commands; actual tree has 20 top-level + 55 total. 5 commands had examples embedded in `Long` instead of `Example` field. Information Architecture doc named the overview `overview.mdx` but repo convention is `index.mdx`.
- **Output**: 20 enriched pages + 1 default (version) + index + meta.json. Makefile targets, CI trigger paths, coverage test all wired.
- **Files created**: 20 enrichment templates, coverage_test.go, docs/cli/ tree (index.mdx, meta.json, 23 generated files)
- **Files modified**: gen-cli-docs/main.go, 8 command Go files, Makefile, ci.docs.yaml, docs/meta.json, docs/index.mdx, BUILD.bazel

## Session Progress (2026-04-16, Session 3)

### T03 Completed — Ink SDK Reference Documentation

- **Architecture**: Single generated reference page (not multi-page like React SDK) — Ink has 15 exports vs React's 100+; splitting would create sparse pages
- **Key design decision**: Re-exports (`createNodeClient`, `createNodeTransport`) link to SDK Overview rather than re-documenting — prevents drift
- **Key discovery**: Ink TSDoc was already 100% summary coverage at baseline; only `TodoListProps.todos` and `renderMarkdown` @example needed gap-filling
- **Pipeline**: TypeDoc config → `tsdoc:check` quality gate → `tsdoc:coverage` script → `generate-ink-sdk-docs` generator → single `reference.mdx` + `meta.json`
- **Output**: Integration guide (`index.mdx`, 7 sections) + generated reference page (16 exports across 4 categories)
- **Files created**: 11 new files (3 TypeDoc configs, coverage script, 4 generator files, 3 docs files)
- **Files modified**: 7 files (package.json x2, 2 source TSDoc fixes, Makefile, ci.docs.yaml, docs/sdk/ wiring)

## Session Progress (2026-04-16, Session 4)

### T04 Completed — README Overhaul

- **Tagline**: Replaced "Build AI agents and workflows with zero infrastructure" with "An open-source AI agent platform." — category-first, developer-direct register
- **Key decision**: LLM configuration content (50 lines) NOT moved to a new docs page — it already lives across `local.mdx`, `server.mdx`, and `config.mdx` from T01/T02. Creating a 4th location would violate single-source-of-truth.
- **Key discovery**: 10 of 18 README links were broken (pointing to removed architecture, guides, and getting-started pages). All replaced with docs site URLs or valid repo paths.
- **Vocabulary fixes**: Removed "Graphton" (internal-only), removed "CNCF Serverless Workflow" (reference-only), aligned all terms with vocabulary guide README column
- **Output**: 255 lines (down from 425, 40% reduction). Badge row, SDKs table (Go/React/Ink), valid Documentation section, condensed Quick Start.

### Files Modified
- `README.md` — complete restructure

### Files Created
- `_changelog/2026-04/2026-04-16-100226-readme-overhaul.md`

## Session Progress (2026-04-16, Session 5)

### T05 Completed — Final Validation and CI Integration

- **New CI gate**: Added `tsdoc-check` Makefile target (`typedoc --treatValidationWarningsAsErrors` for both sdk/ink and sdk/react), wired into `check` between format-docs-check and gen-sdk-docs-check
- **CI trigger fix**: Added `sdk/react/**` to `ci.docs.yaml` path filters (was missing — React SDK changes never triggered docs CI)
- **Issues fixed**: 4 pre-existing issues surfaced by the stricter pipeline — React SDK TypeDoc external symbol mappings, Ink SDK docs generator unused import, demo scenario unused imports, lychee localhost false positive
- **Validation**: `make codegen` and `make check` both pass end-to-end. All four user journeys verified through the live docs site.
- **Commit**: `c149ee8b1` — 7 files modified (120 insertions, 37 deletions)

### Files Modified
- `Makefile` — added `tsdoc-check` target, wired into `check`
- `.github/workflows/ci.docs.yaml` — added `sdk/react/**` to trigger paths
- `sdk/react/typedoc.json` — added 4 missing external symbol link mappings
- `.lychee.toml` — added localhost exclusion
- `site/scripts/generate-ink-sdk-docs/renderer.ts` — removed unused import
- `site/src/components/docs/demos/scenarios/api-key-setup/index.tsx` — removed unused imports

## Current Status

**Created**: 2026-04-16
**Current Task**: All tasks complete. Project finished.
**Status**: T01 COMPLETE, T02 COMPLETE, T03 COMPLETE, T04 COMPLETE, T05 COMPLETE.

## Next Steps

None — all 5 tasks are complete. The documentation strategy project is finished.

---

*This file provides direct paths to all project resources for quick context loading.*
