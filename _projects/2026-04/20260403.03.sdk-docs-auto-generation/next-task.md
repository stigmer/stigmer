# Next Task: 20260403.03.sdk-docs-auto-generation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.03.sdk-docs-auto-generation

**Description**: Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.
**Goal**: Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Current Status

**Last Session**: 2026-04-04 (Session 6)
**Status**: Proto documentation cleanup complete for workflow resource; T06 pending
**Active Task**: T06 (Manual pages -- SDK overview, streaming guide, React SDK docs)

## Session Progress (2026-04-04, Session 6)

### Completed
- **Workflow proto documentation cleanup**: Cleaned all 21 workflow proto files (core resource, 13 task configs, serverless validation) to match agent resource quality standard
  - Applied `@internal` markers to hide Zigflow DSL, Temporal, and Planton references from SDK docs
  - Rewrote all 13 `WorkflowTaskKind` enum values with concise descriptions
  - Fixed RPC, message, and field comments across all files
  - Created `apis/ai/stigmer/agentic/workflow/docs/overview.md`
  - Regenerated workflow schemas and `docs/sdk/workflow.mdx`
  - Verified zero internal terminology leaks in generated output

### Key Decisions (Session 6)
- **Zigflow → workflow DSL**: Internal "Zigflow DSL" replaced with generic "workflow DSL" in SDK-facing comments
- **YAML examples behind @internal**: Per document_writer guidelines, proto comment YAML examples moved behind `@internal`
- **Agent protos = gold standard**: Used agent resource proto comments as reference for all workflow comment structure

## Next Steps

1. **T06**: Manual pages -- SDK overview, streaming guide, React SDK docs
2. **Commit remaining unstaged changes**: workflowexecution proto cleanup + regenerated SDK docs/schemas for all resources need separate commits
3. **Consider**: workflowexecution proto documentation cleanup (changes exist but are uncommitted)

## Context for Resume

### Unstaged Changes
There are unstaged changes in the working tree from this and adjacent sessions:
- `apis/ai/stigmer/agentic/workflowexecution/v1/*.proto` -- proto doc cleanup (4 files)
- `apis/ai/stigmer/agentic/workflowexecution/docs/overview.md` -- new overview
- `docs/sdk/*.mdx` -- regenerated SDK docs for ~15 resources
- `tools/codegen/schemas/services/*.json` -- regenerated service schemas
- `proto2schema` -- untracked directory

### Committed in Session 6
- `decb028c` -- `docs(apis/workflow): clean proto comments for SDK docs and add overview` (48 files)

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
_projects/2026-04/20260403.03.sdk-docs-auto-generation/checkpoints/2026-04-04-session-6.md
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

1. [ ] Read the latest checkpoint from `checkpoints/2026-04-04-session-6.md`
2. [ ] Check current task status in `tasks/`
3. [ ] Review unstaged changes: `git status` (workflowexecution protos + regenerated docs)
4. [ ] Review `tools/codegen/generator/sdk_docs.go` to understand the generator
5. [ ] Review any new design decisions in `design-decisions/`
6. [ ] Continue with T06 (manual pages) or commit remaining unstaged changes

## Quick Commands

After loading context:
- "Continue with T06" - Start the manual pages task
- "Commit the workflowexecution changes" - Stage and commit the remaining proto cleanup
- "Show project status" - Get overview of progress
- "Run the SDK docs generator" - `make gen-sdk-docs`
- "Check SDK docs freshness" - `make gen-sdk-docs-check`

---

*This file provides direct paths to all project resources for quick context loading.*
