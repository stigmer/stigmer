# Next Task: 20260403.03.sdk-docs-auto-generation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.03.sdk-docs-auto-generation

**Description**: Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.
**Goal**: Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Current Status

**Last Session**: 2026-04-04 (Session 7)
**Status**: T06 in progress -- SDK Overview page complete, streaming guide and React SDK page pending
**Active Task**: T06 (Manual pages -- SDK overview, streaming guide, React SDK docs)

## Session Progress (2026-04-04, Session 7)

### Completed
- **SDK Overview page** (`docs/sdk/index.mdx`): Hand-written Reference page serving as the SDK Reference section landing page
  - Installation commands for all 4 languages
  - Authentication with API key + TypeScript `getAccessToken` for dynamic tokens
  - Client configuration with per-language option tables
  - Resource access pattern showing naming conventions across all 4 languages
  - Error handling with types, classification helpers, and practical examples per language
  - Pagination pattern with `pageSize`/`pageToken`
  - Streaming preview with subscribe examples, linking to dedicated streaming guide
  - "What's next" cards linking to streaming guide, React SDK, and Agent reference

### Key Decisions (Session 7)
- **Error handling examples**: Showed one example per language (not just one) because the error APIs genuinely differ across SDKs
- **TypeScript `getAccessToken`**: Included as a documented option since Reference pages should cover all configuration options
- **Accessor names**: Used correct names from actual SDK source (Python plural `client.agents`, Java plural `client.agents()`) rather than matching the generated resource pages which have a codegen bug using singular names
- **Configuration tables**: Per-language option tables rather than cross-language, since each language has different options

### Discovery: Python/Java Accessor Name Bug
The generated SDK reference pages use singular accessor names for Python (`client.session.get(...)`) and Java (`client.session().get(...)`), but the actual SDK source uses plural names (`client.sessions.get(...)` and `client.sessions().get(...)`). The quickstart uses the correct plural names. This is a codegen bug in `sdk_docs.go` that should be fixed separately.

## Next Steps

1. **T06 (continued)**: Write `docs/sdk/streaming.mdx` -- Streaming how-to guide
2. **T06 (continued)**: Write `docs/sdk/react.mdx` -- React SDK reference
3. **T06 (continued)**: Update `docs/sdk/meta.json` to add streaming and react pages with Resources separator
4. **T06 (continued)**: Verify `index.mdx` renders as section landing page in Fumadocs
5. **Follow-up**: Fix Python/Java accessor name bug in `sdk_docs.go` codegen (separate task)

## Context for Resume

### Working Tree
Clean -- all changes committed.

### Committed in Session 7
- `9715d12c` -- `docs(sdk): add SDK Overview landing page for SDK Reference section`

### Plan Reference
The full T06 plan is in:
```
/Users/suresh/.cursor/plans/t06_sdk_manual_pages_9d43630c.plan.md
```

### Streaming Guide (next page to write)
Diataxis type: **How-to guide**. Covers:
- Subscribing to AgentExecution and WorkflowExecution
- Reading execution snapshots (status.messages, status.phase, status.progress)
- Detecting completion per language
- Error handling in streams
- Uses `<SDKTabs>` with all 4 languages

### React SDK Page (third page to write)
Diataxis type: **Reference**. Covers:
- `@stigmer/react` installation and peer deps
- `StigmerProvider` setup with `deploymentMode`
- `useStigmer()` hook
- Key hooks (session, execution, resource)
- Key components (composer, message thread, detail views)
- Styles import

### Key Source Files for Remaining Work
- `sdk/typescript/src/gen/agentexecution.ts` -- TS subscribe method
- `sdk/go/internal/gen/agentexecution.go` -- Go subscribe method
- `sdk/python/src/stigmer/_gen/_agentexecution.py` -- Python subscribe method
- `sdk/java/src/main/java/ai/stigmer/sdk/gen/AgentExecutionClient.java` -- Java subscribe
- `sdk/react/src/index.ts` -- React SDK public exports
- `sdk/react/src/provider.tsx` -- StigmerProvider implementation
- `docs/sdk/agent-execution.mdx` -- Generated page for reference

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
_projects/2026-04/20260403.03.sdk-docs-auto-generation/checkpoints/2026-04-04-session-7.md
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-04-04-session-7.md`
2. [ ] Review `docs/sdk/index.mdx` (SDK Overview page written in session 7)
3. [ ] Check `git status` -- working tree should be clean
4. [ ] Continue T06: write `docs/sdk/streaming.mdx` next
5. [ ] Then write `docs/sdk/react.mdx`
6. [ ] Then update `docs/sdk/meta.json`

## Quick Commands

After loading context:
- "Continue with T06" - Write the streaming guide next
- "Show project status" - Get overview of progress
- "Run the SDK docs generator" - `make gen-sdk-docs`
- "Check SDK docs freshness" - `make gen-sdk-docs-check`

---

*This file provides direct paths to all project resources for quick context loading.*
