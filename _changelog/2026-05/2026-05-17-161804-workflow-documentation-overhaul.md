# Workflow Documentation Overhaul

**Date**: May 17, 2026

## Summary

Replaced the placeholder "coming soon" workflow documentation with comprehensive coverage across six new pages and one full rewrite. The documentation now spans three tiers — learn (concept page + quick start), build (authoring guide, task reference, patterns, execution lifecycle), and reference (existing auto-generated SDK pages) — giving workflows the same depth of documentation that agents already had.

## Problem Statement

The workflow engine shipped 20 task types, budgets, HITL, compensation, visual canvas editing, AI-assisted generation, and full SDK/CLI support across two major projects. But the documentation told users "documentation is coming soon" — a 36-line placeholder on the concept page, zero workflow quick start, and no authoring or task reference guides.

### Pain Points

- Users had no on-ramp for workflows — the getting-started flow was entirely agent-focused
- The 20 task types had no narrative documentation explaining when to use each
- Production-quality seedpack workflows were invisible to documentation readers
- The execution lifecycle (approve, signal, cancel, recover) had no guide outside the auto-generated SDK reference

## Solution

Created a three-tier documentation architecture:

- **Tier 1 (Learn)**: Rewrote the concept page with anatomy, resource chain diagram, task category table, execution model, budgets, and HITL. Added a workflow quick start to the getting-started flow.
- **Tier 2 (Build)**: Added an authoring guide covering full YAML syntax, a task type overview for all 20 kinds, a patterns page with 5 production recipes from seedpack, and an execution lifecycle guide.
- **Tier 3 (Reference)**: Existing auto-generated SDK pages and streaming guide, now cross-linked from the new handwritten pages.

## Implementation Details

**Pages created/rewritten:**

| File | Lines | Role |
|------|-------|------|
| `docs/concepts/workflows.mdx` | 253 | Full concept page (rewrite from 36-line placeholder) |
| `docs/getting-started/first-workflow.mdx` | 285 | 5-minute workflow quick start |
| `docs/guides/workflows.mdx` | 590 | Comprehensive authoring guide |
| `docs/guides/workflow-tasks.mdx` | 514 | Task type overview (all 20 kinds) |
| `docs/guides/workflow-execution.mdx` | 465 | Execution lifecycle guide |
| `docs/guides/workflow-patterns.mdx` | 575 | 5 patterns + anti-patterns |

**Navigation updates:**
- Added `first-workflow` to getting-started nav
- Added 4 workflow guide pages to guides nav

**Housekeeping:**
- Fixed "19 task kinds" to "20" in `task_kind_registry_query.proto`
- Fixed `docs/README.md` make target (`make docs` -> `make site`)
- Fixed broken link in `examples/README.md`

**Follow-up project documented:**
- Created `_projects/2026-05/20260517.02.workflow-task-codegen-docs/README.md` specifying codegen extension to auto-generate per-task reference pages

## Benefits

- Users can now go from zero to running a workflow in 5 minutes via the quick start
- All 20 task types are documented with "when to use", key fields, and YAML examples
- Production patterns (research pipelines, content review loops, triage routing) are discoverable as named recipes
- The execution lifecycle (approve, signal, cancel, recover) has a dedicated guide with SDK examples in 4 languages
- Anti-patterns section helps users avoid common mistakes

## Impact

- **Documentation site**: 6 new pages (~2,680 lines), 1 rewritten page, 2 nav updates
- **Workflow discoverability**: Workflows now have parity with agents in documentation depth
- **Developer onramp**: New getting-started page provides a clear path from agents to workflows

## Related Work

- Project: Bring Workflows to Foreground (`_projects/2026-05/20260508.01`)
- Project: E2E Workflow Testing Infrastructure (`_projects/2026-05/20260514.01`)
- Follow-up: Per-Task Codegen Reference (`_projects/2026-05/20260517.02`)

---

**Status**: Production Ready
**Timeline**: Single session
