# Next Task: 20260403.03.sdk-docs-auto-generation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.03.sdk-docs-auto-generation

**Description**: Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.
**Goal**: Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Current Status

**Last Session**: 2026-04-03
**Status**: T04 complete, ready for T05
**Active Task**: T05 (Proto comment audit)

## Session Progress (2026-04-03, Session 3)

### Completed
- **T04**: Expand generator to all resources with edge-case refinement -- quality hardening pass
  - Fixed `docFirstSentence()` abbreviation bug: added `docSentenceEnd()` to skip common abbreviations (`e.g.`, `i.e.`, `etc.`, `vs.`, `approx.`, `incl.`, `resp.`) when splitting sentences. Previously truncated descriptions like `"UI-visible fingerprint (e.g."` mid-sentence.
  - Fixed `docWriteStreamingSigs()` panic guard: empty `OutputType` no longer causes a slice-out-of-bounds panic; falls back to `"event"` as variable name.
  - Fixed code block formatting: created `.prettierignore` at repo root to exclude `docs/sdk/` from Prettier auto-formatting. The generator already emits correct multi-line fenced blocks; Prettier was collapsing short code blocks onto single lines inside JSX `<Tab>` components, corrupting Markdown fence syntax.
  - Verified all 17 resources: confirmed non-standard patterns (Skill push-based API, IamPolicy spec-based delete, ExecutionContext no-update, IdentityAccount WhoAmI/SimulateSignupWebhook, SearchService-backed list) all render correctly.
  - Regenerated all 17 SDK reference pages with fixes applied.

### Key Decisions (T04)
- **Internal methods**: All methods (including operator/system-level like `bootstrapPolicy`, `simulateSignupWebhook`, `updateStatus`) are included in the SDK reference. The descriptions already communicate audience. Hiding methods would prevent platform operators from finding docs for methods they legitimately need. T05 will improve description quality where needed.
- **Prettier exclusion**: Auto-generated files in `docs/sdk/` are excluded from Prettier via `.prettierignore`. These files are machine-formatted by the generator and will be regenerated on every `make codegen`.

### Audit Findings (T04)
- **Generator bugs fixed**: Abbreviation-aware sentence splitting, streaming panic guard
- **Content gaps identified for T05**: Several resources have missing/thin overview text (api-key, identity-account), inconsistent description casing, and implementation notes leaking into user-facing descriptions (e.g., `"Custom authorization in handler."` on getByReference)
- **No architectural changes needed**: All 17 resources render correctly with the existing generator logic. Non-standard patterns (push-based, spec-based inputs, empty inputs/outputs, streaming) are all handled.

## Next Steps

1. **T05**: Proto comment audit -- Targeted enrichment of thin descriptions, now informed by the template's first-paragraph extraction strategy. Focus on making first paragraphs of proto comments concise and user-facing.
2. **T06**: Manual pages -- SDK overview, streaming guide, React SDK docs
3. **T07**: Makefile integration and CI -- Add `sdk-docs` to `make codegen`, add CI staleness check

## Context for Resume

### Files Created/Modified (T04)
- **Modified**: `tools/codegen/generator/sdk_docs.go` -- added `docSentenceEnd()`, fixed streaming guard, ~860 lines
- **Created**: `.prettierignore` -- excludes `docs/sdk/` from Prettier auto-formatting
- **Regenerated**: `docs/sdk/*.mdx` -- all 17 reference pages updated with bug fixes

### New Functions in sdk_docs.go (T04)
- `docSentenceEnd(s)` -- abbreviation-aware sentence boundary detection

### Architecture (unchanged)
The generator reads from two schema sources:
- `tools/codegen/schemas/services/<resource>.json` -- service methods, descriptions
- `tools/codegen/schemas/<domain>/<resource>/<resource>.json` -- spec fields, types
- `tools/codegen/schemas/<domain>/<resource>/types/*.json` -- nested type schemas

It produces MDX files using existing Fumadocs components (SDKTabs, Tab, TypeTable).

### Plan File
The detailed T04 plan is at the conversation transcript: [T04 Edge Cases](current session)

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-04/20260403.03.sdk-docs-auto-generation/checkpoints/
```

### 2. Task Plans
```
_projects/2026-04/20260403.03.sdk-docs-auto-generation/tasks/
```

### 3. Knowledge Folders
- **Design Decisions**: `design-decisions/`
- **Coding Guidelines**: `coding-guidelines/`
- **Wrong Assumptions**: `wrong-assumptions/`
- **Don't Dos**: `dont-dos/`

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review the generated output at `docs/sdk/session.mdx` (primary reference page)
4. [ ] Review `tools/codegen/generator/sdk_docs.go` to understand the generator
5. [ ] Review any new design decisions in `design-decisions/`
6. [ ] Continue with T05 or the next prioritized task

## Quick Commands

After loading context:
- "Continue with T05" - Start the proto comment audit task
- "Show project status" - Get overview of progress
- "Review the generated session page" - Check template output quality
- "Run the SDK docs generator" - `go run ./tools/codegen/generator --comprehensive --target=sdk-docs --schema-dir tools/codegen/schemas --output-dir docs/sdk`

---

*This file provides direct paths to all project resources for quick context loading.*
