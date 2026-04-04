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
**Last Session**: 2026-04-04 (session 6) — Full component preview coverage expansion
**Current Task**: T05 (TSDoc backfill for priority domains)
**Status**: T01 COMPLETE, T02 COMPLETE, T03 COMPLETE, T04 COMPLETE, previews COMPLETE (54/59 components), T05 next

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
- Fully wired into `make protos` via composite `gen-sdk-docs` target
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

1. **T05**: TSDoc backfill for under-documented interfaces (session, execution, agent, composer, core domains prioritized)
2. **T07**: Remaining TSDoc backfill + polish for all other domains

## Quick Commands

After loading context:
- "Continue with T05" - Start TSDoc backfill for priority domains
- "Continue with T07" - Start remaining domain backfill
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides portable paths to all project resources for quick context loading.*
