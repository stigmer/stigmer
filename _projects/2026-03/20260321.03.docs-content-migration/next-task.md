# Next Task: 20260321.03.docs-content-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.03.docs-content-migration

**Description**: Clean slate rebuild of Stigmer documentation — delete all stale content, establish audience-first standards (platform builders + Diataxis framework), fix typography, set up Mermaid diagrams, rebuild home page with SDK icons, write top 5 concept docs from proto ground truth, and create a validated CLI quickstart.
**Goal**: Production-quality documentation site where every page is accurate, written for platform builders, visually polished, and follows established standards — with a home page that matches the quality bar of docs.temporal.io.
**Tech Stack**: Next.js 15.3.9, Fumadocs (MDX), TypeScript, Tailwind CSS v4, Mermaid
**Components**: docs/ (content — clean slate rebuild), site/src/app/docs/ (docs routes), site/src/app/globals.css (typography), site/src/components/mdx/mermaid.tsx (Mermaid component), site/source.config.ts (MDX plugins), docs/standards/ (standards), .cursor/rules/docs/ (rule enforcement), _reminders/ (audience reminder)

## Current State

- **Status**: In progress — Phases 0, 1 complete + enforcement strengthened, ready for Phase 2
- **Last Session**: 2026-03-21 (Session 3) — Strengthened docs enforcement backbone
- **Active Task**: Phase 2 — Docs Home Page

## Session Progress (2026-03-21, Session 3)

- Analyzed the full docs enforcement architecture (Cursor rules, reminders, standards files) and identified the gap: critical audience and process context only loaded when reminders were manually dragged into chat
- Strengthened `.cursor/rules/docs/documentation-standards.mdc` (auto-apply rule) to serve as the enforcement backbone:
  - Inlined platform builder audience definition (from reminder 007)
  - Inlined Diataxis framework mapping (from reminder 007)
  - Added "before writing" gate: three questions, required reading list, Doc Blueprint process
  - Inlined five mandates (from reminder 004)
  - Added quality checklist (from reminder 004)
- Reminders 004 and 007 no longer need to be manually dragged for docs work — their critical content fires automatically
- Committed: `7d810806 docs(rules): strengthen auto-apply docs rule with inlined audience and enforcement context`

## Session Progress (2026-03-21, Session 2)

- Completed all 4 deliverables of Phase 1 (Clean Slate + Visual Foundation)
- Committed: `665d96ab docs(site): add Mermaid rendering and docs typography overrides`

## Next Steps

1. **Start Phase 2: Docs Home Page**
   - Rebuild `docs/index.mdx` with compelling hero copy for platform builders
   - Add SDK/language icon row: Go, Java, Python, React, TypeScript (colorful icons like Temporal's)
   - Add section cards pointing to content sections (Quickstarts, Concepts, Guides, CLI, SDK, Architecture)
   - Cards for unpopulated sections show "Coming Soon" state
   - Change sidebar label from "Stigmer Docs" to "Home" in `docs/meta.json`
   - May need custom MDX component or inline SVGs for SDK icons
   - May need to register new components in `site/src/app/docs/[[...slug]]/page.tsx`

2. **Phase 3**: Top 5 Concepts from protos (after Phase 2)
3. **Phase 4**: Validated CLI Quickstart (after Phase 3)
4. **Phase 5**: Verification (after Phase 4)

## Context for Resume

- Phase 0 established the audience foundation (platform builders, Diataxis framework)
- Phase 1 established the visual foundation (clean slate, typography, Mermaid)
- Session 3 strengthened enforcement — `.cursor/rules/docs/documentation-standards.mdc` now auto-applies full audience context, Diataxis framework, Doc Blueprint process, and quality checklist when any `docs/**` file is touched
- The approved plan is at `_projects/2026-03/20260321.03.docs-content-migration/tasks/T01_2_revised_plan.md`
- Mermaid is now fully wired — ` ```mermaid` code blocks in MDX render automatically as diagrams
- Typography is scoped to `#nd-page .prose` — marketing site is unaffected
- Node.js 20 required for builds: `nvm use 20`
- Branch: `feat/add-docs`

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260321.03.docs-content-migration/checkpoints/2026-03-21-session-3.md
```

### 2. Previous Checkpoints
```
_projects/2026-03/20260321.03.docs-content-migration/checkpoints/2026-03-21-session-2.md
_projects/2026-03/20260321.03.docs-content-migration/checkpoints/2026-03-21-session-1.md
```

### 3. Approved Plan
```
_projects/2026-03/20260321.03.docs-content-migration/tasks/T01_2_revised_plan.md
```

### 4. Key Reminders to Load
- `_reminders/001_plan-first.md`
- `_reminders/002_collaboration-principles.md`
- `_reminders/003_platform-for-platforms.md`
- ~~`_reminders/004_documentation-standards.md`~~ — now auto-applied via `.cursor/rules/docs/documentation-standards.mdc`
- ~~`_reminders/007_documentation-for-platform-builders.md`~~ — now auto-applied via `.cursor/rules/docs/documentation-standards.mdc`

## Approved Plan

The revised plan is at:
```
_projects/2026-03/20260321.03.docs-content-migration/tasks/T01_2_revised_plan.md
```

**6 phases** (each independently shippable):

| Phase | What | Status |
|---|---|---|
| **0. Audience & Purpose** | New reminder (007), update standards/role/rules with platform builder focus + Diataxis framework | **Complete** |
| **1. Clean Slate + Visual Foundation** | Delete ~119 stale files, fix typography CSS, set up Mermaid | **Complete** |
| **2. Home Page** | SDK icons (Go, Java, Python, React, TS), better copy, "Home" sidebar label | Next |
| **3. Top 5 Concepts** | Rebuild from protos: Stigmer, Agent, AgentExecution, Session, Workflow | Pending |
| **4. Quickstart** | Validated CLI quickstart — every command tested against real implementation | Pending |
| **5. Verification** | Lint, build, link check, visual review | Pending |

## Quick Commands

After loading context:
- "Start Phase 2" — Begin docs home page
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260321.03.docs-content-migration/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
