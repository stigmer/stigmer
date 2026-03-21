# Next Task: 20260321.03.docs-content-migration

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260321.03.docs-content-migration

**Description**: Clean slate rebuild of Stigmer documentation — delete all stale content, establish audience-first standards (platform builders + Diataxis framework), fix typography, set up Mermaid diagrams, rebuild home page with SDK icons, write top 5 concept docs from proto ground truth, and create a validated CLI quickstart.
**Goal**: Production-quality documentation site where every page is accurate, written for platform builders, visually polished, and follows established standards — with a home page that matches the quality bar of docs.temporal.io.
**Tech Stack**: Next.js 15.3.9, Fumadocs (MDX), TypeScript, Tailwind CSS v4, Mermaid
**Components**: docs/ (content — clean slate rebuild), site/src/app/docs/ (docs routes), site/src/app/globals.css (typography), site/src/components/mdx/mermaid.tsx (Mermaid component), site/src/components/mdx/language-icons.tsx (SDK icons), site/source.config.ts (MDX plugins), docs/standards/ (standards), .cursor/rules/docs/ (rule enforcement), _reminders/ (audience reminder)

## Current State

- **Status**: In progress — Phases 0–3 complete, ready for Phase 4
- **Last Session**: 2026-03-21 (Session 5) — Completed Phase 3: Top 5 Concept Docs from Protos
- **Active Task**: Phase 4 — Validated CLI Quickstart

## Session Progress (2026-03-21, Session 5)

- Completed all Phase 3 deliverables (Top 5 Concept Docs from Protos):
  - Created `docs/concepts/` directory with `meta.json` and `index.mdx` section landing page
  - Wrote 5 concept docs from proto ground truth: what-is-stigmer, agent, agent-execution, session, workflow
  - Each doc follows `docs/standards/templates/concept.mdx`, includes Mermaid diagrams, YAML/CLI examples, and links proto definitions
  - Updated `docs/meta.json` to add concepts to sidebar
  - Updated `docs/index.mdx` Concepts card to link to new section (removed "Coming soon")
- Build verification: `yarn build` passes cleanly — 13 static pages generated including all 5 concept routes
- Key decision: Runtime resources (AgentExecution, Session) use CLI examples rather than YAML since they aren't authored as files

## Session Progress (2026-03-21, Session 4)

- Completed all Phase 2 deliverables (Docs Home Page):
  - Created `site/src/components/mdx/language-icons.tsx` — server component with inline SVG icons for Go, Java, Python, React, TypeScript in official brand colors
  - Registered `LanguageIcons` in the MDX component mapping in `site/src/app/docs/[[...slug]]/page.tsx`
  - Rebuilt `docs/index.mdx` with platform-builder-focused hero copy, SDK icon row, and six section navigation cards (all "Coming soon.")
  - Updated `docs/meta.json` sidebar title from "Docs" to "Home"
- Build verification: `yarn build` passes cleanly, page renders with all icons and cards in both light and dark themes
- Design decision: stayed within standard Fumadocs layout (PageRoot/PageArticle) rather than building a custom layout — content quality over layout complexity

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

1. **Start Phase 4: Validated CLI Quickstart**
   - Write a quickstart guide with commands tested against the real CLI implementation
   - Cover: install, configure, create agent, run agent, check execution status
   - Every command must be verified against `stigmer` CLI
   - Create `docs/quickstarts/` directory with meta.json and quickstart MDX

2. **Phase 5**: Verification (lint, build, link check, visual review)

## Context for Resume

- Phase 0 established the audience foundation (platform builders, Diataxis framework)
- Phase 1 established the visual foundation (clean slate, typography, Mermaid)
- Session 3 strengthened enforcement — `.cursor/rules/docs/documentation-standards.mdc` now auto-applies full audience context, Diataxis framework, Doc Blueprint process, and quality checklist when any `docs/**` file is touched
- Phase 2 built the docs home page — hero copy, SDK icons (Go, Java, Python, React, TypeScript), six section cards
- Phase 3 created 5 concept docs in `docs/concepts/` — each anchored to proto definitions from `apis/ai/stigmer/agentic/`
- Container analogy (Agent=Docker image, AgentInstance=config, Session=terminal, AgentExecution=docker run) is the core framing across all concept docs
- The `agent_call` task type is the key connection between Agent and Workflow execution models
- The LanguageIcons component is a server component (no 'use client') using inline SVGs — no external dependencies
- The Fumadocs Card/Cards components are already registered and used on the home page and concepts landing
- The approved plan is at `_projects/2026-03/20260321.03.docs-content-migration/tasks/T01_2_revised_plan.md`
- Mermaid is fully wired — ` ```mermaid` code blocks in MDX render automatically as diagrams
- Typography is scoped to `#nd-page .prose` — marketing site is unaffected
- Node.js 20 required for builds: `nvm use 20`
- Branch: `feat/add-docs`

## Essential Files to Review

### 1. Latest Checkpoint
```
_projects/2026-03/20260321.03.docs-content-migration/checkpoints/2026-03-21-session-5.md
```

### 2. Previous Checkpoints
```
_projects/2026-03/20260321.03.docs-content-migration/checkpoints/2026-03-21-session-4.md
_projects/2026-03/20260321.03.docs-content-migration/checkpoints/2026-03-21-session-3.md
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
| **2. Home Page** | SDK icons (Go, Java, Python, React, TS), better copy, "Home" sidebar label | **Complete** |
| **3. Top 5 Concepts** | Rebuild from protos: Stigmer, Agent, AgentExecution, Session, Workflow | **Complete** |
| **4. Quickstart** | Validated CLI quickstart — every command tested against real implementation | Next |
| **5. Verification** | Lint, build, link check, visual review | Pending |

## Quick Commands

After loading context:
- "Start Phase 4" — Begin validated CLI quickstart
- "Show project status" — Get overview of progress
- "Create checkpoint" — Save current progress

## Quick Resume

To continue this project, drag this file into chat:
`@_projects/2026-03/20260321.03.docs-content-migration/next-task.md`

---

*This file provides direct paths to all project resources for quick context loading.*
