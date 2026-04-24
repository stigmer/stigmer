# Next Task: 20260424.01.desktop-app-promotion

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Desktop App Documentation + Promotion

**Description**: Close out documentation for six runner/desktop/CLI projects, then build a comprehensive desktop app promotion and distribution system across the web console and marketing site.
**Goal**: (1) Runners, desktop app, and CLI runner management are fully documented with concept pages, how-to guides, and SDK reference updates. (2) Users discover and install the Stigmer Desktop app through contextual, non-intrusive promotion in the console and a proper download page on the marketing site.
**Tech Stack**: TypeScript/React (Console), Next.js (marketing site + docs via Fumadocs), MDX, CSS/Tailwind
**Components**: docs/ (documentation), site/ (marketing site), client-apps/web/ (Console UI)

## Current State

- **Status**: Phase A complete (all 5 documentation tasks done). Ready for T06 (Phase B).
- **Last Session**: 2026-04-24 (Session 5) — T05 SDK runner docs quality gaps closed. Phase A complete.
- **Active Task**: None — ready to start T06.

## Session wrap-up (2026-04-24, Session 5)

- T05 original scope was already done: the React SDK docs generator had picked
  up `useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner` automatically.
  The `next-task.md` description was stale (written before last codegen run).
- Three quality gaps found and closed instead:
  1. Added `runner` to `DOMAIN_META` in React SDK docs generator parser —
     title now `Runner` (was lowercase `runner`), description now populated.
  2. Created `apis/ai/stigmer/agentic/runner/docs/overview.md` — Runner was
     the only agentic resource without one. Resources page now uses hand-crafted
     overview instead of spec-derived fallback.
  3. Deleted orphaned `docs/sdk/resources/agent-runner.mdx` (564 lines) — not
     in `meta.json`, not linked, not produced by current generator. Resolves
     T02 discovery about `agent-runner.mdx` vs `runner.mdx` duplication.
- All fixes go through codegen inputs, not hand-edits to generated files.
  Future `make gen-sdk-docs` preserves everything.
- **Changelog**:
  `_changelog/2026-04/2026-04-24-192620-sdk-runner-docs-t05-quality-gaps.md`

## Session wrap-up (2026-04-24, Session 4)

- T04 delivered 3 pages under `docs/guides/runners/`: overview (section landing),
  local-runner (start runners, native + Docker), stop-and-cleanup (stop, state files).
- CLI sidebar fix: added `lifecycle` group to `gen-cli-docs/main.go` groupOrder
  and groupTitles. Regenerated with `make gen-cli-docs`. `up`, `down`, `status`,
  `logs`, `setup`, `reset` now appear in the CLI sidebar under "Lifecycle."
- Structural departure from T01: merged `local-runner.mdx` and `docker-runner.mdx`
  into a single `local-runner.mdx` page. Docker is a flag (`--runtime docker`),
  not a separate concept. Added `overview.mdx` (section landing) instead —
  consistent with desktop, integrations, and authentication guide sections.
- All cross-links from T02/T03 verified — they target `/docs/guides/runners/local-runner`
  which matches the new file slug. No existing links broken.

## Session wrap-up (2026-04-24, Session 3)

- **Changelog**:
  `_changelog/2026-04/2026-04-24-181740-desktop-app-guide-t03-scenar-desktopview.md`
- **Stigmer commit**: Conventional commit `docs(guides): add Stigmer Desktop guide
  (T03) and demo` — T03-related paths only (guides, demo, Scenar bump, role,
  project `next-task`, changelog). Other modified files in the repo (backend,
  CLI, SDK runner doc experiments, etc.) were left **uncommitted** — handle those
  in their own commits or discard before merging.
- **Scenar repo**: `DesktopView` shipped in **v0.1.18** on `main` (separate repo;
  already tagged and pushed).

## Task Overview

### Phase A: Documentation

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T01 | Design & task plan | **Complete** | None |
| T02 | Runner concepts page | **Complete** | None |
| T03 | Desktop app guide (3 pages) | **Complete** | T02 |
| T04 | CLI runner guides (3 pages) | **Complete** | T02 |
| T05 | SDK React runner docs update | **Complete** | None |

