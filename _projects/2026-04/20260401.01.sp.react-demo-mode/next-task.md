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

- **Status**: Phase 2 complete — ready for Phase 3
- **Last Session**: 2026-04-01 (Session 2) — Implemented Phase 2: Composable fixture infrastructure
- **Active Task**: T01 — Phase 1 & 2 complete. Phase 3 (Fumadocs integration) is next.

## Session Progress (2026-04-01, Session 2)

- **Architectural refinement**: User challenged the original Phase 2 plan (fixed `skillCreationScenario` + 5 components). Redesigned to composable primitives covering all hooks — not just 5 components. Data is defined at the point of use, not pre-packaged.
- **Discovery: Search RPC multiplexing** — `agent.list()`, `skill.list()`, and `mcpServer.list()` all route through `SearchService/search` with different `kinds` values. This causes key collisions in a raw `Map`. Solved with `buildScenario()` which merges search handlers into a dispatch function.
- **Phase 2 fully implemented** — fixtures, samples, reference scenario, barrel export, 43 new tests
- **Files created**:
  - `sdk/react/src/demo/fixtures.ts` — 42 fixture entry helpers across 10 domains, `buildScenario()`, `FixtureSpec` type
  - `sdk/react/src/demo/samples.ts` — 14 sample data factories (7 resources + messages/artifacts + list responses) with flat override interfaces
  - `sdk/react/src/demo/scenarios/quickstart.ts` — Reference scenario: minimal session conversation demonstrating composition
  - `sdk/react/src/demo/__tests__/fixtures.test.ts` — 23 tests for fixture helpers, search multiplexing, scenario builder
  - `sdk/react/src/demo/__tests__/samples.test.ts` — 20 tests for all sample factories
- **Files modified**:
  - `sdk/react/src/demo/index.ts` — re-exports `fixtures`, `samples`, `buildScenario`, `FixtureSpec`, `quickstartScenario`
- **Verification**: `tsc --noEmit` passes, 113/113 tests pass (43 new + 70 existing), zero linter errors

## Previous Session Progress (2026-04-01, Session 1)

- **Phase 1 fully implemented** — DemoTransport, createDemoClient factory, types, barrel export, subpath export, integration tests
- See checkpoint `checkpoints/2026-04-01-session-1.md` for details

## Next Steps

1. **Phase 3** — Fumadocs integration: add `@stigmer/react` to docs site, import styles, create MDX wrapper components that use `createDemoClient` + `buildScenario` + fixtures/samples
2. **Phase 4** — Additional scenarios (agentRunScenario, approvalFlowScenario, etc.) and sample data for remaining domains (org, apiKey, github)

## Context for Resume

- The demo module lives at `sdk/react/src/demo/` and is exported as `@stigmer/react/demo`
- **New consumer API (Phase 2)**:
  ```ts
  import { fixtures, samples, buildScenario, createDemoClient } from "@stigmer/react/demo";

  const scenario = buildScenario(
    fixtures.session.get(() => samples.session({ subject: "My topic" })),
    fixtures.agent.list(() => samples.searchResponse([...])),
    fixtures.agentExecution.subscribe(() => [samples.agentExecution(...)]),
  );
  const client = createDemoClient(scenario);
  ```
- **Why `buildScenario()` exists**: `agent.list()`, `skill.list()`, `mcpServer.list()` all go through `SearchService/search` (same RPC key). `buildScenario` merges them into a dispatch handler that routes by `ApiResourceKind`. Using `new Map([...])` directly with these helpers would cause silent key collisions.
- **Fixture helpers mirror SDK shape**: `fixtures.session.get` → `client.session.get`, `fixtures.agentExecution.subscribe` → `client.agentExecution.subscribe`, etc. JSDoc on each documents which hooks consume that RPC.
- **Samples use flat overrides**: `samples.session({ subject: "custom" })` — the factory handles the `metadata`/`spec` nesting internally. Protobuf messages are mutable for deeper customization.
- **`quickstartScenario`** is a reference example, not a primary deliverable. It demonstrates the composition pattern.
- Phase 1 context remains valid: DemoTransport, `rpcKey`, structural typing, no new dependencies.

## Quick Commands

After loading context:
- "Start Phase 3" - Begin Fumadocs integration
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Check parent status" - Review parent project state

---

*This file provides portable paths to all project resources for quick context loading.*
