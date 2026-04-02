# Next Task: 20260401.01.sp.react-demo-mode

## RULES OF ENGAGEMENT - READ FIRST

**When this file is loaded in a new conversation, the AI MUST:**

1. **DO NOT AUTO-EXECUTE** - Never start implementing without explicit user approval
2. **GATHER CONTEXT SILENTLY** - Read all project files without outputting
3. **PRESENT STATUS SUMMARY** - Show what's done, what's pending, agreed next steps
4. **SHOW OPTIONS** - List recommended and alternative actions
5. **WAIT FOR DIRECTION** - Do NOT proceed until user explicitly confirms

### Required Status Summary Format

When resuming this sub-project, present:

- **Parent Project**: 20260331.01.content-strategy
- **Overall Objective**: [1-2 sentences]
- **What's Been Completed**: [Key milestones]
- **What's Pending**: [Remaining work]
- **Agreed Focus for This Session**: [From previous session]
- **Options**: A (Recommended), B, C...

**WAIT for user to say "proceed", "go", or choose an option.**

---

## Parent Project

**Parent**: 20260331.01.content-strategy
**Parent Next Task**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/next-task.md`
**Spawned From Task**: T01

### Inherited Knowledge (CHECK THESE FIRST)

When resuming this sub-project, also review the parent's knowledge folders
for decisions, guidelines, and lessons that apply across all sub-projects:

- Parent Design Decisions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/`
- Parent Coding Guidelines: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/coding-guidelines/`
- Parent Wrong Assumptions: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/wrong-assumptions/`
- Parent Don't Dos: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/dont-dos/`

---

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this sub-project.

## Sub-Project: 20260401.01.sp.react-demo-mode

**Description**: Build a demo/mock mode for @stigmer/react that allows components to render with realistic sample data without a live Stigmer backend, enabling real product components to be embedded in documentation.
**Goal**: Create a mock StigmerProvider with demo data fixtures covering the key components needed for the Phase 3 Cloud quickstart: SkillDetailView (skill creation flow), MessageThread + SessionComposer (chat conversation), ArtifactsWidget (artifacts panel with push/apply), and ResourceListView (library view).
**Tech Stack**: Next.js 15, MDX/Fumadocs, Tailwind 4, TypeScript, Go (sample app)
**Components**: site/ (marketing website), docs/ (documentation content), examples/ (sample reference app), site/src/components/ (homepage sections), site/src/lib/constants.ts (site config/features)

## Essential Files to Review

### 1. Latest Checkpoint (if exists)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/checkpoints/
```

### 2. Current Task
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/tasks/
```

### 3. Project Documentation
- **README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/README.md`
- **Parent README**: `~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/README.md`

## Knowledge Folders to Check

### This Sub-Project's Knowledge
```
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/dont-dos/
```

### Parent Project's Knowledge (inherited)
```
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/coding-guidelines/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/wrong-assumptions/
~/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read parent's latest knowledge folders (design-decisions, coding-guidelines, wrong-assumptions, dont-dos)
2. [ ] Read this sub-project's latest checkpoint (if any) from `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/checkpoints/`
3. [ ] Check current task status in `~/scm/github.com/stigmer/stigmer/_projects/2026-04/20260401.01.sp.react-demo-mode/tasks/`
4. [ ] Review this sub-project's own knowledge folders
5. [ ] Continue with the next task or complete the current one

## Current Status

- **Status**: Phase 3 complete — ready for Phase 4
- **Last Session**: 2026-04-01 (Session 3) — Implemented Phase 3: Fumadocs integration
- **Active Task**: T01 — Phase 1, 2 & 3 complete. Phase 4 (Additional scenarios) is next.

## Session Progress (2026-04-01, Session 3)

