# Next Task: 20260417.02.scenar-product

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Scenar Product Extraction

**Description**: Extract the demo video framework from Stigmer into a standalone open-source product called Scenar. Users bring their React components, define scenarios declaratively via proto-defined contracts, and get interactive web embeds + pixel-perfect MP4 videos from the same source. Real components, not screenshots. Live demos, not recordings.

**Goal**: Define the Scenar proto contract (separate from Stigmer protos), extract the generic engine, build a React SDK with createScenario(), and rewire Stigmer demos to import from the extracted package.

**Tech Stack**: TypeScript, React, Framer Motion, Remotion, Protobuf (buf)

**Components**: `scenar/` (new top-level directory: apis/, engine/, shells/, sdk/), `site/src/components/docs/demos/engine/` (extraction source), `site/src/components/docs/demos/views/` (extraction source), `site/video/` (Remotion integration)

## Task Roadmap

| Task | Title | Status | Depends On |
|------|-------|--------|------------|
| T01 | Define Scenar Proto Contract | PENDING | — |
| T02 | Scaffold Directory & Buf Configuration | PENDING | T01 |
| T03 | Engine Extraction (zero @stigmer/* imports) | PENDING | T02 |
| T04 | Shells Extraction | PENDING | T03 |
| T05 | SDK — createScenario() | PENDING | T01, T03 |
| T06 | Rewire Stigmer Demos to Scenar Imports | PENDING | T03, T04 |
| T07 | Remotion Video Pipeline Integration | PENDING | T03, T06 |
| T08 | Standalone Example (validates extraction) | PENDING | T05, T06 |

## Current Task: T01 — Define Scenar Proto Contract

**Status**: PENDING — Ready to start

**Plan file**: `_projects/2026-04/20260417.02.scenar-product/tasks/T01_0_plan.md`

**Summary**: Create the Scenar scenario proto contract in `scenar/apis/ai/scenar/scenario/v1/` (completely separate from Stigmer's `apis/`). Six proto files following the Stigmer API resource pattern: `enum.proto`, `spec.proto`, `api.proto`, `io.proto`, `command.proto`, `query.proto`. Zero Stigmer imports. The spec.proto is the core — it defines the full scenario choreography (steps, interactions, viewport config).

## Key Design Decisions

1. **Separate from Stigmer protos**: `scenar/apis/` at repo root, NOT inside `apis/ai/scenar/`. Scenar is its own product.
2. **Proto-first (hybrid approach)**: Proto defines the scenario contract. TypeScript types generated from protos. Users author in TS (with generated types) or YAML — both validate against the same schema.
3. **Zero Stigmer dependencies**: Scenar protos import only `buf/validate` and `google/protobuf`. ScenarioMetadata is Scenar-specific (not ApiResourceMetadata).
4. **Forward-looking services**: command.proto and query.proto define the API for a future hosted Scenar service.

## Essential Files to Review

### Task Plans
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.02.scenar-product/tasks/
```

### Knowledge Folders
- **Design Decisions**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.02.scenar-product/design-decisions/`
- **Coding Guidelines**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.02.scenar-product/coding-guidelines/`
- **Wrong Assumptions**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.02.scenar-product/wrong-assumptions/`
- **Don't Dos**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.02.scenar-product/dont-dos/`
- **Checkpoints**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-04/20260417.02.scenar-product/checkpoints/`

### Existing Demo Engine (Extraction Source)
- **Engine core**: `site/src/components/docs/demos/engine/`
- **Timing constants**: `site/src/components/docs/demos/engine/timing.ts`
- **DemoViewport**: `site/src/components/docs/demos/engine/DemoViewport.tsx`
- **Cursor**: `site/src/components/docs/demos/engine/Cursor.tsx`
- **Interactions**: `site/src/components/docs/demos/engine/useStepInteractions.ts`
- **Scroll utils**: `site/src/components/docs/demos/engine/scroll-utils.ts`
- **Video composition**: `site/video/compositions/DemoVideo.tsx`
- **Scenario registry**: `site/src/components/docs/demos/scenarios/registry.ts`

### Related Project (Demo Framework Hardening)
- **Next task**: `_projects/2026-04/20260416.02.demo-framework-hardening/next-task.md`
- **Coding guidelines**: `_projects/2026-04/20260416.02.demo-framework-hardening/coding-guidelines/`
- **Design decisions**: `_projects/2026-04/20260416.02.demo-framework-hardening/design-decisions/`

## Resume Checklist

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/`
3. [ ] Review design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with the current task

## Quick Commands

- "Continue with T01" — Start/resume the Scenar proto contract definition
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
