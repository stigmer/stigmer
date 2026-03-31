# Next Task: 20260331.01.content-strategy

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: 20260331.01.content-strategy

**Description**: Define content strategy and build content for Stigmer sales website (stigmer.ai) and documentation site (stigmer.ai/docs), targeting platform builders and founders who want to add AI agent capabilities to their products.
**Goal**: Create compelling sales website positioning (agents that work for your business), a progressive documentation experience (5-min skills-only quickstart to full agent tutorials), and a reference sample application.
**Tech Stack**: Next.js 15, MDX/Fumadocs, Tailwind 4, TypeScript, Go (sample app)
**Components**: site/ (marketing website), docs/ (documentation content), examples/ (sample reference app), site/src/components/ (homepage sections), site/src/lib/constants.ts (site config/features)

## Current State

- **Status**: Phase 1 Complete — Pending Review
- **Last Session**: 2026-03-31 (Session 6) — Phase 1 deliverable 5 of 5 completed (Information Architecture)
- **Active Task**: T01 — All Phase 1 deliverables complete. Review all 5 before Phase 2.

## Session Progress (2026-03-31, Session 6)

- **Information Architecture completed**: `design-decisions/information-architecture.md` (771 lines)
- **Phase 1 is now complete** — all 5 deliverables produced
- Resolved three structural decisions through collaborative discussion:
  - **Directory structure**: IA proposes 6 directories replacing CONTRIBUTING.md's 9 (removed `integration/`, `architecture/`, `deployment/`, `contributing/`; added `tutorials/`)
  - **Sidebar organization**: Journey-then-topic. Diataxis stays as per-page writing quality rule, not navigation structure.
  - **vocabulary.md visibility**: Stays internal (`.md`, not `.mdx`). `<Term>` tooltips serve docs readers.
- Defined complete site map (3 marketing pages, 24 docs pages)
- Defined sales site top nav, 8 homepage sections, 3-column footer
- Designed docs sidebar with 6 sections: getting-started → concepts → tutorials → sdks → cli → reference
- Created concrete `meta.json` plans for every directory (Fumadocs separator syntax verified)
- Mapped 15 homepage CTAs and 5 navigation CTAs to specific target pages
- Defined 6 progressive learning paths (5-min to full-build)
- Identified 3 corrections needed for the document writer role
- **Quality review passed**: vocabulary compliance, positioning alignment, per-page content types, Fumadocs feasibility, internal consistency, T01 plan cross-reference

## Next Steps

1. **Review all Phase 1 deliverables** — positioning, vocabulary, demo story, use cases, information architecture
2. **Resolve vocabulary inconsistencies** — 6 items in the inconsistency register pending human decision
3. **Apply document writer role corrections** — 3 changes recommended by the information architecture (pre-Phase 3 task)
4. **Update CONTRIBUTING.md** — directory table to match new 6-directory structure (Phase 3 prerequisite)
5. **Resolve YAML shorthand question** — vocabulary inconsistency #5 must be resolved before Phase 3 quickstart content
6. **Begin Phase 2** — sales website content implementation

## Context for Resume

- All documentation infrastructure is preserved: Fumadocs config, Vale, MDX components, build pipeline, CI workflows
- The CLI doc generator (`gen-cli-docs`) can regenerate CLI reference docs at any time
- `Architecture.tsx` is still in the codebase but not rendered — useful patterns for Phase 2 "Why It Works" section
- `docs/STYLE.md` and `docs/CONTRIBUTING.md` are preserved and still valid (CONTRIBUTING.md directory table needs update before Phase 3)
- The full T01 plan with all 8 phases is in `tasks/T01_0_plan.md`
- The document writer role (`_roles/002_document_writer.md`) defines the writing standards — **3 corrections recommended by the IA** (writing-context awareness, Diataxis scope, analogy prohibition scoping)
- **The positioning document is the source of truth for all messaging decisions** — all Phase 1 deliverables draw from it
- **The vocabulary guide (`docs/vocabulary.md`) is the single source of truth for all terminology** — definitions, user-facing alternatives, context-specific usage rules, capitalization, API field names, and good/bad examples
- **The demo story narrative (`design-decisions/demo-story.md`) defines the before/after transformation arc** — reusable framework, primary e-commerce story, variant sketches, and Phase 2 integration notes
- **The use case library (`design-decisions/use-cases.md`) demonstrates Stigmer's breadth** — 5 industries, fit pattern, capability coverage matrix, and Phase 2 card-ready content
- **The information architecture (`design-decisions/information-architecture.md`) is the structural blueprint** — site map, navigation, docs sidebar, CTA mapping, learning paths, and meta.json plans
- The vocabulary guide contains an inconsistency register with 6 items pending review — these should be resolved before Phase 2
- Vocabulary inconsistency #5 (YAML shorthand vs proto field names) must be resolved before Phase 3
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

### 7. Information Architecture (Phase 1 deliverable 5)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-03/20260331.01.content-strategy/design-decisions/information-architecture.md
```

### 8. Project Documentation
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
6. [ ] Read the information architecture at `design-decisions/information-architecture.md`
7. [ ] Check current task status in `tasks/T01_0_plan.md`
8. [ ] Review any other design decisions in `design-decisions/`
9. [ ] Check coding guidelines in `coding-guidelines/`
10. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
11. [ ] Review Phase 1 deliverables and proceed to Phase 2

## Quick Commands

After loading context:
- "Review Phase 1" - Review all 5 deliverables before Phase 2
- "Start Phase 2" - Begin sales website content implementation
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Review inconsistencies" - Check vocabulary guide inconsistency register
- "Update document writer role" - Apply the 3 corrections from the IA

---

*This file provides direct paths to all project resources for quick context loading.*