- **Phase 3 fully implemented** — `@stigmer/react` components rendering inside Fumadocs MDX pages with demo infrastructure
- **Key decision: `file:` protocol over npm workspaces** — The site was originally standalone with yarn 4.5.1. Adding it to npm workspaces broke `next build` (webpack client compiler exits prematurely on Node 23). Solution: keep site standalone with `file:` protocol deps (`"@stigmer/react": "file:../sdk/react"`) installed via yarn, using `transpilePackages` in next.config.ts so Next.js compiles the TypeScript source directly.
- **Build fix: Node.js 23 incompatibility** — Discovered and resolved a pre-existing build failure where `next build` exits with code 0 but never completes client-side webpack compilation. Root cause: Node.js v23.1.0 (non-LTS) has a bug that drains the event loop during webpack client compilation. Fix: pinned `engines` to `^20.11.0 || ^22.0.0` and `.nvmrc` already set to `22`. Build must use `nvm exec 22`.
- **Peer dep fix** — Bumped `tailwind-merge` from `^2.6.0` to `^3.0.0` to satisfy `@stigmer/theme`'s peer dependency.
- **Files created**:
  - `site/src/components/docs/demos/DemoSessionComposer.tsx` — Client component wrapping SessionComposer in StigmerProvider with empty demo client
  - `docs/scratch/demo-test.mdx` — Test page embedding `<DemoSessionComposer />`
  - `docs/scratch/meta.json` — Sidebar entry for Scratch section
- **Files modified**:
  - `site/package.json` — Added `@stigmer/*` deps via `file:` protocol, `@bufbuild/protobuf`, `@connectrpc/connect`, `engines` field, bumped `tailwind-merge`
  - `site/next.config.ts` — Added `transpilePackages` for all `@stigmer/*` packages
  - `site/src/app/globals.css` — Imported `@stigmer/theme/tokens.css`, `@stigmer/react/styles.css`, added `@source` directive for Tailwind
  - `site/src/components/docs/index.ts` — Barrel export for `DemoSessionComposer`
  - `site/src/components/mdx.tsx` — Registered `DemoSessionComposer` in `getMDXComponents`
  - `site/yarn.lock` — Updated with new dependencies
- **Verification**: `tsc --noEmit` passes, `next build` (Node 22) compiles successfully in 15s, all 11 static pages generated including `/docs/scratch/demo-test`, SSR output contains expected markers (`stgm`, `role="form"`, `Ask anything` placeholder), zero lint errors

## Previous Sessions

- **Session 2 (2026-04-01)**: Phase 2 — Composable fixture infrastructure. See `checkpoints/2026-04-01-session-2.md`
- **Session 1 (2026-04-01)**: Phase 1 — DemoTransport and createDemoClient. See `checkpoints/2026-04-01-session-1.md`

## Next Steps

1. **Phase 4** — Additional scenarios (agentRunScenario, approvalFlowScenario, etc.) and sample data for remaining domains (org, apiKey, github)
2. **Richer demo wrappers** — Create MDX wrapper components for other SDK components (MessageThread, ArtifactsWidget, SkillDetailView) with proper fixture data using `buildScenario` + fixtures/samples
3. **Report back to parent project** — Phase 3 of the parent content-strategy project can now proceed with real `@stigmer/react` components in docs

## Context for Resume

- The demo module lives at `sdk/react/src/demo/` and is exported as `@stigmer/react/demo`
- **Site integration pattern**:
  - Site is NOT an npm workspace member — uses yarn 4 standalone with `file:` protocol deps
  - `transpilePackages` in `next.config.ts` tells Next.js to compile `@stigmer/*` TypeScript source
  - Build MUST use Node 22 LTS (`nvm exec 22 yarn next build`) — Node 23 has a fatal webpack bug
  - CSS: `globals.css` imports `@stigmer/theme/tokens.css` and `@stigmer/react/styles.css`; `@source` directive scans `@stigmer/react` for Tailwind classes
  - MDX components registered in `site/src/components/mdx.tsx`, wrappers live in `site/src/components/docs/demos/`
- **Consumer API (Phase 2)**:
  ```ts
  import { fixtures, samples, buildScenario, createDemoClient } from "@stigmer/react/demo";

  const scenario = buildScenario(
    fixtures.session.get(() => samples.session({ subject: "My topic" })),
    fixtures.agent.list(() => samples.searchResponse([...])),
    fixtures.agentExecution.subscribe(() => [samples.agentExecution(...)]),
  );
  const client = createDemoClient(scenario);
  ```
- **Why `buildScenario()` exists**: `agent.list()`, `skill.list()`, `mcpServer.list()` all go through `SearchService/search` (same RPC key). `buildScenario` merges them into a dispatch handler that routes by `ApiResourceKind`.
- Phase 1 context remains valid: DemoTransport, `rpcKey`, structural typing, no new dependencies.

## Quick Commands

After loading context:
- "Start Phase 4" - Begin additional scenarios
- "Create richer demo wrappers" - Build MDX wrappers for more components
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