### Phase B: Distribution & Promotion

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T06 | Marketing site download page | Pending | T03 |
| T07 | Marketing site nav/footer wiring | Pending | T06 |
| T08 | Console: "Get Desktop App" in user menu | Pending | T06 |
| T09 | Console: contextual runner promotion | Pending | T06 |
| T10 | Console: smart nudge banner | Pending | T06, T09 |
| T11 | Verification & polish | Pending | All |

## Design Decisions (approved)

- **DD-01: Docs before promotion** — Documentation creates the link targets. Promotion without docs leads to dead ends.
- **DD-02: All promotion UI in Console, not SDK** — DD-004 compliance. Platform builders don't want Stigmer Desktop CTAs in their embedded components.
- **DD-03: No protocol detection** — No `custom-protocol-check` or localhost probing. Infer from behavior (has local runners = has app).
- **DD-04: No persistent recurring banners** — One-time dismissible nudge only. Slack's recurring banner is an anti-pattern for developer tools.
- **DD-05: Not at first login** — Post-value nudge after first session. Linear/Figma everboarding pattern.
- **DD-06: Runner concept page fills a vocabulary gap** — Every core concept (Agents, Skills, Tools, Sessions, Workflows) has a page. Runners don't.

## Architecture

Two phases, docs first:

**Phase A** creates content:
- Runner concepts page (`docs/concepts/runners.mdx`) — what runners are, lifecycle, local vs cloud.
- Desktop app guide (`docs/guides/desktop/`) — install, setup, browser-to-desktop flow.
- CLI runner guides (`docs/guides/runners/`) — `stigmer up runner`, Docker, stop/cleanup.
- SDK React runner docs — quality gaps (DOMAIN_META, overview.md, orphan cleanup).

**Phase B** builds distribution and promotion:
- Download page on marketing site (`/download`) with platform detection.
- Nav/footer links wired into marketing site.
- Console "Get Desktop App" in user menu.
- Console contextual runner promotion in RunnersSection.
- Console smart nudge banner in AppShell (one-time, dismissible).

All promotion surfaces link to the download page. The download page links to the desktop guide docs. Docs are the foundation.

## Related Projects

- **20260420.01.agent-runner-as-resource** — Phase 0-2. AgentRunner proto, Java/Go server, dispatch, side-channel proxy.
- **20260422.01.runner-ux-cli-restructure** — `stigmer up`/`down`, multi-runner, RunnerListPanel, RunnerPicker.
- **20260422.02.runner-command-stream** — Bidi gRPC `connect`, `sendCommand`, stream-based communication.
- **20260423.01.web-sdk-architecture-standards** — SDK-first architecture, DD-001 through DD-008, ESLint rules.
- **20260423.02.phase3-persistent-runners-browser-launch** — `stigmer://` launch tokens, Docker placement, React hooks, full CRUD.
- **20260423.03.stigmer-desktop-app** — Tauri app with tray, sidecar CLI, deep links, auto-updater.
- **20260331.01.content-strategy** — Content strategy, positioning, vocabulary, Diataxis, document writer role.

## Key Files

### Documentation
- `docs/concepts/meta.json` — Concepts sidebar (add `runners`)
- `docs/guides/meta.json` — Guides sidebar (add `desktop`, `runners`)
- `docs/sdk/react/runner.mdx` — Auto-generated runner React reference (all hooks present, DOMAIN_META added in T05)
- `docs/sdk/react/meta.json` — React SDK sidebar
- `docs/vocabulary.md` — Terminology source of truth (check runner terms)
- `_roles/002_document_writer.md` — Document writer role (Diataxis, plain language, demo standards)

### Marketing Site
- `site/src/lib/constants.ts` — `NAV_LINKS`, `FOOTER_LINKS`, `SITE_CONFIG`
- `site/src/components/pages/PricingPage.tsx` — Reference pattern for new marketing pages
- `site/src/app/pricing/page.tsx` — Reference route pattern (metadata + page component)
- `site/src/components/layout/Header.tsx` — Nav auto-reads from `NAV_LINKS`
- `site/src/components/layout/Footer.tsx` — Footer auto-reads from `FOOTER_LINKS`

