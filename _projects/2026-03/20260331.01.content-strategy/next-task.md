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
- **Last Session**: 2026-03-31 — Phase 1 deliverable 1 of 5 completed (Positioning Document)
- **Active Task**: T01 — Phase 1, next deliverable: Vocabulary Guide

## Session Progress (2026-03-31, Session 2)

- **Positioning document completed**: `design-decisions/positioning.md` (343 lines)
- Resolved 4 strategic decisions:
  1. Audience: Technical founders (primary, sales site) / Developers (secondary, docs)
  2. Category: "AI Agent Platform" — validated as analyst-recognized category (Forrester, Gartner, market research firms)
  3. Cloud-primary positioning with open-source as trust signal
  4. Business-outcome headline leading, technical benefits supporting (not in hero)
- Defined 3 messaging pillars + 1 foundation pillar: Knows Your Business / Uses Your Tools / Asks Before Acting / Built for Production
- Recommended headline: "Build agents that work for your business"
- Recommended sub-headline: "Teach them your domain. Connect your tools. Set your rules."
- Established IS vs IS NOT boundaries, competitive framing, tone and voice guidance

## Next Steps

1. **Vocabulary Guide** (`coding-guidelines/vocabulary.md`) — Full mapping of internal terms to user-facing terms, with rules and examples for each context
2. **Demo Story Narrative** (`design-decisions/demo-story.md`) — Before/after story making the positioning concrete
3. **Use Case Library** (`design-decisions/use-cases.md`) — 4-5 industry-specific use case summaries
4. **Information Architecture** (`design-decisions/information-architecture.md`) — Site structure and docs nav tree
5. After Phase 1 is reviewed and approved, proceed to Phase 2 (Sales Website Content)

## Context for Resume

- All documentation infrastructure is preserved: Fumadocs config, Vale, MDX components, build pipeline, CI workflows
- The CLI doc generator (`gen-cli-docs`) can regenerate CLI reference docs at any time
- `Architecture.tsx` is still in the codebase but not rendered — useful patterns for Phase 2
- `docs/STYLE.md` and `docs/CONTRIBUTING.md` are preserved and still valid
- The full T01 plan with all 8 phases is in `tasks/T01_0_plan.md`
- The document writer role (`_roles/002_document_writer.md`) defines the writing standards
- **The positioning document is now the source of truth for all messaging decisions** — all subsequent Phase 1 deliverables draw from it

## Essential Files to Review

### 1. Latest Checkpoint
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/checkpoints/
```

### 2. Current Task
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/tasks/T01_0_plan.md
```

### 3. Positioning Document (Phase 1 foundation)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/positioning.md
```

### 4. Project Documentation
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
2. [ ] Read the positioning document at `design-decisions/positioning.md`
3. [ ] Check current task status in `tasks/T01_0_plan.md`
4. [ ] Review any other design decisions in `design-decisions/`
5. [ ] Check coding guidelines in `coding-guidelines/`
6. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
7. [ ] Continue with next Phase 1 deliverable (Vocabulary Guide)

## Quick Commands

After loading context:
- "Start vocabulary guide" - Begin next Phase 1 deliverable
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns

---

*This file provides direct paths to all project resources for quick context loading.*
