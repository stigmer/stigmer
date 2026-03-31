# Vocabulary Guide — Single Source of Truth for Stigmer Terminology

**Date**: March 31, 2026

## Summary

Created `docs/vocabulary.md` as the single authoritative source for all Stigmer terminology. The guide defines 19 terms across three tiers, maps each to the correct phrasing for five writing contexts (sales site through reference docs), and documents 6 cross-repo inconsistencies with recommended resolutions. Four existing files that duplicated terminology definitions were updated to reference the guide instead.

## Problem Statement

Stigmer terminology definitions were scattered across four separate files, each with its own subset of terms and its own framing. No single source connected internal API names to user-facing language, and no rules existed for when to use which phrasing in which context.

### Pain Points

- `_roles/002_document_writer.md` defined 8 terms for AI writing context
- `docs/STYLE.md` listed 15 capitalized terms with formatting rules
- `site/src/components/docs/glossary.ts` held 11 tooltip definitions
- T01 plan had an inline 6-row vocabulary mapping table
- No file covered the full spectrum from sales copy to SDK reference
- Multiple cross-repo inconsistencies (README taglines, "Credential" concept, dual approval models) had no documented resolution path

## Solution

Created a single vocabulary guide at `docs/vocabulary.md` that serves as the authoritative source for all terminology decisions. Updated the four existing files to reference the guide instead of maintaining their own definitions.

## Implementation Details

### Vocabulary Guide Structure

1. **Writing contexts** — a table defining five registers (sales site, quickstart/tutorials, concepts/how-to, reference/SDK, README/GitHub) with audience, register description, and examples

2. **Quick-reference table** — a scannable matrix mapping every term to the correct phrasing per context, so writers can look up a term and immediately know what to write

3. **Term entries (19 terms, three tiers)**:
   - Tier 1 (core product concepts): Agent, Skill, MCP Server, Session, Workflow, Approval Flow — each with definition, user-facing alternative, API surface, capitalization rule, and good/bad examples per context
   - Tier 2 (platform structure): Organization, Project, Environment, Agent Instance, Agent Execution, Workflow Execution
   - Tier 3 (technical/internal): Sub-Agent, Durable Execution, resource model, gRPC/Protobuf, CNCF Serverless Workflow, Graphton, Stigmer Server, Agent Runner, Workflow Runner, Execution Context, Seedpack

4. **Inconsistency register** — 6 documented issues with file paths and recommended resolutions, pending human review

### De-duplication

- `docs/STYLE.md` — inline capitalization list replaced with reference
- `_roles/002_document_writer.md` — inline 8-term glossary replaced with reference
- `glossary.ts` — kept runtime definitions (needed for tooltips), added header comment marking `docs/vocabulary.md` as source
- T01 plan — inline vocabulary table marked as superseded

## Benefits

- Writers have a single place to look up any Stigmer term for any context
- No more conflicting definitions across files
- Context-specific rules prevent sales jargon in docs and technical language on the sales site
- The inconsistency register creates a clear queue of decisions to make
- New terms get added in one place, not four

## Impact

- Affects all future content creation: sales site, documentation, README, error messages, tooltips
- Foundation for the remaining Phase 1 deliverables (demo story, use cases, information architecture) which will use this vocabulary consistently
- Positions for Phase 2 (sales website rewrite) by establishing the exact language to use

## Related Work

- Positioning Document (`design-decisions/positioning.md`) — the messaging foundation this vocabulary guide implements
- Content Strategy project (`_projects/2026-03/20260331.01.content-strategy/`) — Phase 1, deliverable 2 of 5

---

**Status**: Complete (pending review of inconsistency register)
**Timeline**: Session 3 of content strategy project
