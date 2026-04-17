# Next Task: 20260417.02.scenar-product

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Scenar Product Extraction

**Description**: Extract the demo video framework from Stigmer into a standalone open-source product called Scenar. Users bring their React components, define scenarios declaratively via proto-defined contracts, and get interactive web embeds + pixel-perfect MP4 videos from the same source. Real components, not screenshots. Live demos, not recordings.

**Goal**: Define the Scenar proto contract (separate from Stigmer protos), extract the generic engine, build a React SDK with createScenario(), and rewire Stigmer demos to import from the extracted package.

**Tech Stack**: TypeScript, React, Framer Motion, Remotion, Protobuf (buf)

**Repository**: [scenar-ai/scenar](https://github.com/scenar-ai/scenar) (public, open-source monorepo)

**Local Path**: `/Users/suresh/scm/github.com/scenar-ai/scenar`

## Task Roadmap

| Task | Title | Status | Depends On |
|------|-------|--------|------------|
| T01 | Define Scenar Proto Contract | DONE | — |
| T02 | Scaffold Directory & Buf Configuration | DONE (via T01) | T01 |
| T03 | Engine Extraction (zero @stigmer/* imports) | PENDING | T02 |
| T04 | Shells Extraction | PENDING | T03 |
| T05 | SDK — createScenario() | PENDING | T01, T03 |
| T06 | Rewire Stigmer Demos to Scenar Imports | PENDING | T03, T04 |
| T07 | Remotion Video Pipeline Integration | PENDING | T03, T06 |
| T08 | Standalone Example (validates extraction) | PENDING | T05, T06 |

## Completed: T01 — Define Scenar Proto Contract

**Status**: DONE — Committed and pushed to scenar-ai/scenar (e5e9a32)

**What was built**:
- 13 proto source files (6 scenario + 7 commons)
- Commons resource patterns (metadata, audit, visibility, kind, field options, pagination)
- Buf module `buf.build/scenar/apis` with standalone config
- Codegen templates for TypeScript, Go, Python
- Makefiles (root + apis) — `make protos` generates 72 stub files
- `buf lint` and `buf build` pass clean

**Design decisions applied**:
1. **Separate GitHub repo**: `scenar-ai/scenar` (not a subdirectory of stigmer)
2. **Zero Stigmer imports**: Scenar's own commons (`ai.scenar.commons.*`)
3. **Interactions embedded in Step**: Not a separate `map<int32, StepInteractions>` — each step owns its interactions for better YAML ergonomics
4. **No CursorStyle enum**: Cursor visual style is an engine concern, not scenario data
5. **No multi-org**: `ResourceMetadata` has no `org` field initially
6. **Forward-looking services**: command.proto and query.proto define the API for a future hosted Scenar service

## Current Task: T03 — Engine Extraction

**Status**: PENDING — Ready to start (T01 and T02 are done)

**Summary**: Extract the generic scenario engine from `site/src/components/docs/demos/engine/` into `scenar/engine/` with zero `@stigmer/*` imports. The engine components (ScenarioPlayer, Cursor, useStepInteractions, DemoViewport, ViewportTransformLayer, timeline, timing, scroll-utils, narration, TimeSource, PlaybackCoordinator, VideoExportContext) move to the Scenar package.

**Key challenge**: `engine/shared.ts` imports Stigmer protos for fixture data — this file stays in Stigmer (it's scenario-specific, not engine-generic).

## Key Design Decisions

1. **Separate GitHub repo**: `scenar-ai/scenar` under the `scenar-ai` GitHub organization. Domain: scenar.ai.
2. **Proto-first (hybrid approach)**: Proto defines the scenario contract. TypeScript types generated from protos. Users author in TS (with generated types) or YAML — both validate against the same schema.
3. **Zero Stigmer dependencies**: Scenar protos import only `buf/validate` and `google/protobuf`. Commons are Scenar's own (`ai.scenar.commons.*`).
4. **Embedded interactions**: Step owns its interactions. No separate interaction map keyed by step index.
5. **View is an opaque string**: The `view` field maps to React components via the scenario author's render function. Shells (AppShell, BrowserView) are product-specific, not modeled in the proto.
6. **Forward-looking services**: command.proto and query.proto define the API surface for a future hosted Scenar platform.

## Essential Files to Review

### Scenar Repository
```
/Users/suresh/scm/github.com/scenar-ai/scenar/
├── Makefile
├── apis/
│   ├── buf.yaml
│   ├── Makefile
│   ├── buf.gen.{ts,go,python}.yaml
│   ├── ai/scenar/
│   │   ├── commons/resource/     (metadata, enum, status, kind, field_options, rpc_service_options)
│   │   ├── commons/rpc/          (pagination)
│   │   └── scenario/v1/          (enum, spec, api, io, command, query)
│   └── stubs/{ts,go,python}/     (generated — 72 files)
```

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

### Existing Demo Engine (Extraction Source for T03)
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

- "Continue with T03" — Start the engine extraction
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress
- "Review guidelines" — Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
