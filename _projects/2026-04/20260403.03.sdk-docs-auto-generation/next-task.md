# Next Task: 20260403.03.sdk-docs-auto-generation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.03.sdk-docs-auto-generation

**Description**: Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.
**Goal**: Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Current Status

**Last Session**: 2026-04-04 (Session 8)
**Status**: T06 in progress -- SDK Overview page and Streaming guide complete, React SDK page pending
**Active Task**: T06 (Manual pages -- SDK overview, streaming guide, React SDK docs)

## Session Progress (2026-04-04, Session 8)

### Completed
- **Streaming guide** (`docs/sdk/streaming.mdx`): Hand-written how-to guide covering production streaming patterns
  - Subscribe to an Agent Execution (full phase-aware loop across all 4 languages)
  - Read the snapshot (key status fields orientation with links to full reference)
  - Detect completion (terminal vs non-terminal phases, helper function per language)
  - Handle stream errors (transport errors vs execution failures, retryable checks)
  - Cancel a stream (AbortSignal in TS, context cancellation in Go, iterator break in Python/Java)
  - Subscribe to a Workflow Execution (different input shape, task-based progress)
  - What's next cards linking to Agent Execution, Workflow Execution, and Connect Tools
- **Updated `docs/sdk/meta.json`**: Added `"streaming"` page and `"resources"` collapsible folder

### Key Decisions (Session 8)
- **Scope boundaries**: Focused on patterns not covered elsewhere (quickstart, connect-tools, generated reference pages). Did not duplicate type tables or approval handling.
- **API asymmetry**: AgentExecution subscribe takes bare string ID; WorkflowExecution subscribe takes request object. Documented clearly with numbered differences.
- **Resources folder**: Resource pages moved to `docs/sdk/resources/` subdirectory, making them collapsible in the sidebar. Codegen now outputs to `docs/sdk/resources/`.
- **Cancellation warning**: Added callout that cancelling a stream does not cancel the execution itself.

### Discovery: Go/Java Phase Constants Convention
The connect-tools tutorial uses convenience names (`stigmer.ExecutionCompleted`, `ExecutionPhase.COMPLETED`) that don't match the proto-generated constants (`ExecutionPhase_EXECUTION_COMPLETED`). The streaming guide follows the same convention as connect-tools for consistency. This may warrant a separate investigation to confirm these aliases exist or need to be added.

## Next Steps

1. **T06 (continued)**: Write `docs/sdk/react.mdx` -- React SDK reference
2. **T06 (continued)**: Verify `index.mdx` renders as section landing page in Fumadocs
3. **Follow-up**: Fix Python/Java accessor name bug in `sdk_docs.go` codegen (separate task)

## Context for Resume

### Working Tree
Clean -- all SDK docs changes committed.

### Committed in Session 8
- `0330f019` -- `docs(sdk): add Streaming how-to guide for SDK Reference section`

### Plan Reference
The full T06 plan is in:
```
/Users/suresh/.cursor/plans/t06_sdk_manual_pages_9d43630c.plan.md
```

The streaming guide plan is in:
```
/Users/suresh/.cursor/plans/sdk_streaming_guide_b6c4b233.plan.md
```

### React SDK Page (next page to write)
Diataxis type: **Reference**. Covers:
- `@stigmer/react` installation and peer deps
- `StigmerProvider` setup with `deploymentMode`
- `useStigmer()` hook
- Key hooks (session, execution, resource)
- Key components (composer, message thread, detail views)
- Styles import

### Key Source Files for Remaining Work
- `sdk/react/src/index.ts` -- React SDK public exports
- `sdk/react/src/provider.tsx` -- StigmerProvider implementation
- `docs/sdk/resources/agent-execution.mdx` -- Generated page for reference

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

1. [ ] Read the latest checkpoint from `checkpoints/2026-04-04-session-8.md`
2. [ ] Review `docs/sdk/streaming.mdx` (Streaming guide written in session 8)
3. [ ] Review `docs/sdk/index.mdx` (SDK Overview page written in session 7)
4. [ ] Check `git status` -- working tree should be clean
5. [ ] Continue T06: write `docs/sdk/react.mdx` next
6. [ ] Then verify `index.mdx` renders as section landing page

## Quick Commands

After loading context:
- "Continue with T06" - Write the React SDK page next
- "Show project status" - Get overview of progress
- "Run the SDK docs generator" - `make gen-sdk-docs`
- "Check SDK docs freshness" - `make gen-sdk-docs-check`

---

*This file provides direct paths to all project resources for quick context loading.*
