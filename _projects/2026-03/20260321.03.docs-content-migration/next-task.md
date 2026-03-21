# Next Task: 20260321.03.docs-content-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.03.docs-content-migration

**Description**: Clean slate rebuild of Stigmer documentation — delete all stale content, establish audience-first standards (platform builders + Diataxis framework), fix typography, set up Mermaid diagrams, rebuild home page with SDK icons, write top 5 concept docs from proto ground truth, and create a validated CLI quickstart.
**Goal**: Production-quality documentation site where every page is accurate, written for platform builders, visually polished, and follows established standards — with a home page that matches the quality bar of docs.temporal.io.
**Tech Stack**: Next.js 15.3.9, Fumadocs (MDX), TypeScript, Tailwind CSS v4, Mermaid
**Components**: docs/ (content — clean slate rebuild), site/src/app/docs/ (docs routes), site/src/app/globals.css (typography), docs/standards/ (standards updates), .cursor/rules/docs/ (rule updates), _reminders/ (new audience reminder), _roles/002 (role update)

## Current State

- **Status**: In progress — Phase 0 complete, ready for Phase 1
- **Last Session**: 2026-03-21 — Completed Phase 0 (Audience & Purpose Foundation)
- **Active Task**: Phase 1 — Clean Slate + Visual Foundation

## Session Progress (2026-03-21)

- Completed all 5 deliverables of Phase 0 (Audience & Purpose Foundation)
- Created `_reminders/007_documentation-for-platform-builders.md` — defines platform builder audience, Diataxis framework, time-to-value north star, content validation rules
- Updated `docs/standards/documentation-standards.md` — added Audience & Purpose as first section, changed Diagrams to Mermaid-only
- Updated `_reminders/004_documentation-standards.md` — added audience context and cross-reference to reminder 007
- Updated `_roles/002_document_writer.md` — replaced generic audience with platform builder focus, added Diataxis awareness, added time-to-value principle
- Updated `.cursor/rules/docs/documentation-standards.mdc` — added Audience section, Content Validation section, strengthened Diagrams to Mermaid-only

## Next Steps

1. **Start Phase 1: Clean Slate + Visual Foundation**
   - Delete all stale docs content (~119 files) — everything under `docs/` except `docs/standards/`
   - Create minimal `docs/index.mdx` placeholder so the site builds
   - Create minimal `docs/meta.json`
   - Fix docs typography/spacing CSS (`site/src/app/globals.css`)
   - Set up Mermaid rendering in Fumadocs
   - Verify `yarn build` succeeds (Node 20 required: `nvm use 20`)

2. **Phase 2**: Docs Home Page (after Phase 1)
3. **Phase 3**: Top 5 Concepts from protos (after Phase 2)
4. **Phase 4**: Validated CLI Quickstart (after Phase 3)
5. **Phase 5**: Verification (after Phase 4)

## Context for Resume

- Phase 0 established the audience foundation that all subsequent phases depend on
- The approved plan is at `_projects/2026-03/20260321.03.docs-content-migration/tasks/T01_2_revised_plan.md`
- The "What We Delete" table in the plan lists every directory and file to remove in Phase 1
- `docs/standards/` must be preserved — it is NOT deleted
- Node.js 20 required for builds: `nvm use 20`

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260321.03.docs-content-migration/checkpoints/2026-03-21-session-1.md
```

### 2. Approved Plan
```
_projects/2026-03/20260321.03.docs-content-migration/tasks/T01_2_revised_plan.md
```

### 3. Key Reminders to Load
- `_reminders/001_plan-first.md`
- `_reminders/002_collaboration-principles.md`
- `_reminders/003_platform-for-platforms.md`
- `_reminders/004_documentation-standards.md`
- `_reminders/007_documentation-for-platform-builders.md`

## Approved Plan

The revised plan is at:
```
_projects/2026-03/20260321.03.docs-content-migration/tasks/T01_2_revised_plan.md
```

**6 phases** (each independently shippable):

| Phase | What | Status |
|---|---|---|
| **0. Audience & Purpose** | New reminder (007), update standards/role/rules with platform builder focus + Diataxis framework | **Complete** |
| **1. Clean Slate + Visual Foundation** | Delete ~119 stale files, fix typography CSS, set up Mermaid | Next |
| **2. Home Page** | SDK icons (Go, Java, Python, React, TS), better copy, "Home" sidebar label | Pending |
| **3. Top 5 Concepts** | Rebuild from protos: Stigmer, Agent, AgentExecution, Session, Workflow | Pending |
| **4. Quickstart** | Validated CLI quickstart — every command tested against real implementation | Pending |
| **5. Verification** | Lint, build, link check, visual review | Pending |

## Quick Commands

After loading context:
- "Start Phase 1" — Begin clean slate + visual foundation
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260321.03.docs-content-migration/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
