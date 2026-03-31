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
- **Last Session**: 2026-03-31 — Phase 1 deliverables 1, 2, 3, and 4 of 5 completed (Positioning Document + Vocabulary Guide + Demo Story Narrative + Use Case Library)
- **Active Task**: T01 — Phase 1, next deliverable: Information Architecture

## Session Progress (2026-03-31, Session 5)

- **Use Case Library completed**: `design-decisions/use-cases.md` (389 lines)
- Defined a reusable "fit pattern" — three conditions (per-tenant domain knowledge, system actions, risk-graduated decisions) that identify platforms where Stigmer adds value
- Wrote 5 industry-specific use cases, each framed as a SaaS founder adding an AI agent feature:
  - **Healthcare SaaS** — patient intake and triage agent (primary: approval flows for clinical decisions)
  - **HR / People platform** — employee onboarding assistant (primary: multi-step automation for onboarding workflows)
  - **FinTech / Banking-as-a-Service** — compliance monitoring agent (primary: per-client regulatory knowledge)
  - **EdTech** — course tutor and academic assistant (primary: persistent conversations across weeks)
  - **Legal tech** — contract analysis agent (primary: domain knowledge + approval flows for high-stakes decisions)
- Each use case follows a consistent structure: builder, challenge, how Stigmer powers it, proof interaction, outcome
- Created a capability coverage matrix showing pillar distribution across all 5 use cases
- Included Phase 2 notes with card-ready titles and one-liners for homepage "What You Can Build" section
- **Key decisions**:
  - No industry overlap with demo story (which covers e-commerce, property management, logistics)
  - Platform-builder lens throughout — every use case is a founder shipping agents as a product feature
  - Added "the pattern" section (not in original T01 spec) to help readers in unlisted industries self-identify
  - Sales-site vocabulary register enforced throughout; technical terms only in the coverage matrix headers
- **Quality review passed**: vocabulary compliance, positioning alignment, pillar coverage, cross-check with demo story, pattern generalization

## Next Steps

1. **Information Architecture** (`design-decisions/information-architecture.md`) — Site structure and docs nav tree
2. After Phase 1 is reviewed and approved, proceed to Phase 2 (Sales Website Content)

## Context for Resume

- All documentation infrastructure is preserved: Fumadocs config, Vale, MDX components, build pipeline, CI workflows
- The CLI doc generator (`gen-cli-docs`) can regenerate CLI reference docs at any time
- `Architecture.tsx` is still in the codebase but not rendered — useful patterns for Phase 2
- `docs/STYLE.md` and `docs/CONTRIBUTING.md` are preserved and still valid
- The full T01 plan with all 8 phases is in `tasks/T01_0_plan.md`
- The document writer role (`_roles/002_document_writer.md`) defines the writing standards
- **The positioning document is the source of truth for all messaging decisions** — all subsequent Phase 1 deliverables draw from it
- **The vocabulary guide (`docs/vocabulary.md`) is the single source of truth for all terminology** — definitions, user-facing alternatives, context-specific usage rules, capitalization, API field names, and good/bad examples
- **The demo story narrative (`design-decisions/demo-story.md`) defines the before/after transformation arc** — reusable framework, primary e-commerce story, variant sketches, and Phase 2 integration notes
- **The use case library (`design-decisions/use-cases.md`) demonstrates Stigmer's breadth** — 5 industries, fit pattern, capability coverage matrix, and Phase 2 card-ready content
- The vocabulary guide contains an inconsistency register with 6 items pending review — these should be resolved before Phase 2
- One technical note from the demo story review: the $200 refund threshold in Act 3 implies parameter-based approval rules — consistent with the positioning document's pattern ($500 threshold) but worth verifying against ToolApprovalPolicy capabilities

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

### 4. Vocabulary Guide (Phase 1 deliverable 2)
```
/Users/suresh/scm/github.com/stigmer/stigmer/docs/vocabulary.md
```

### 5. Demo Story Narrative (Phase 1 deliverable 3)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/demo-story.md
```

### 6. Use Case Library (Phase 1 deliverable 4)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/use-cases.md
```

### 7. Project Documentation
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
3. [ ] Read the vocabulary guide at `docs/vocabulary.md`
4. [ ] Read the demo story narrative at `design-decisions/demo-story.md`
5. [ ] Read the use case library at `design-decisions/use-cases.md`
6. [ ] Check current task status in `tasks/T01_0_plan.md`
7. [ ] Review any other design decisions in `design-decisions/`
8. [ ] Check coding guidelines in `coding-guidelines/`
9. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
10. [ ] Continue with next Phase 1 deliverable (Information Architecture)

## Quick Commands

After loading context:
- "Start information architecture" - Begin next Phase 1 deliverable
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Review inconsistencies" - Check vocabulary guide inconsistency register

---

*This file provides direct paths to all project resources for quick context loading.*
