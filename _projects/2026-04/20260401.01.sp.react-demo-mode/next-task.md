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

- **Status**: Phase 1 complete — ready for Phase 2
- **Last Session**: 2026-04-01 (Session 1) — Planned and implemented Phase 1: DemoTransport and client factory
- **Active Task**: T01 — Phase 1 complete. Phase 2 (fixture data for Cloud quickstart scenario) is next.

## Session Progress (2026-04-01, Session 1)

- **T01 plan reviewed and approved** — architecture for mock-at-the-transport-layer approach
- **Phase 1 fully implemented** — DemoTransport, createDemoClient factory, types, barrel export, subpath export, integration tests
- **Key discoveries during code exploration**:
  - `@connectrpc/connect` v2.1.1 Transport interface has only 2 methods (`unary`, `stream`) not 4 — simpler mock
  - `createRouterTransport` exists as official test utility but NOT used — decided against it to avoid runtime dependency on `@connectrpc/connect` in `@stigmer/react`
  - `Stigmer` class has no transport injection point — used structural typing to create compatible plain object
- **Files created**:
  - `sdk/react/src/demo/types.ts` — FixtureRegistry, FixtureEntry, DemoScenario, rpcKey helper
  - `sdk/react/src/demo/transport.ts` — DemoTransport class with unary/stream fixture lookup, descriptive errors
  - `sdk/react/src/demo/client.ts` — createDemoClient factory constructing all 19 clients
  - `sdk/react/src/demo/index.ts` — barrel export for `@stigmer/react/demo`
  - `sdk/react/src/demo/__tests__/demo-client.test.tsx` — 9 tests (provider rendering, client completeness, transport unary/stream, error messages, rpcKey)
- **Files modified**:
  - `sdk/react/package.json` — added `"./demo"` subpath to exports and publishConfig
- **Verification**: `tsc --noEmit` passes, `tsc -p tsconfig.build.json` passes, 70/70 tests pass (9 new + 61 existing), zero linter errors

## Next Steps

1. **Phase 2** — Build fixture data for the Cloud quickstart scenario (`skillCreationScenario`):
   - Trace which RPCs the 5 target components call (MessageThread, SessionComposer, ArtifactsWidget, ResourceListView, SkillDetailView)
   - Build protobuf fixture data using `create()` from `@bufbuild/protobuf`
   - Package as a scenario ready for `createDemoClient()`
2. **Phase 3** — Fumadocs integration: add `@stigmer/react` to docs site, import styles, create MDX wrapper components
3. **Phase 4** — Additional scenarios (agentRunScenario, approvalFlowScenario, etc.)

## Context for Resume

- The demo module lives at `sdk/react/src/demo/` and is exported as `@stigmer/react/demo`
- The DemoTransport keys fixtures by `"<proto service typeName>/<method name>"` — use `rpcKey(ServiceDescriptor, "methodName")` to construct keys
- No changes were made to `@stigmer/sdk` public API — all 17 resource client classes + SearchClient + GitHubClient are constructed directly with the demo transport
- The `as unknown as Transport` cast is localized to one line in `createDemoClient` — this follows the same pattern as the existing test in `sdk/typescript/src/__tests__/gen/session-client.test.ts`
- `@connectrpc/connect` types resolve through the hoisted monorepo `node_modules` — no new dependency was added to `@stigmer/react`
- For Phase 2, refer to the hook-to-RPC mapping discovered during planning (documented in the plan at `~/.cursor/plans/phase_1_demotransport_e101db0a.plan.md`)

## Quick Commands

After loading context:
- "Start Phase 2" - Begin fixture data for Cloud quickstart scenario
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
