# Checkpoint: Session 1 — Governance and Strategy

**Date**: 2026-04-01
**Status**: Complete
**Next**: Session 2 (ScenarioPlayer Prototype)

## What was delivered

### 1A. Document writer role (`_roles/002_document_writer.md`)

New section "Tutorial and learning path standards" added between "Documentation
standards to follow" and "Stigmer terminology." Contains 6 actionable
principles, each with a concrete test or example:

1. **Narrative continuity** — sequential pages reference previous + motivate next
2. **Aha-moment design** — identify, state, deliver, and reinforce the payoff
3. **Progressive concept introduction** — one concept per page, defer the rest
4. **Implicit defaults** — use platform defaults, configure only when needed
5. **Embedded component standards** — real `@stigmer/react` components, animated playback
6. **Page bridging pattern** — "Next step" answers what's missing and what's next

Plus a "Structural path decisions" sub-section that defers to the IA for
entry-point ordering and path convergence (avoids duplicating the cloud-primary
principle).

### 1B. Information architecture (3 targeted edits)

1. **Site map table**: Cloud Quickstart → "sign up, API key, install SDK, create
   session, send message — 5 minutes. Uses the implicit assistant agent."
2. **Getting Started detail**: quickstart.mdx → no agent creation, skill creation
   deferred to first-skill.mdx.
3. **Learning paths section**: Added path quality requirement — every page must
   bridge to the next with a functional gap.

### 1C. ScenarioPlayer design decision

New file: `design-decisions/scenario-player.md`

Documents the problem (static demos), chosen approach (timed fixture delivery to
real components), technical sketch, dependencies (`framer-motion`, demo
infrastructure), rejected alternatives (video, screenshots, off-the-shelf
libraries), risks, and prototype-first strategy.

### 1D. Docs sidebar

Removed `links` array (Use Cases, GitHub) from `layout.shared.tsx`
`baseOptions()`. These marketing links belonged in the marketing site's
Header/Footer only. `baseOptions()` is used exclusively by the docs layout.

## Verification

- `tsc --noEmit`: pass
- `yarn build`: pass (13 static pages, zero errors)
- No linter errors introduced

## Files changed

| File | Change |
|------|--------|
| `_roles/002_document_writer.md` | Added tutorial/learning-path standards section |
| `_projects/2026-03/.../information-architecture.md` | 3 targeted edits (quickstart scope, detail, learning paths) |
| `_projects/2026-04/.../design-decisions/scenario-player.md` | New file |
| `site/src/lib/layout.shared.tsx` | Removed marketing links from baseOptions() |

## Observations for Session 2

- The current `quickstart.mdx` is significantly misaligned with the IA (includes
  skill creation, 10 min instead of 5). This is a Session 3 rewrite, not Session 2.
- `framer-motion` is not yet installed in `site/`. Session 2 will need to add it.
- The `DemoSkillCreation` pattern (Provider + DemoTransport + MessageThread) is
  the direct foundation for ScenarioPlayer. Prototype should extend, not replace.
