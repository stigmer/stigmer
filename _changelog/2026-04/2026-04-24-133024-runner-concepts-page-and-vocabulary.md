# Runner Concepts Page and Vocabulary Update

**Date**: April 24, 2026

## Summary

Added the runner concepts page to the documentation — the last missing core concept in the Stigmer docs. Every other first-class concept (Agents, Skills, Tools, Approval Flows, Sessions, Workflows, Environments, Organizations, Identity) already had a concept page. Runners did not. This page fills that vocabulary gap and establishes the link target that the desktop guide, CLI runner guides, and promotion surfaces will point to.

## Problem Statement

Six projects over the past week delivered a massive runner/desktop/CLI surface area: AgentRunner as a resource, `stigmer up`/`down`, bidi gRPC command streams, `stigmer://` launch tokens, Docker placement, React CRUD hooks, and a Tauri desktop app. The code shipped. The documentation did not keep pace.

### Pain Points

- No runner concept page — users encountered runners in the CLI, web console, and desktop app with no foundational explanation
- The vocabulary guide had no Runner entry in the quick-reference table
- The reading path jumped from Sessions directly to Workflows (a stub page), skipping the "where do agents actually execute?" question
- Downstream documentation (desktop guide, CLI runner guides, promotion pages) had no concept page to link to as a foundation

## Solution

Created `docs/concepts/runners.mdx` as a Diataxis Explanation page ("Here is why this matters"), following the established patterns from `agents.mdx`, `sessions.mdx`, and `tools.mdx`. Inserted it into the sidebar between Sessions and Workflows, updated the reading path bridges, added a Runner entry to `docs/vocabulary.md`, and built a live `RunnerListPanel` demo using real SDK components with fixture data.

## Implementation Details

### Runner concepts page (`docs/concepts/runners.mdx`, 167 lines)

Structured as six sections following the progressive understanding model:

1. **Opening** — What a runner is in plain language (the process that executes your agents)
2. **Runners in the platform** — Mermaid diagram extending the Agent → Instance → Session → Execution chain with Runner as the compute layer. Analogy table consistent with the one in `agents.mdx`.
3. **Local and cloud runners** — Comparison table covering who starts it, where it runs, lifecycle, visibility, and use cases
4. **Runner lifecycle** — State diagram (PENDING → READY ↔ BUSY → STOPPED, FAILED as terminal) with phase table and transition explanations
5. **How sessions find runners** — Three dispatch modes: auto, explicit selection, session binding
6. **Runners in the web console** — Live `RunnerListPanel` demo showing three runners in varied phases

### Live demo (`site/src/components/docs/demos/scenarios/runner-list-detail/index.tsx`)

- Uses the real `RunnerListPanel` from `@stigmer/react` — same component the production console renders
- Builds fixture data from proto schemas (`RunnerSchema`, `RunnerStatusSchema`, `RunnerConnectionInfoSchema`, `RunnerPhase`)
- Three fixture runners: one READY (macOS arm64 dev laptop), one BUSY (Linux x86_64 CI server with 3 active executions), one STOPPED (staging runner, 2h stale heartbeat)
- Wrapped in `PreviewProvider` with `connectFixture` for `RunnerQueryController.list`

### Vocabulary update (`docs/vocabulary.md`)

- Added Runner row to the quick-reference table between Session and Workflow
- Added a full Tier 1 detailed entry with:
  - User-facing alternatives per writing context (sales: "compute", quickstart: "runner (the process that runs your Agent)")
  - API surface (kind, prefix, proto paths, CLI commands)
  - Key fields (phase, task_queue, connection_info, current_executions)
  - Disambiguation from "Agent Runner" (the Python Temporal worker binary)
  - Good/bad examples across all five writing contexts

### Sidebar and reading path

- `docs/concepts/meta.json` — Added `"runners"` after `"sessions"`, before `"workflows"`
- `docs/concepts/sessions.mdx` — Updated "What's next" to bridge to Runners instead of Workflows
- `site/src/components/docs/index.ts` — Added `DemoRunnerListDetail` export
- `site/src/components/mdx.tsx` — Registered `DemoRunnerListDetail` in the MDX component map

## Benefits

- Every core Stigmer concept now has a concept page — no vocabulary gaps remain
- The reading path through Concepts follows a logical progression: what you build (Agents, Skills, Tools), how oversight works (Approval Flows), conversations (Sessions), where they execute (Runners), then automation (Workflows) and platform structure
- Downstream tasks (T03 desktop guide, T04 CLI runner guides, T06 download page) have a solid foundation to link to
- The vocabulary guide ensures consistent Runner terminology across all writing contexts

## Impact

- **Documentation readers** — Can now understand what runners are before encountering them in CLI commands, the desktop app, or Settings > Runners
- **Document writers** — Have a vocabulary entry with good/bad examples to guide consistent terminology
- **Downstream project tasks** — T03, T04, T06-T10 all reference the runner concept page as a link target

## Files Changed

| File | Change |
|------|--------|
| `docs/concepts/runners.mdx` | New: Runner concepts page (167 lines) |
| `site/src/.../runner-list-detail/index.tsx` | New: Live RunnerListPanel demo with fixture data |
| `docs/concepts/meta.json` | Added `runners` to sidebar after `sessions` |
| `docs/concepts/sessions.mdx` | Updated "What's next" bridge to point to Runners |
| `docs/vocabulary.md` | Added Runner to quick-reference table + Tier 1 entry |
| `site/src/components/docs/index.ts` | Added DemoRunnerListDetail export |
| `site/src/components/mdx.tsx` | Registered DemoRunnerListDetail in MDX component map |

## Related Work

- Part of project **20260424.01.desktop-app-promotion** (T02 of 11)
- Builds on six runner/desktop/CLI infrastructure projects (20260420.01 through 20260423.03)
- References content strategy project **20260331.01** for vocabulary and Diataxis standards
- Unblocks T03 (desktop guide) and T04 (CLI runner guides) which depend on T02

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
