# Next Task: 20260331.01.content-strategy

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260331.01.content-strategy

**Description**: Define content strategy and build content for Stigmer sales website (stigmer.ai) and documentation site (stigmer.ai/docs), targeting platform builders and founders who want to add AI agent capabilities to their products.
**Goal**: Create compelling sales website positioning (agents that work for your business), a progressive documentation experience (5-min skills-only quickstart to full agent tutorials), and a reference sample application.
**Tech Stack**: Next.js 15, MDX/Fumadocs, Tailwind 4, TypeScript, Go (sample app)
**Components**: site/ (marketing website), docs/ (documentation content), examples/ (sample reference app), site/src/components/ (homepage sections), site/src/lib/constants.ts (site config/features)

## Current State

- **Status**: In Progress
- **Last Session**: 2026-03-31 — Phase 0 (Clean Slate) completed
- **Active Task**: T01 — Phase 0 complete, Phase 1 (Positioning & Messaging) is next

## Session Progress (2026-03-31)

- **Phase 0 completed**: Removed all stale documentation content and infrastructure-engineer-focused sales copy
- Deleted `docs/_archive/` (116 legacy files)
- Deleted all active docs content across 10 subdirectories (61 .mdx files + 10 meta.json files)
- Updated `docs/meta.json` to empty pages, rewrote `docs/index.mdx` to minimal landing
- Gutted sales website copy: `constants.ts`, `Hero.tsx`, `Features.tsx`, `Quickstart.tsx`
- Removed Architecture section from homepage rendering (kept file for Phase 2 reference)
- Updated Footer to remove dead links (Resources column removed)
- Build verified: `yarn build` passes cleanly

## Next Steps

1. **Phase 1: Positioning & Messaging Foundation** — This is the strategic foundation everything else depends on
   - Create positioning document (`design-decisions/positioning.md`)
   - Write demo story narrative (`design-decisions/demo-story.md`)
   - Build use case library (`design-decisions/use-cases.md`)
   - Establish vocabulary guide (`coding-guidelines/vocabulary.md`)
   - Define information architecture (`design-decisions/information-architecture.md`)
2. After Phase 1 is reviewed and approved, proceed to Phase 2 (Sales Website Content)

## Context for Resume

- All documentation infrastructure is preserved: Fumadocs config, Vale, MDX components, build pipeline, CI workflows
- The CLI doc generator (`gen-cli-docs`) can regenerate CLI reference docs at any time
- `Architecture.tsx` is still in the codebase but not rendered — useful patterns for Phase 2
- `docs/STYLE.md` and `docs/CONTRIBUTING.md` are preserved and still valid
- The full T01 plan with all 8 phases is in `tasks/T01_0_plan.md`
- The document writer role (`_roles/002_document_writer.md`) defines the writing standards

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/tasks/T01_0_plan.md
```

### 3. Project Documentation
- **README**: `/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/README.md`

## Knowledge Folders to Check

### Design Decisions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/
```

### Coding Guidelines
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/coding-guidelines/
```

### Wrong Assumptions
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/wrong-assumptions/
```

### Don't Dos
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/dont-dos/
```

## Resume Checklist

When starting a new session:

1. [ ] Read the latest checkpoint from `checkpoints/`
2. [ ] Check current task status in `tasks/T01_0_plan.md`
3. [ ] Review any design decisions in `design-decisions/`
4. [ ] Check coding guidelines in `coding-guidelines/`
5. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
6. [ ] Continue with Phase 1 (Positioning & Messaging Foundation)

## Quick Commands

After loading context:
- "Start Phase 1" - Begin positioning and messaging work
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
