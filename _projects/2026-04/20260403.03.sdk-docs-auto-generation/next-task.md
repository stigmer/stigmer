# Next Task: 20260403.03.sdk-docs-auto-generation

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260403.03.sdk-docs-auto-generation

**Description**: Auto-generate SDK reference documentation from the proto-to-schema codegen pipeline for all four SDK languages (Go, TypeScript, Python, Java) plus React, producing always-in-sync, high-quality docs pages in the Fumadocs site.
**Goal**: Create an automated pipeline that generates MDX-based SDK reference documentation from proto definitions and service schemas, integrated into the existing make codegen workflow, so every proto change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Current Status

**Last Session**: 2026-04-03 (Session 5)
**Status**: T07 complete, ready for T06
**Active Task**: T06 (Manual pages -- SDK overview, streaming guide, React SDK docs)

## Session Progress (2026-04-03, Session 5)

### Completed
- **T07**: Makefile Integration and CI for SDK Docs
  - **Makefile changes**: Added `gen-sdk-docs` target that runs the SDK docs generator. Added `gen-sdk-docs-check` staleness check using per-file diff comparison (handles coexisting manual pages and stale artifacts). Added `$(MAKE) gen-sdk-docs` as the last step of `protos` so `make protos` automatically regenerates SDK docs. Simplified `codegen` to just depend on `protos`.
  - **CLI docs removal**: Removed `gen-cli-docs` and `gen-cli-docs-check` targets from root Makefile (to be rebuilt in a separate project).
  - **CI workflow**: Replaced `cli-docs-freshness` job with `sdk-docs-freshness` in `ci.docs.yaml`. Updated path triggers to include `apis/**` and `tools/codegen/**`, removed `client-apps/cli/**`. Uses `tools/go.mod` for Go setup.
  - **Staleness check fix**: The original CLI docs check had a shell logic bug where `exit 1` inside a subshell `(...)` didn't propagate through `;`. Rewrote using per-file comparison loop with proper exit code propagation. Also handles extra files in `docs/sdk/` (untracked `.go` files, future manual pages) without false failures.
  - **Verification**: Both `make gen-sdk-docs` (exit 0, generates 17 pages + meta.json) and `make gen-sdk-docs-check` (exit 0 when fresh, exit 1 when stale) verified locally.

### Key Decisions (T07)
- **SDK docs in `protos`, not `codegen`**: Added `gen-sdk-docs` to `protos` rather than `codegen` because it belongs in the same pipeline as proto stubs and SDK clients. `codegen` is now just an alias for `protos`.
- **Per-file diff, not `diff -r`**: The staleness check compares only generated files against their counterparts in `docs/sdk/`, ignoring extra files. This avoids false failures from untracked `.go` files and future manual pages (T06).
- **CLI docs deferred**: CLI docs generation removed from the pipeline entirely -- to be rebuilt in a separate project with improved quality.

## Next Steps

1. **T06**: Manual pages -- SDK overview, streaming guide, React SDK docs

## Context for Resume

### Files Modified (T07)
- **Modified**: `Makefile` -- added `gen-sdk-docs`, `gen-sdk-docs-check`, updated `protos` and `codegen`, removed CLI docs targets
- **Modified**: `.github/workflows/ci.docs.yaml` -- replaced `cli-docs-freshness` with `sdk-docs-freshness`, updated path triggers

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
6. [ ] Continue with T06 (manual pages)

## Quick Commands

After loading context:
- "Continue with T06" - Start the manual pages task
- "Show project status" - Get overview of progress
- "Review the generated session page" - Check template output quality
- "Run the SDK docs generator" - `make gen-sdk-docs`
- "Check SDK docs freshness" - `make gen-sdk-docs-check`

---

*This file provides direct paths to all project resources for quick context loading.*