### Console
- `client-apps/web/src/domain/_shared/layout/UserMenu.tsx` — User menu dropdown
- `client-apps/web/src/domain/_shared/layout/AppShell.tsx` — Main layout shell
- `client-apps/web/src/domain/settings/RunnersSection.tsx` — Settings > Runners page wrapper

### SDK (NOT modified — reference only)
- `sdk/react/src/runner/RunnerListPanel.tsx` — Runner list with empty state
- `sdk/react/src/runner/useLaunchLocalRunner.ts` — Launch hook
- `sdk/react/src/runner/useStopRunner.ts` — Stop hook
- `sdk/react/src/runner/useDeleteRunner.ts` — Delete hook

### Desktop App (NOT modified — reference only)
- `.github/workflows/release.desktop.yaml` — Release CI (macOS arm64/x86_64, Linux x86_64, Windows x86_64)
- `client-apps/desktop/src-tauri/tauri.conf.json` — Tauri config

## Context for Resume

### Documentation context
- Docs are MDX files consumed by Fumadocs on the Next.js marketing site
- Navigation is driven by `meta.json` files in each docs directory
- Live `docs/meta.json` is source of truth for sidebar: Getting Started → Guides → SDK → CLI → Concepts
- `docs/guides/` has `desktop/` (T03), `runners/` (T04), `integrations/`, and `authentication/`
- `docs/concepts/` has agents, skills, tools, sessions, workflows, environments, organizations — we add runners
- Diataxis per page: Tutorial / How-to / Explanation / Reference — never mixed
- Plain language for intros, precise technical for reference
- Content strategy project `20260331.01` has positioning, vocabulary, IA decisions

### Marketing site context
- Next.js 15 with static export, Tailwind v4, dark-only, Framer Motion
- Pages follow pattern: `site/src/app/<segment>/page.tsx` → `site/src/components/pages/<Name>Page.tsx`
- Nav/footer links are data-driven from `constants.ts` — auto-wired into Header, MobileMenu, Footer

### Console context
- UserMenu is a DropdownMenu at bottom of sidebar — Settings, Appearance, Sign out
- No existing external link pattern in Console menus — "Get Desktop App" is the first
- `RunnersSection` (Console) wraps `RunnerListPanel` (SDK) — promotion goes in RunnersSection, not RunnerListPanel
- Smart nudge banner uses localStorage key `stigmer:desktop-banner-dismissed`
- Desktop app distributed via GitHub Releases only
- Desktop release tag pattern: `desktop-v*` (e.g., `desktop-v0.1.0`)
- Auto-updater endpoint: `https://github.com/stigmer/stigmer/releases/latest/download/latest.json`

### What exists for runners in docs today
- `docs/concepts/runners.mdx` — **(T02)**: Explanation page with lifecycle, local vs cloud, dispatch, live RunnerListPanel demo.
- `docs/guides/desktop/` — **(T03)**: 3 pages: overview, install, manage-runners. Desktop app guide with DesktopView demos.
- `docs/guides/runners/` — **(T04)**: 3 pages: overview, local-runner (native + Docker), stop-and-cleanup. CLI runner management guides.
- `docs/sdk/react/runner.mdx` — **(T05)**: auto-generated, all hooks present (`useRunnerList`, `useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner`), `RunnerListPanel`, `RunnerPicker`, phase helpers. DOMAIN_META added so title/description render correctly.
- `docs/sdk/resources/runner.mdx` — **(T05)**: auto-generated resource reference with `createLaunchToken`, `exchangeLaunchToken`, `stop`, etc. Now has hand-crafted overview via `apis/ai/stigmer/agentic/runner/docs/overview.md`.
- `docs/cli/commands/up.mdx`, `down.mdx` — auto-generated CLI command pages. **Now in sidebar** (T04 fix: lifecycle group added to gen-cli-docs).

