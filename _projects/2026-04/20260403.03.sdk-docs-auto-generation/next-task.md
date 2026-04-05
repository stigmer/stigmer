# Next Task: 20260403.03.sdk-docs-auto-generation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.03.sdk-docs-auto-generation

**Description**: Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.
**Goal**: Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Current Status

**Last Session**: 2026-04-05 (Session 12)
**Status**: ALL WORK COMPLETE -- T06, sub-project, and all polish items closed.
**Active Task**: None

## Session Progress (2026-04-05, Session 12)

### Completed
- **Dead code cleanup** (Option C): Removed 8 unreachable functions from `sdk_docs.go` (~200 lines) left behind by the commons refactoring. 5 section-level functions + 3 thin wrappers. Verified zero behavioral change via before/after MDX diff.
- **Python variable naming** (Option D): Added `docPyVarName` using existing `pascalToSnake` helper. Applied in `docWriteClientAccess`, `docWriteMethodSigs`, `docWriteStreamingSigs`. 12 MDX files regenerated with PEP 8 snake_case variables.
- **Minor fixes**: Removed unused `lower` variable in `docOverviewSummary`, dead switch branch in `docQuote`, stale comment in `docCollectNestedTypeNames`.
- Commit: `c5606dce refactor(codegen): remove dead code and fix Python variable names in SDK docs generator`

### Previous Session (Session 11)
- Fix Python/Java accessor name bug: Introduced `docLangNames` struct, used canonical `pyClientFieldName()` and `javaAccessorName()` functions
- Commit: `8168eb7a fix(codegen): correct Python/Java accessor names in SDK reference docs`

### Session 10
- T06 verification: Confirmed `docs/sdk/index.mdx` renders correctly at `/docs/sdk`
- Quality review passed: all 7 SDKTabs, Callout, Cards render correctly

## Next Steps

All planned tasks, follow-ups, and polish items are complete. This project is fully closed.

Remaining optional polish (low priority):
1. **Sub-project polish**: Improve `@returns` tags on hooks (1.5%), `@param` docs (46.3%)

## Context for Resume

### Working Tree
Clean on `main`. Feature branch `feat/react-sdk-docs-auto-generated` exists locally.

### T06 Completion Status
All three manual pages written and verified:
1. `docs/sdk/index.mdx` -- SDK Overview (session 7, **verified session 10**)
2. `docs/sdk/streaming.mdx` -- Streaming how-to guide (session 8)
3. `docs/sdk/react.mdx` -- React SDK reference (session 9)

### Sub-Project Completion Status
All 7 tasks complete (T01-T07):
- 100% TSDoc coverage on 361 exports across 18 domains
- 17 auto-generated MDX reference pages
- 54/59 live component previews
- CI staleness check via `gen-react-sdk-docs-check`

### Key Source Files
- `tools/codegen/generator/sdk_docs.go` -- SDK docs generator (accessor bug fixed in session 11)

### Full Codegen Chain (after T07)
```
make protos
  ├─ apis build              → buf lint/format, proto stubs
  ├─ sdk/go codegen          → stubs + proto2schema + sdk-client (Go)
  ├─ mcp-server codegen      → stubs + schemas + mcp types
  ├─ sdk/typescript codegen  → sdk-client-ts
  ├─ sdk/python codegen      → sdk-client-python
  ├─ sdk/java codegen        → sdk-client-java
  └─ gen-sdk-docs            → SDK reference MDX pages

make codegen = make protos
```

### Architecture (unchanged)
The generator reads from two schema sources:
- `tools/codegen/schemas/services/<resource>.json` -- service methods, descriptions
- `tools/codegen/schemas/<domain>/<resource>/<resource>.json` -- spec fields, types
- `tools/codegen/schemas/<domain>/<resource>/types/*.json` -- nested type schemas

It produces MDX files using existing Fumadocs components (SDKTabs, Tab, TypeTable).

### Important: Running the Generator
```bash
# Now integrated into make protos, but can also run standalone:
make gen-sdk-docs

# Staleness check (CI):
make gen-sdk-docs-check
```

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-04/20260403.03.sdk-docs-auto-generation/checkpoints/2026-04-05-session-10.md
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-04-05-session-11.md`
2. [ ] Check `git status`
3. [ ] Pick next task from Next Steps above (optional polish only)

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Run the SDK docs generator" - `make gen-sdk-docs`
- "Check SDK docs freshness" - `make gen-sdk-docs-check`

---

*This file provides direct paths to all project resources for quick context loading.*

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/next-task.md` - Build a TypeDoc-based auto-generation pipeline for React SDK (@stigmer/react) reference documentation, producing always-in-sync Fumadocs MDX pages from TSDoc comments in the source code.
