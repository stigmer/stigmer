# Next Task: 20260403.03.sdk-docs-auto-generation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.03.sdk-docs-auto-generation

**Description**: Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.
**Goal**: Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Current Status

**Last Session**: 2026-04-03 (Session 4)
**Status**: T05 complete, ready for T06
**Active Task**: T06 (Manual pages -- SDK overview, streaming guide, React SDK docs)

## Session Progress (2026-04-03, Session 4)

### Completed
- **T05**: Audience-Aware Proto Comments & SDK Docs -- full implementation
  - **Generator changes**: Added `docStripInternal()` to strip content after `@internal` marker. Added `docSDKContent()` to replace `docMethodSummary()` -- shows full multi-paragraph SDK content without truncation. Updated all call sites (overview summaries, method tables, method details, type fields, nested types) to strip `@internal` content before rendering.
  - **Proto comment audit**: Updated 32 proto files across all three domains (agentic, IAM, platform). Enriched thin descriptions (e.g., `"lookup api-key"` → `"Get an API key by its unique identifier."`). Added `@internal` markers to separate SDK-facing content from internal implementation details.
  - **Internal leak elimination**: Removed all leakage of internal terminology from generated MDX:
    - Temporal API references (CancelWorkflow, TerminateWorkflow, ResetWorkflow, SignalWithStart) moved after `@internal`
    - FGA/OpenFGA references moved after `@internal`
    - `inProcessChannel`, `system-level`, `Handler-level` references cleaned
    - Renamed "Temporal task token" → "Callback token" in spec field descriptions
  - **Verification**: All 17 generated MDX files have zero occurrences of Temporal, FGA, OpenFGA, or other internal terminology.
  - **Discovery**: The `--comprehensive` flag is REQUIRED when running `generator --target=sdk-docs`. Without it, the standard SDK code generation runs instead.

### Key Decisions (T05)
- **`@internal` convention**: Proto comments use `// @internal` on its own line to separate SDK-facing content (above) from internal developer notes (below). The generator strips everything from `@internal` onward.
- **Full content, not first-paragraph**: `docSDKContent()` preserves all paragraphs before `@internal`, unlike the old `docMethodSummary()` which truncated at the first paragraph break. This gives SDK users richer documentation.
- **Authorization notes preserved**: Method-level authorization requirements (e.g., "Requires can_edit permission") are kept as SDK-facing content since they help users understand permissions.
- **Spec field descriptions also stripped**: The `@internal` stripping applies to spec field descriptions too (Types section), not just method descriptions.

## Next Steps

1. **T06**: Manual pages -- SDK overview, streaming guide, React SDK docs
2. **T07**: Makefile integration and CI -- Add `sdk-docs` to `make codegen`, add CI staleness check

## Context for Resume

### Files Modified (T05)
- **Modified**: `tools/codegen/generator/sdk_docs.go` -- added `docStripInternal()`, `docSDKContent()`, removed `docMethodSummary()`, updated all call sites
- **Modified**: 32 proto files in `apis/` -- added `@internal` markers, enriched descriptions
- **Regenerated**: `tools/codegen/schemas/services/*.json` and `tools/codegen/schemas/{domain}/{resource}/*.json` -- updated from proto changes
- **Regenerated**: `docs/sdk/*.mdx` -- all 17 reference pages updated with clean SDK-facing content

### New Functions in sdk_docs.go (T05)
- `docStripInternal(desc)` -- removes everything from `@internal` marker onward
- `docSDKContent(desc)` -- full SDK-facing content extraction (replaces `docMethodSummary`)

### Removed Functions in sdk_docs.go (T05)
- `docMethodSummary()` -- replaced by `docSDKContent()` which doesn't truncate

### Architecture (unchanged)
The generator reads from two schema sources:
- `tools/codegen/schemas/services/<resource>.json` -- service methods, descriptions
- `tools/codegen/schemas/<domain>/<resource>/<resource>.json` -- spec fields, types
- `tools/codegen/schemas/<domain>/<resource>/types/*.json` -- nested type schemas

It produces MDX files using existing Fumadocs components (SDKTabs, Tab, TypeTable).

### Important: Running the Generator
```bash
# MUST use --comprehensive for sdk-docs target
go run ./tools/codegen/generator --comprehensive --target=sdk-docs --schema-dir tools/codegen/schemas --output-dir docs/sdk
```

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
6. [ ] Continue with T06 or the next prioritized task

## Quick Commands

After loading context:
- "Continue with T06" - Start the manual pages task
- "Show project status" - Get overview of progress
- "Review the generated session page" - Check template output quality
- "Run the SDK docs generator" - `go run ./tools/codegen/generator --comprehensive --target=sdk-docs --schema-dir tools/codegen/schemas --output-dir docs/sdk`

---

*This file provides direct paths to all project resources for quick context loading.*
