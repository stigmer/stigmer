# Next Task: 20260404.01.sp.react-sdk-docs-auto-generation

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260403.03.sdk-docs-auto-generation
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260403.03.sdk-docs-auto-generation
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/next-task.md`
**Spawned From Task**: T06

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260404.01.sp.react-sdk-docs-auto-generation

**Description**: Build a TypeDoc-based auto-generation pipeline for React SDK (@stigmer/react) reference documentation, producing always-in-sync Fumadocs MDX pages from TSDoc comments in the source code.
**Goal**: Auto-generate per-domain reference pages (hooks, components, props) for the React SDK's 61+ hooks and 55+ components, integrated into make gen-sdk-docs, so every code change automatically updates the docs.
**Tech Stack**: Go (codegen generator), TypeScript (site scripts), MDX (Fumadocs docs), Protobuf (source of truth)
**Components**: tools/codegen/generator/, docs/sdk/, site/scripts/, apis/ (proto comments), Makefile, docs/meta.json

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260403.03.sdk-docs-auto-generation/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260404.01.sp.react-sdk-docs-auto-generation/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

**Created**: 2026-04-04 14:28
**Last Session**: 2026-04-05 (session 12) — dead code cleanup + Python variable naming fix
**Current Task**: All planned tasks and polish items COMPLETE
**Status**: T01 COMPLETE, T02 COMPLETE, T03 COMPLETE, T04 COMPLETE, previews COMPLETE (54/59 components), T05 COMPLETE, T07 COMPLETE, @example coverage COMPLETE, dead code cleanup COMPLETE, Python naming COMPLETE

### Session 12 Results (dead code cleanup + Python variable naming) — COMPLETE
Removed 8 dead functions from sdk_docs.go (~200 lines) left behind by the commons refactoring, and fixed Python code examples to use PEP 8 snake_case variable names. Key outcomes:
- **Dead code removed**: 5 section-level functions + 3 thin wrappers, all unreachable from `runSDKDocsGeneration`
- **Python naming fix**: Added `docPyVarName` using existing `pascalToSnake`; applied in `docWriteClientAccess`, `docWriteMethodSigs`, `docWriteStreamingSigs`
- **Minor fixes**: Unused variable, dead switch branch, stale comment
- 12 MDX files regenerated with corrected Python variable names; 2 streaming examples corrected
- `go build`, `go vet` clean; zero camelCase Python variables remaining
- Commit: `c5606dce refactor(codegen): remove dead code and fix Python variable names in SDK docs generator`
- See checkpoints/2026-04-05-session-12.md for full details

### Session 10 Results (@example coverage to 100%) — COMPLETE
Closed all @example gaps across the React SDK. Key outcomes:
- **Generator fix**: `extractExample()` → `extractExamples()` — now renders ALL @example blocks, not just the first
- **Generator enhancement**: Added `examples: string[]` to `TypeDef` model for standalone type examples
- **11 hooks** with new @example blocks (session×4, github×3, workspace×2, models×1, execution×1)
- **8 components** with new @example blocks (workspace×2, skill×1, models×1, github×1, execution×1, attachment×1, internal×1)
- **4 standalone types** with selective @example blocks (WorkspaceEntry, SessionGroup, ModelInfo, AttachmentEntry)
- 44 files changed, +1,266 lines of documentation content
- All 17 MDX pages regenerated; `tsc --noEmit` clean; TypeDoc 0 errors
- See checkpoints/2026-04-05-session-10.md for full details

### Session 9 Results (Fix CI lint failures and Makefile gaps) — COMPLETE
Fixed two independent CI failures on `main` introduced during sessions 5-8:
- **`pages-build`**: 4 ESLint errors in ScenarioPlayer.tsx and preview-configs.ts (unused vars, `as any`, `no-explicit-any`)
- **`generate-protos`**: `make protos` included `gen-sdk-docs` requiring Node.js/TypeDoc, but CI only had Go/Buf
- Root cause: root `lint` target did not cover the site's ESLint; `protos` conflated stubs with doc generation
- Fixes: removed dead code, used idiomatic `create(AgentStatusSchema, ...)`, added justified eslint-disable, added `$(MAKE) -C site lint` to root `lint`, separated `protos` (stubs) from `codegen` (stubs + SDK docs)
- Commit: `5ff86e6d fix: resolve CI lint failures and close Makefile lint/protos gap`

### Session 8 Results (T07 TSDoc backfill for remaining 12 domains) — COMPLETE
Completed TSDoc backfill for all 12 remaining domains, achieving 100% coverage across the entire SDK. Key outcomes:
- **361/361 exports documented (100%)**, **159/159 interfaces documented (100%)**
- All 18 domains at 100% documentation coverage with zero poor field-level interfaces
- 3-batch strategy: small (5 domains, 17 exports), medium (5 domains, 35 exports), large (2 domains, 32 exports)
- 17 MDX pages regenerated with complete field descriptions
- Field-level cleanup: resolved all 6 remaining interfaces under 50% field coverage (GitHubRepo, GitHubUser, GitHubBranch, TriggerApprovalPolicyResult, AttachmentEntry, SendFollowUpOptions)
- TypeDoc JSON: 0 errors; `tsc --noEmit`: clean
- See checkpoints/2026-04-04-session-8.md for full details

### Session 7 Results (T05 TSDoc backfill) — COMPLETE
Added TSDoc summaries and field-level documentation to every exported interface, type alias, variable, and context across the five priority domains (core, composer, session, agent, execution). All five domains now at 100% documentation coverage. Overall SDK coverage moved from ~57% to 76.5% (276/361 exports). Key outcomes:
- 65 source files in `sdk/react/src/` received TSDoc additions
- 5 MDX pages regenerated with complete field descriptions
- Standardized patterns for `className`, mutation returns, query returns, `{@link}` cross-references
- TypeDoc JSON: 0 errors; `tsc --noEmit`: clean; Coverage: 100% on all 5 priority domains
- See checkpoints/2026-04-04-session-7.md for full details

### Session 6 Results (full preview coverage) — COMPLETE
Expanded component preview system from 5 to 54 components (92% of 59 exported SDK components). Key outcomes:
- Fixed SessionComposer missing Workspace toolbar button (`workspace` prop was not passed)
- Enriched AgentDetailView with all 6 renderable sections (MCP servers, skills, sub-agents, env vars, timestamps)
- Added 49 new preview configs with coherent "Acme Corp support-agent" narrative
- Built 10 shared mock data helpers (`buildRichAgent`, `buildSampleExecution`, etc.) for DRY preview data
- 5 deliberate skips: StigmerProvider, FolderBrowser, GitHubRepoPicker, ApprovalPolicyGeneratorPanel, ArtifactPreviewModal
- Regenerated all 17 MDX pages — 54 `<ComponentPreview>` tags total
- See checkpoints/2026-04-04-session-6.md for full details

### Session 5 Results (component preview system) — COMPLETE
Built a data-driven live component preview system for SDK reference pages. Key outcomes:
- 3 new files: `preview-configs.ts` (registry), `ComponentPreview.tsx` (MDX component with click-to-reveal), `PreviewShell.tsx` (styled wrapper)
- Click-to-reveal UX: collapsed toggle bar, deferred rendering on click
- 5 components with previews: SessionComposer, ModelSelector, AgentDetailView, ErrorMessage, ApiKeyListPanel
- MDX generator auto-emits `<ComponentPreview>` tags for registered components
- SessionComposer shows full toolbar (Configure menu with Agent/MCP/Skills) at realistic width
- Per-preview width control via `previewClassName` in config
- See checkpoints/2026-04-04-session-5.md for full details

### T04 Results (overview page links) — COMPLETE
Wired the hand-written overview page to all 17 generated domain reference pages. Key outcomes:
- All 16 domain names in the "Hooks and components" table are now markdown links to their generated pages
- Added cross-reference from the inline core exports note to `core.mdx` for full type signatures
- Replaced stale "planned" paragraph with a concise bridge sentence
- Updated "What's next" cards: now point to Session, Execution, and Agent domain pages (the three highest-traffic React SDK domains) instead of base SDK resource pages
- See checkpoints/2026-04-04-session-4.md for full details

### T03 Results (MDX generator script) — COMPLETE
Full TypeDoc-to-MDX generator built and integrated. Key outcomes:
- 6 TypeScript modules (1,569 lines) in `site/scripts/generate-react-sdk-docs/`
- Generates 17 domain pages (6,994 lines of MDX) + `meta.json`
- Fully wired into `make codegen` via composite `gen-sdk-docs` target (`make protos` is stubs-only as of session 9)
- CI staleness check via `gen-react-sdk-docs-check`
- All pages render in Fumadocs with proper sidebar navigation, breadcrumbs, TypeTable components
- Edge cases fixed: domain misclassification, utility function detection, enum handling, aria-label MDX parsing, Fumadocs folder page convention
- See checkpoints/2026-04-04-session-3.md for full details

### T01 Results (TypeDoc setup + proof of concept) — COMPLETE
TypeDoc 0.28.18 is configured and producing JSON. Key findings:
- 354 exports captured (159 functions, 159 interfaces, 29 type aliases, 7 variables)
- 57.6% overall TSDoc coverage; functions at 98.7%, interfaces at 20.1%
- Domain grouping via source paths is reliable (18 domains detected)
- @example blocks present on 116 exports
- Re-exported external types excluded (link to proto docs instead)
- See tasks/T01_1_execution.md for full analysis

### T02 Results (TSDoc coverage audit + writing guidelines) — COMPLETE
Comprehensive audit completed. Key findings:
- The gap is entirely in interfaces: Props at 1.8%, Return at 0.0%
- Functions (hooks + components) are at 98.7% — essentially done
- 150 undocumented exports: 116 mechanical (one-liner), 22 light authoring, 12 minor
- 48 interfaces have <50% field-level coverage
- Created reusable `tsdoc-coverage` script, TSDoc writing guidelines, TypeDoc validation
- Prioritized 5 domains for T05: session, execution, agent, composer, core
- See tasks/T02_1_execution.md for full audit data

### Context from Parent T06
The hand-written React SDK overview page is now at `docs/sdk/react/index.mdx` (moved from `docs/sdk/react.mdx` for Fumadocs folder convention).
This is Layer 1. Layer 2 (per-domain reference pages) is now generated by T03.
Layer 1 now links to Layer 2 via T04.

## Next Steps

All planned tasks and polish items are complete. The React SDK documentation pipeline is fully operational:
- 100% TSDoc coverage on all 361 exports across 18 domains
- 100% @example coverage on all publicly exported hooks and components
- Multi-example rendering (hooks with 2+ examples show all of them)
- 17 auto-generated MDX reference pages with rich code examples
- Live component previews for 54/59 components
- CI staleness check via `gen-react-sdk-docs-check`
- Generator: zero dead code, PEP 8-compliant Python examples

Potential future work:
1. Add `@returns` tags to hooks (currently 1.5%)
2. Enhance `@param` docs on remaining hooks (currently 46.3%)

## Quick Commands

After loading context:
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides portable paths to all project resources for quick context loading.*
