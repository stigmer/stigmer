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
- **Last Session**: 2026-03-31 — Phase 1 deliverables 1 and 2 of 5 completed (Positioning Document + Vocabulary Guide)
- **Active Task**: T01 — Phase 1, next deliverable: Demo Story Narrative

## Session Progress (2026-03-31, Session 3)

- **Vocabulary Guide completed**: `docs/vocabulary.md` (702 lines)
- Created as the single source of truth for all Stigmer terminology
- Organized in three parts:
  1. **Writing contexts** — five registers (sales site, quickstart/tutorials, concepts/how-to, reference/SDK, README) with rules for each
  2. **Term entries** — 19 terms across three tiers:
     - Tier 1 (core): Agent, Skill, MCP Server, Session, Workflow, Approval Flow
     - Tier 2 (platform structure): Organization, Project, Environment, Agent Instance, Agent/Workflow Execution
     - Tier 3 (technical/internal): Sub-Agent, Durable Execution, gRPC/Protobuf, resource model, CNCF Serverless Workflow, Graphton, server components, Execution Context, Seedpack
  3. **Inconsistency register** — 6 known inconsistencies documented with file paths and recommended resolutions (pending review)
- **De-duplicated terminology from 4 files**:
  - `docs/STYLE.md` — replaced inline capitalization list with reference to vocabulary guide
  - `_roles/002_document_writer.md` — replaced inline 8-term glossary with reference
  - `site/src/components/docs/glossary.ts` — added source-of-truth header comment
  - `_projects/.../tasks/T01_0_plan.md` — marked inline vocabulary table as superseded
- **Key decision**: Vocabulary guide placed at `docs/vocabulary.md` (not inside `_projects/`) so it can be referenced from any documentation artifact
- **Inconsistencies flagged for review** (not resolved autonomously):
  1. OSS README tagline ("agentic automation platform") contradicts positioning ("AI Agent Platform")
  2. Cloud README tagline ("SDK-first agent orchestration platform") also contradicts
  3. Document writer role audience definition conflicts with STYLE.md audience
  4. Cloud README lists "Credential" concept that doesn't exist in proto
  5. YAML shorthand (`mcpServers`) vs proto field name (`mcp_server_usages`)
  6. Two distinct approval mechanisms share the word "approval"

## Next Steps

1. **Demo Story Narrative** (`design-decisions/demo-story.md`) — Before/after story making the positioning concrete
2. **Use Case Library** (`design-decisions/use-cases.md`) — 4-5 industry-specific use case summaries
3. **Information Architecture** (`design-decisions/information-architecture.md`) — Site structure and docs nav tree
4. After Phase 1 is reviewed and approved, proceed to Phase 2 (Sales Website Content)

## Context for Resume

- All documentation infrastructure is preserved: Fumadocs config, Vale, MDX components, build pipeline, CI workflows
- The CLI doc generator (`gen-cli-docs`) can regenerate CLI reference docs at any time
- `Architecture.tsx` is still in the codebase but not rendered — useful patterns for Phase 2
- `docs/STYLE.md` and `docs/CONTRIBUTING.md` are preserved and still valid
- The full T01 plan with all 8 phases is in `tasks/T01_0_plan.md`
- The document writer role (`_roles/002_document_writer.md`) defines the writing standards
- **The positioning document is the source of truth for all messaging decisions** — all subsequent Phase 1 deliverables draw from it
- **The vocabulary guide (`docs/vocabulary.md`) is the single source of truth for all terminology** — definitions, user-facing alternatives, context-specific usage rules, capitalization, API field names, and good/bad examples
- The vocabulary guide contains an inconsistency register with 6 items pending review — these should be resolved before Phase 2

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

### 5. Project Documentation
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
4. [ ] Check current task status in `tasks/T01_0_plan.md`
5. [ ] Review any other design decisions in `design-decisions/`
6. [ ] Check coding guidelines in `coding-guidelines/`
7. [ ] Review lessons learned in `wrong-assumptions/` and `dont-dos/`
8. [ ] Continue with next Phase 1 deliverable (Demo Story Narrative)

## Quick Commands

After loading context:
- "Start demo story" - Begin next Phase 1 deliverable
- "Show project status" - Get overview of progress
- "Create checkpoint" - Save current progress
- "Review guidelines" - Check established patterns
- "Review inconsistencies" - Check vocabulary guide inconsistency register

---

*This file provides direct paths to all project resources for quick context loading.*
