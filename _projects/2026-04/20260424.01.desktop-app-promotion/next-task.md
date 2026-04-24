# Next Task: 20260424.01.desktop-app-promotion

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Desktop App Documentation + Promotion

**Description**: Close out documentation for six runner/desktop/CLI projects, then build a comprehensive desktop app promotion and distribution system across the web console and marketing site.
**Goal**: (1) Runners, desktop app, and CLI runner management are fully documented with concept pages, how-to guides, and SDK reference updates. (2) Users discover and install the Stigmer Desktop app through contextual, non-intrusive promotion in the console and a proper download page on the marketing site.
**Tech Stack**: TypeScript/React (Console), Next.js (marketing site + docs via Fumadocs), MDX, CSS/Tailwind
**Components**: docs/ (documentation), site/ (marketing site), client-apps/web/ (Console UI)

## Current State

- **Status**: T02 complete. Ready for T03.
- **Last Session**: 2026-04-24 (Session 2) — T02 runner concepts page written, demo created, vocabulary updated, sidebar and reading path wired.
- **Active Task**: None — ready to start T03.

## Task Overview

### Phase A: Documentation

| Task | Title | Status | Dependencies |
|------|-------|--------|--------------|
| T01 | Design & task plan | **Complete** | None |
| T02 | Runner concepts page | **Complete** | None |
| T03 | Desktop app guide (3 pages) | Pending | T02 |
| T04 | CLI runner guides (3 pages) | Pending | T02 |
| T05 | SDK React runner docs update | Pending | None |

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
- SDK React runner docs — add `useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner`.

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
- `docs/sdk/react/runner.mdx` — Existing auto-generated runner React reference (needs hook additions)
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
- `docs/guides/` currently has `authentication/` and `integrations/` — we add `desktop/` and `runners/`
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
- `docs/concepts/runners.mdx` — **NEW (T02)**: Explanation page with lifecycle, local vs cloud, dispatch, live RunnerListPanel demo.
- `docs/sdk/react/runner.mdx` — auto-generated, has `useRunnerList`, `RunnerListPanel`, `RunnerPicker`, phase helpers. Missing: `useLaunchLocalRunner`, `useStopRunner`, `useDeleteRunner`.
- `docs/sdk/resources/runner.mdx` — auto-generated resource reference with `createLaunchToken`, `exchangeLaunchToken`, `stop`, etc.
- `docs/cli/commands/up.mdx`, `down.mdx` — auto-generated CLI command pages (NOT in sidebar — see T02 discovery below).
- No desktop guide, no CLI runner how-to guides yet.

### T02 discoveries (carry forward)
- **CLI sidebar gap**: `up.mdx` and `down.mdx` are generated by `gen-cli-docs` but excluded from `meta.json` because the `up` and `down` Cobra commands have `GroupID == ""`. Fix requires Go code change + re-run `make gen-cli-docs`. Flagged for T04.
- **`agent-runner.mdx` vs `runner.mdx` in SDK resources**: Two separate generated docs exist. The concept page clarifies the terminology; SDK docs may need cleanup.
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
