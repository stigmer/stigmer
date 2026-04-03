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
**Status**: T03 complete, ready for T04
**Active Task**: T04 (Expand generator to all resources with edge-case refinement)

## Session Progress (2026-04-03, Session 2)

### Completed
- **T03**: Design the MDX page template -- comprehensive template refinement
  - Added `docMethodSummary()` to extract first-paragraph summaries from proto descriptions, eliminating heading hierarchy corruption from verbose proto comments
  - Added `docOverviewSummary()` to strip proto-internal preambles ("XxxSpec defines...", placeholder descriptions) from page overviews
  - Added `docStripSince()` to remove `@since` annotations from generated output
  - Added `docSortMethods()` to reorder methods logically: queries first (get, list, subscribe), then mutations (create, update, delete), then lifecycle (pause, resume, cancel, terminate, recover), then utilities
  - Added `docWriteMethodOverview()` to emit a scannable summary table at the top of the Methods section with linked method names, streaming indicator, and descriptions
  - Added streaming support: "Server Streaming" badge, `Stream<T>` return type, and language-idiomatic iteration examples (Go Recv loop, TS for-await, Python iterator, Java callback)
  - Added `docExampleID()` and `docExampleResourceName()` for realistic example values ("session-abc123", "my-session")
  - Added `docArticle()` for correct a/an grammar ("an Agent", "an API Key")
  - Regenerated all 17 SDK reference pages; validated rendering
  - Page size reductions: agent-execution -26%, workflow-execution -55%

### Key Decisions (T03)
- **Description strategy**: Extract first paragraph only from proto comments, do not parse markdown subheadings or tables. This decouples the template from proto comment formatting and keeps T05 focused on improving first-paragraph quality.
- **Method ordering**: Queries first (get, list, subscribe), then mutations (create, update, delete), then lifecycle (pause, resume, cancel, terminate, recover), then utilities. User confirmed this approach.
- **Streaming pattern**: Use language-idiomatic patterns (Go: `Recv()` loop, TS: `for await`, Python: `for ... in`, Java: callbacks) rather than abstracting to a generic pattern.
- **Example values**: Use full slug-based IDs ("session-abc123") and resource names ("my-session") rather than synthetic short codes. Avoids prefix collisions between similar resource types.

## Next Steps

1. **T04**: Expand generator to all resources with edge-case refinement -- Generator already produces 17 pages from T02, but some resources may need special handling (SearchService-backed list, resources without Spec types, etc.)
2. **T05**: Proto comment audit -- Targeted enrichment of thin descriptions, now informed by the template's first-paragraph extraction strategy. Focus on making first paragraphs of proto comments concise and user-facing.
3. **T06**: Manual pages -- SDK overview, streaming guide, React SDK docs
4. **T07**: Makefile integration and CI -- Add `sdk-docs` to `make codegen`, add CI staleness check

## Context for Resume

### Files Created/Modified
- **Modified**: `tools/codegen/generator/sdk_docs.go` -- grew from 570 to ~842 lines with template improvements
- **Regenerated**: `docs/sdk/*.mdx` -- all 17 reference pages updated with new template

### New Functions in sdk_docs.go (T03)
- `docMethodSummary(desc)` -- extracts first paragraph, strips headings and @since
- `docOverviewSummary(desc)` -- strips proto-internal preambles from spec descriptions
- `docStripSince(desc)` -- removes @since annotation lines
- `docSortMethods(methods)` -- reorders methods by category
- `docMethodSortKey(name)` -- maps method name prefixes to sort priority
- `docCollectMethods(schema)` -- flattens service methods into a slice
- `docWriteMethodOverview(buf, methods)` -- emits method summary table
- `docWriteStreamingSigs(buf, m, ...)` -- streaming method code examples
- `docExampleID(protoResType)` -- realistic example IDs
- `docExampleResourceName(protoResType)` -- realistic example resource names
- `docArticle(name)` -- a/an grammar helper

### Architecture (unchanged)
The generator reads from two schema sources:
- `tools/codegen/schemas/services/<resource>.json` -- service methods, descriptions
- `tools/codegen/schemas/<domain>/<resource>/<resource>.json` -- spec fields, types
- `tools/codegen/schemas/<domain>/<resource>/types/*.json` -- nested type schemas

It produces MDX files using existing Fumadocs components (SDKTabs, Tab, TypeTable).

### Plan File
The detailed T03 plan is at the conversation transcript: [T03 Template Design](3d3bf7fe-af55-4f2a-98d7-98bf8a84da01)

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
6. [ ] Continue with T04 or the next prioritized task

## Quick Commands

After loading context:
- "Continue with T04" - Start the edge-case expansion task
- "Show project status" - Get overview of progress
- "Review the generated session page" - Check template output quality
- "Run the SDK docs generator" - `go run ./tools/codegen/generator --comprehensive --target=sdk-docs --schema-dir tools/codegen/schemas --output-dir docs/sdk`

---

*This file provides direct paths to all project resources for quick context loading.*