### T03 discoveries (carry forward)
- **Document writer role was outdated**: Referenced `createDemoClient` from `@stigmer/react/demo` which does not exist. Fixed to describe the actual `PreviewProvider` + `connectFixture` + Scenar shell workflow. Added `.scenar/` directory docs and component registration flow.
- **DesktopView shell created in Scenar**: New `@scenar/react` shell component (v0.1.18). macOS-style title bar with traffic lights, centered app title, content area. Used for framing SDK components as they appear in native desktop apps.
- **`manage-runners.mdx` renamed from `launch-runner.mdx`**: Original name was too narrow — the page covers starting, stopping, tray, deep links, and notifications.
- **Scenar packages updated to 0.1.18**: `@scenar/core`, `@scenar/preview`, `@scenar/react`, `@scenar/cli` in `site/package.json`. `.scenar/` regenerated via `scenar preview sync`.
- **Desktop guides placed first in sidebar**: `docs/guides/meta.json` has `"desktop"` before `"integrations"` and `"authentication"` — runner management is a primary use case.

### T05 discoveries
- **Original scope already done**: The three "missing" hooks (`useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner`) were already in the generated `runner.mdx`. The `next-task.md` description was written before the last React SDK codegen run. T05 pivoted to quality gap closure instead.
- **`DOMAIN_META` fallback produces lowercase titles**: When a domain slug is not in the `DOMAIN_META` map, the generator uses `{ title: slug, description: "" }`. Runner was the only domain hitting this fallback. `platform-client` also hits it — noted but out of scope for T05.
- **`overview.md` was the only missing resource overview**: Runner was the sole agentic resource without `apis/.../docs/overview.md`. All 11 other agentic resources have one.
- **`agent-runner.mdx` orphan confirmed dead**: The current codegen does not produce `agent-runner.mdx`. The generator writes named output files but does not delete stale ones — this is a known limitation of the write-only output pattern. The file was from a pre-consolidation run.

### T04 discoveries
- **T01 structural departure**: Original T01 plan specified `local-runner.mdx` (native) + `docker-runner.mdx` (Docker) + `stop-and-cleanup.mdx`. Merged native and Docker into one page (`local-runner.mdx`) because Docker is a single flag, not a separate concept. Added `overview.mdx` as a section landing page instead — consistent with all other guide sections. Page count unchanged (3 pages).
- **CLI sidebar gap root cause corrected**: The T02 discovery blamed `GroupID == ""` on the `up`/`down` commands. This was wrong — `up` and `down` have `GroupID: "lifecycle"` (set via `withGroup` in `root.go`). The actual cause was `gen-cli-docs/main.go` missing `"lifecycle"` in its `groupOrder` and `groupTitles` arrays. Fixed by adding the lifecycle group. All 6 lifecycle commands (`up`, `down`, `status`, `logs`, `setup`, `reset`) now appear in the CLI sidebar.
- **No demo scenarios for CLI guides**: CLI how-to pages use standard code blocks, not TerminalView demos. Code blocks are searchable, copyable, and the expected format for CLI documentation. A TerminalView demo on the overview page was considered optional polish and deferred.

### T02 discoveries (carry forward)
- **CLI sidebar gap**: ~~`up.mdx` and `down.mdx` are generated by `gen-cli-docs` but excluded from `meta.json` because the `up` and `down` Cobra commands have `GroupID == ""`. Fix requires Go code change + re-run `make gen-cli-docs`. Flagged for T04.~~ **RESOLVED in T04** — actual cause was `lifecycle` missing from `groupOrder` in `gen-cli-docs/main.go`. Fixed.
- **`agent-runner.mdx` vs `runner.mdx` in SDK resources**: ~~Two separate generated docs exist. The concept page clarifies the terminology; SDK docs may need cleanup.~~ **RESOLVED in T05** — `agent-runner.mdx` deleted. Current generator no longer produces it.
- **No runner sample factory in `@stigmer/react/test`**: Demo builds fixture data directly from proto schemas. If a runner factory is added to `samples.ts` later, the demo can be simplified.
- **Document Writer role update needed**: Add explicit mention that demos use real `@stigmer/react` SDK components with fixture data, not custom demo-only components.

## Quick Commands

- "Start T02" — Begin runner concepts page
- "Start T03" — Begin desktop app guide
- "Start T04" — Begin CLI runner guides
- "Start T05" — Begin SDK React runner docs update
- "Start T06" — Begin marketing site download page
- "Show project status" — Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
