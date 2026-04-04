# Next Task: 20260403.03.sdk-docs-auto-generation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.03.sdk-docs-auto-generation

**Description**: Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.
**Goal**: Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Current Status

**Last Session**: 2026-04-04 (Session 9)
**Status**: T06 complete -- all three manual pages written (SDK Overview, Streaming, React SDK)
**Active Task**: T06 wrap-up (verify index.mdx renders as landing page)

## Session Progress (2026-04-04, Session 9)

### Completed
- **React SDK page** (`docs/sdk/react.mdx`): Hand-written reference page for `@stigmer/react`
  - Installation with all peer deps (`@stigmer/sdk`, `@stigmer/protos`, `@bufbuild/protobuf`)
  - `StigmerProvider` setup with complete working example and styles import
  - Deployment mode reference (`"local"` vs `"cloud"`, `useDeploymentMode`, `useResourceAvailable`, `CloudFeatureNotice`)
  - Full `StigmerProvider` props table (client, deploymentMode, preset, className, children)
  - Domain quick-reference table: 16 domains, 67 hooks, 59 components (counts verified against `index.ts`)
  - What's next cards linking to Streaming, Agent Execution, and Session
- **Updated `docs/sdk/meta.json`**: Added `"react"` before `"streaming"` in pages array
- **Sub-project scaffolding**: Created `20260404.01.sp.react-sdk-docs-auto-generation/` with T01 plan for TypeDoc-based auto-generation pipeline

### Key Decisions (Session 9)
- **Sidebar ordering**: React SDK placed before Streaming in sidebar (setup pages first, then how-to guides, then reference)
- **Diataxis type**: Reference -- same register as SDK Overview, no tutorials, no demos
- **Domain table approach**: Counts + descriptions per domain, not exhaustive hook/component lists. Keeps the page maintainable while giving readers discoverability.
- **No SDKTabs**: React-only page uses plain tsx code blocks (no multi-language tabs)
- **Scope boundary**: Page does not list every hook or component (deferred to future auto-generated per-domain pages from the sub-project)

## Next Steps

1. **T06 (verification)**: Verify `index.mdx` renders as section landing page in Fumadocs
2. **Sub-project T01**: Review and approve the TypeDoc setup + proof of concept plan (`20260404.01.sp.react-sdk-docs-auto-generation/tasks/T01_0_plan.md`)
3. **Follow-up**: Fix Python/Java accessor name bug in `sdk_docs.go` codegen (separate task)

## Context for Resume

### Working Tree
Clean -- all T06 docs committed.

### Committed in Session 9
- React SDK reference page and meta.json update
- Sub-project scaffolding for TypeDoc-based auto-generation pipeline

### Committed in Session 8
- `0330f019` -- `docs(sdk): add Streaming how-to guide for SDK Reference section`

### T06 Completion Status
All three manual pages are written:
1. `docs/sdk/index.mdx` -- SDK Overview (session 7)
2. `docs/sdk/streaming.mdx` -- Streaming how-to guide (session 8)
3. `docs/sdk/react.mdx` -- React SDK reference (session 9)

Remaining: verify `index.mdx` renders as the section landing page in the Fumadocs dev server.

### Key Source Files for Remaining Work
- `docs/sdk/index.mdx` -- Verify renders as landing page
- Sub-project: `_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/tasks/T01_0_plan.md` -- TypeDoc PoC plan (pending review)

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
_projects/2026-04/20260403.03.sdk-docs-auto-generation/checkpoints/2026-04-04-session-8.md
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-04-04-session-9.md`
2. [ ] Review `docs/sdk/react.mdx` (React SDK reference written in session 9)
3. [ ] Check `git status` -- working tree should be clean
4. [ ] Verify `index.mdx` renders as section landing page in Fumadocs
5. [ ] Review sub-project T01 plan for TypeDoc auto-generation pipeline

## Quick Commands

After loading context:
- "Verify index.mdx landing page" - Check Fumadocs rendering
- "Review sub-project T01 plan" - Evaluate TypeDoc PoC approach
- "Show project status" - Get overview of progress
- "Run the SDK docs generator" - `make gen-sdk-docs`
- "Check SDK docs freshness" - `make gen-sdk-docs-check`

---

*This file provides direct paths to all project resources for quick context loading.*

## Sub-Projects

Active sub-projects spawned from this project:

- `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/next-task.md` - Build a TypeDoc-based auto-generation pipeline for React SDK (@stigmer/react) reference documentation, producing always-in-sync Fumadocs MDX pages from TSDoc comments in the source code.
