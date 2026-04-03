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
**Status**: T02 complete, ready for T03
**Active Task**: T03 (Design the MDX page template) -- not yet started

## Session Progress (2026-04-03)

### Completed
- **T01**: Strategy and Design -- approved by stakeholder
  - Generator approach: Option A (Go generator target) confirmed
  - MDX page layout, components (SDKTabs, TypeTable), and information architecture approved
  - Task sequence T01-T07 confirmed
- **T02**: POC -- Generate SDK Reference Page for Session
  - Created `tools/codegen/generator/sdk_docs.go` (570 lines) -- new Go codegen target
  - Wired `case "sdk-docs":` into comprehensive switch in `main.go`
  - Generated 17 MDX reference pages for all SDK resources in `docs/sdk/`
  - Generated `docs/sdk/meta.json` navigation config
  - Updated `docs/meta.json` with "SDK Reference" section under "Reference" separator
  - Validated rendering in Fumadocs dev server at `/docs/sdk/session`
  - All features working: SDKTabs switching, TypeTable with expandable fields, syntax highlighting, sidebar navigation

### Key Decisions
- **Option A** (Go generator in codegen pipeline) chosen for consistency with existing generators
- Descriptions that contain MDX-significant characters (`{`, `}`, `<`, `>`) are escaped via `docEscapeMDX()` -- discovered during validation when IAM policy and project proto comments broke the MDX parser
- TypeTable uses first-sentence extraction (`docFirstSentence`) for scannable field descriptions
- Method signatures show SDK-level call syntax (not raw proto) in all 4 languages

### Surprise Encountered
Proto comments containing curly braces (`{kind: "identity_account"}` in IAM policy) and angle brackets (`<entry_point>` in project) broke MDX parsing. Added `docEscapeMDX()` to escape these characters in body text while leaving JSX string literals untouched.

## Next Steps

1. **T03**: Design the MDX page template -- Refine layout based on POC output, improve method tables, SDKTabs presentation, and type definitions
2. **T04**: Expand generator to all 18 resources -- Generate full `docs/sdk/` with meta.json, wire into docs nav (mostly done by T02, but needs edge-case refinement)
3. **T05**: Proto comment audit -- Targeted enrichment of thin descriptions informed by generated output
4. **T06**: Manual pages -- SDK overview, streaming guide, React SDK docs
5. **T07**: Makefile integration and CI -- Add `sdk-docs` to `make codegen`, add CI staleness check

## Context for Resume

### Files Created/Modified
- **Created**: `tools/codegen/generator/sdk_docs.go` -- the SDK docs generator (570 lines)
- **Modified**: `tools/codegen/generator/main.go` -- added `case "sdk-docs":` dispatch (+5 lines)
- **Created**: `docs/sdk/*.mdx` -- 17 generated MDX reference pages
- **Created**: `docs/sdk/meta.json` -- SDK Reference navigation config
- **Modified**: `docs/meta.json` -- added "---Reference---" separator and "sdk" section

### Architecture
The generator reads from two schema sources:
- `tools/codegen/schemas/services/<resource>.json` -- service methods, descriptions
- `tools/codegen/schemas/<domain>/<resource>/<resource>.json` -- spec fields, types
- `tools/codegen/schemas/<domain>/<resource>/types/*.json` -- nested type schemas

It produces MDX files using existing Fumadocs components (SDKTabs, Tab, TypeTable).

### Key Functions in sdk_docs.go
- `runSDKDocsGeneration()` -- entry point, iterates all services
- `generateSDKDocPage()` -- orchestrates per-resource page sections
- `docWriteMethod()` -- handles 6 input patterns (empty, ID, resource, delete, generic request)
- `docWriteTypes()` -- emits TypeTable with metadata + spec fields, recurses into nested types
- `docEscapeMDX()` -- escapes `{}` and `<>` for MDX body text safety

### Plan File
The detailed T02 plan is at: `/Users/suresh/.cursor/plans/t02_sdk_docs_poc_fb9231ff.plan.md`

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/checkpoints/
```

### 2. Task Plans
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/tasks/
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
3. [ ] Review the generated output at `docs/sdk/session.mdx` (primary POC page)
4. [ ] Review `tools/codegen/generator/sdk_docs.go` to understand the generator
5. [ ] Review any new design decisions in `design-decisions/`
6. [ ] Continue with T03 or the next prioritized task

## Quick Commands

After loading context:
- "Continue with T03" - Start the MDX template design task
- "Show project status" - Get overview of progress
- "Review the generated session page" - Check the POC output quality
- "Run the SDK docs generator" - `go run ./tools/codegen/generator --comprehensive --target=sdk-docs --schema-dir tools/codegen/schemas --output-dir docs/sdk`

---

*This file provides direct paths to all project resources for quick context loading.*
