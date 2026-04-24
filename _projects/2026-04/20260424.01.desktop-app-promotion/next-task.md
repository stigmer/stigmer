# Next Task: 20260424.01.desktop-app-promotion

## Quick Resume Instructions

Drop this file into your conversation to quickly resume work on this project.

## Project: Desktop App Documentation + Promotion

**Description**: Close out documentation for six runner/desktop/CLI projects, then build a comprehensive desktop app promotion and distribution system across the web console and marketing site.
**Goal**: (1) Runners, desktop app, and CLI runner management are fully documented with concept pages, how-to guides, and SDK reference updates. (2) Users discover and install the Stigmer Desktop app through contextual, non-intrusive promotion in the console and a proper download page on the marketing site.
**Tech Stack**: TypeScript/React (Console), Next.js (marketing site + docs via Fumadocs), MDX, CSS/Tailwind
**Components**: docs/ (documentation), site/ (marketing site), client-apps/web/ (Console UI)

## Current State

- **Status**: **All tasks complete (T01–T11).** Project finished.
- **Last Session**: 2026-04-24 (Session 11) — T11 verification & polish. Four fixes across docs and Console. All builds/lint clean.
- **Active Task**: None — project complete.

## Session wrap-up (2026-04-24, Session 11)

- T11 audited all T01–T10 deliverables across docs, marketing site, and Console.
  Found and fixed four issues. No architectural changes — all fixes are isolated
  to single files.
- **Modified**: `docs/guides/desktop/install.mdx` — replaced stale TODO + GitHub
  Releases link with `/download` page link (T06 shipped). Fixed Windows installer
  format from `.msi` to `.exe` (NSIS, matching `DESKTOP_CONFIG` and Tauri config).
- **Modified**: `client-apps/web/src/domain/settings/RunnersSection.tsx` — removed
  dead `listRefetchRef` / `handleRefetchRef` / `onRefetchRef`. The ref was wired
  to `RunnerListPanel` but never read. Dropped `useRef` import.
- **Modified**: `client-apps/web/src/domain/_shared/layout/AppShell.tsx` —
  destructured `sidebar.isOpen` and `sidebar.close` into local variables
  (`sidebarOpen`, `closeSidebar`) so the Escape keydown effect depends on stable
  primitives instead of the unstable `sidebar` object. Eliminated a pre-existing
  `react-hooks/exhaustive-deps` lint warning.
- **Modified**: `client-apps/web/src/domain/_shared/layout/DesktopAppBanner.tsx` —
  added module-level `seededThisSession` flag to prevent the banner from appearing
  during the first visit. `getBannerSnapshot()` returns `false` when the flag is
  set. Flag resets on page reload (module re-evaluation = new visit).
- **Audit results (no action needed)**: All `meta.json` entries correct;
  `agent-runner.mdx` orphan confirmed deleted; 20+ doc cross-links verified;
  SDK boundary compliance confirmed (all promotion UI in `client-apps/web`);
  theme token compliance confirmed; accessibility semantics present;
  `EXTERNAL_LINKS` shared correctly; `DESKTOP_CONFIG` well-structured;
  `NAV_LINKS`/`FOOTER_LINKS` include Download; all changelogs present (T02–T10).
- Console lint: 0 errors, 0 warnings. Console build: 29 routes, exit 0.
- Site lint: 0 errors. Site build: exit 0.
- **Changelog**:
  `_changelog/2026-04/2026-04-24-213214-t11-verification-polish.md`

## Session wrap-up (2026-04-24, Session 10)

- T10 added a one-time dismissible desktop app promotion banner to the
  Console's AppShell — the global layout component.
- **New file**: `client-apps/web/src/domain/_shared/layout/DesktopAppBanner.tsx`
  — `useDesktopBannerState()` hook + `DesktopAppBanner` component.
- **Modified**: `client-apps/web/src/domain/_shared/layout/AppShell.tsx` —
  structural change to `<main>` (flex-col with inner scroll div) + banner
  wiring.
- **Hook design**: `useSyncExternalStore` over localStorage, matching the
  sidebar pattern in `use-layout-state.tsx`. Two keys:
  `stigmer:desktop-banner-first-seen` (seeded on first visit) and
  `stigmer:desktop-banner-dismissed` (set on dismiss). Cross-tab reactive.
  Server snapshot returns `false` (no hydration mismatch).
- **Visit-based trigger**: Banner hidden on first visit (seeds first-seen
  timestamp). Visible on second+ visit if not dismissed. No API calls.
  Returning users = post-value proxy (DD-05 compliance).
- **Structural change to AppShell**: `<main>` converted from scroll container
  (`overflow-y-auto`) to flex-column parent (`flex flex-col overflow-hidden`).
  Content wrapped in `<div className="min-w-0 flex-1 overflow-y-auto">`.
  Banner renders above the scroll area as a "banner slot" — reusable for
  future global banners (maintenance, announcements).
- **Design decisions**:
  - **Visit-based over session-based trigger**: No infrastructure to detect
    "first session" at the AppShell level without API calls. Visit count is a
    clean proxy — returning users have gotten value. Works in both local and
    cloud mode.
  - **Top-of-main placement**: Fixed bottom bar would overlap session composer.
    Toast too transient. Flex-column with banner slot is a standard layout
    pattern. Non-intrusive, always visible until dismissed.
  - **All authenticated zones**: Session + management. Public zone excluded.
    Maximum visibility for a one-time nudge.
  - **No animation on dismiss**: Instant removal avoids layout shift animation
    complexity. Content fills the space immediately.
  - **Separate file, not inline**: Hook has its own state management and
    subscribe/snapshot functions. Warrants its own module unlike T09's
    `DesktopAppPromo` (pure presentational, no state).
- **Visual pattern**: Thin horizontal bar. `<aside role="complementary">` with
  `Monitor` icon + "Stigmer Desktop" title + value prop + "Download" link
  (ArrowUpRight convention from T08/T09) + dismiss X. Main-area tokens
  (`bg-card`, `text-foreground`, `text-muted-foreground`, `border-border-muted`).
- ESLint clean, build clean (29 routes, exit 0).
- **No surprises**: Implementation matched the plan exactly. No architectural
  decisions needed beyond what was pre-approved.

## Session wrap-up (2026-04-24, Session 9)

- T09 added a contextual Desktop App promotion card to the Console's
  Settings > Runners page (`RunnersSection.tsx`).
- **Modified**: `client-apps/web/src/domain/settings/RunnersSection.tsx` — added
  private `DesktopAppPromo` component. Semantic `<aside>` with `Monitor` icon,
  "Stigmer Desktop" title, value prop copy, and external "Download" link using
  `EXTERNAL_LINKS.download` from `external-links.ts` (T08). `ArrowUpRight`
  indicator follows the external link convention established in T08.
- **Design decisions**:
  - **Always-visible, not dismissible**: T09 is permanent contextual information
    on a page users navigate to intentionally. T10 handles the one-time
    dismissible global nudge. Adding localStorage dismissal logic for a subtle
    footer card is disproportionate complexity.
  - **Not conditional on runner count**: Conditioning would require either a
    duplicate `useRunnerList` call (wasteful) or SDK API changes (render prop
    for empty state). The Desktop App is useful regardless of runner count
    (tray, notifications, deep links).
  - **Placed after the runner list**: Respects content hierarchy — the runner
    list is primary content, the promotion is supplementary. Shows in all
    states (no-org, empty list, populated list).
  - **No new files**: Single file change. `DesktopAppPromo` is a private
    component within `RunnersSection.tsx` — only used on this page.
  - **No SDK changes**: Promotion is Console-specific (DD-004 compliance).
    Platform builders don't get desktop app CTAs in embedded components.
- ESLint clean, build clean (29 routes, exit 0).
- **No surprises**: Implementation matched the plan exactly. No architectural
  decisions needed beyond what was pre-approved.

## Session wrap-up (2026-04-24, Session 8)

- T08 added "Get Desktop App" to the Console's `UserMenu` dropdown — the first
  external link in Console menus.
- **New file**: `client-apps/web/src/config/external-links.ts` — shared
  `EXTERNAL_LINKS` constant with `website`, `download`, `github`, `docs` URLs.
  Static across all deployments (not in `RuntimeConfig`). T09/T10 import from here.
- **Modified**: `client-apps/web/src/domain/_shared/layout/UserMenu.tsx` — added
  `DesktopAppItem` component using `DropdownMenuItem` + `render` prop with `<a>`
  for external link composition. `Monitor` icon + muted `ArrowUpRight` indicator.
  Appears in both local-mode and authenticated menu variants, positioned after
  Appearance and before Sign out.
- **Design decisions**:
  - `Monitor` icon chosen over `Download` (implies file transfer) and `AppWindow`
    (already used for OAuth Apps in settings-nav).
  - `ArrowUpRight` (size-3, muted) establishes the Console's external link visual
    convention for T09/T10.
  - URL source: shared `external-links.ts` config, not `RuntimeConfig` (zero
    deployment variance) and not inline (T09/T10 reuse).
- ESLint clean, build clean (29 pages, exit 0).
- **Changelog**:
  `_changelog/2026-04/2026-04-24-205144-console-get-desktop-app-user-menu-t08.md`

## Session wrap-up (2026-04-24, Session 7)

- T07 wired the `/download` page into the marketing site header nav and footer.
  Single file change: `site/src/lib/constants.ts`.
- **`NAV_LINKS`**: Added `{ label: "Download", href: "/download" }` between
  Pricing and GitHub. Nav order: Use Cases | Docs | Blog | Pricing | Download |
  GitHub | Discord | Sign In | Start Free.
- **`FOOTER_LINKS.product`**: Appended `{ label: "Download", href: "/download" }`
  after Documentation. Product footer now has 4 links.
- Updated the stale IA comment above `NAV_LINKS` to reflect the actual current
  layout (Blog, Download, Discord were all added after the original IA spec).
- No component files touched — Header, MobileMenu, and Footer all iterate
  `NAV_LINKS` / `FOOTER_LINKS` arrays automatically.
- Site build passes cleanly (`npm run build` exit 0).
- **Changelog**:
  `_changelog/2026-04/2026-04-24-202005-marketing-site-nav-footer-wiring-t07.md`

## Session wrap-up (2026-04-24, Session 6)

- T06 delivered `/download` route on the marketing site with platform-detected
  download buttons for Stigmer Desktop.
- Created `DESKTOP_CONFIG` in `constants.ts` — single source of truth for version
  (`0.1.0`), release tag (`desktop-v0.1.0`), and all 5 platform artifact filenames.
  `getDownloadUrl()` helper constructs GitHub Release download URLs.
- Page structure: hero (heading + value prop + version badge), 5 platform cards
  in responsive grid (macOS Apple Silicon/Intel, Windows, Linux .deb/.AppImage),
  "After you install" guide links, Apache 2.0 note.
- Platform detection: client-side `navigator.userAgent` for OS,
  `navigator.userAgentData.getHighEntropyValues(['architecture'])` for macOS
  Apple Silicon vs Intel. Falls back to arm64. Highlighted card gets `bg-card`
  treatment and "Recommended" label.
- Platform brand icons (Apple, Windows, Linux) are inline SVGs in `DownloadPage.tsx`.
  Follows existing pattern (`discord-icon.tsx`, `stigmer-icon.tsx`).
- Added `Download` and `Monitor` icons from Lucide to `icon.tsx`.
- All guide links verified as 200: `/docs/guides/desktop/install`,
  `/docs/guides/desktop/manage-runners`, `/docs/guides/runners/local-runner`.
- **Artifact filename risk**: filenames follow Tauri 2 convention but have not been
  verified against a real build. After first published `desktop-v*` release, compare
  actual GitHub Release assets against `DESKTOP_CONFIG.platforms[*].filename`.
- **Changelog**:
  `_changelog/2026-04/2026-04-24-200337-marketing-site-download-page-t06.md`
- **Commit**: `6e879ead7` — `feat(site): add /download page for Stigmer Desktop (T06)`

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
| T06 | Marketing site download page | **Complete** | T03 |
| T07 | Marketing site nav/footer wiring | **Complete** | T06 |
| T08 | Console: "Get Desktop App" in user menu | **Complete** | T06 |
| T09 | Console: contextual runner promotion | **Complete** | T06 |
| T10 | Console: smart nudge banner | **Complete** | T06, T09 |
| T11 | Verification & polish | **Complete** | All |

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
- `site/src/lib/constants.ts` — `NAV_LINKS`, `FOOTER_LINKS`, `SITE_CONFIG`, `DESKTOP_CONFIG`, `getDownloadUrl()`
- `site/src/app/download/page.tsx` — **(T06)**: Download route entry (metadata + DownloadPage)
- `site/src/components/pages/DownloadPage.tsx` — **(T06)**: Download page with platform detection and guide links
- `site/src/components/pages/PricingPage.tsx` — Reference pattern for new marketing pages
- `site/src/app/pricing/page.tsx` — Reference route pattern (metadata + page component)
- `site/src/components/layout/Header.tsx` — Nav auto-reads from `NAV_LINKS`
- `site/src/components/layout/Footer.tsx` — Footer auto-reads from `FOOTER_LINKS`

### Console
- `client-apps/web/src/config/external-links.ts` — **(T08)**: Shared `EXTERNAL_LINKS` constant (download, website, github, docs)
- `client-apps/web/src/domain/_shared/layout/UserMenu.tsx` — **(T08)**: User menu dropdown with `DesktopAppItem`
- `client-apps/web/src/domain/_shared/layout/AppShell.tsx` — **(T10)**: Main layout shell with banner slot (flex-col `<main>` + inner scroll div)
- `client-apps/web/src/domain/_shared/layout/DesktopAppBanner.tsx` — **(T10)**: `useDesktopBannerState()` hook + `DesktopAppBanner` component. Visit-based localStorage trigger, permanent dismissal.
- `client-apps/web/src/domain/settings/RunnersSection.tsx` — **(T09)**: Settings > Runners page wrapper with `DesktopAppPromo` contextual promotion

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

### Console context (updated T09)
- `client-apps/web/src/config/external-links.ts` — **(T08)**: `EXTERNAL_LINKS` constant with `website`, `download`, `github`, `docs` URLs. Static, not in `RuntimeConfig`. T09/T10 import from here.
- `UserMenu` now has 4 items (local-mode: 3): Settings, Appearance, Get Desktop App, Sign out.
- External link pattern established: `DropdownMenuItem` + `render={<a href target="_blank" rel="noopener noreferrer" />}` + muted `ArrowUpRight` indicator.
- `Monitor` icon used for desktop app. `AppWindow` is taken (OAuth Apps).
- `RunnersSection` **(T09)**: now includes `DesktopAppPromo` — always-visible `<aside>` after the runner list with `Monitor` icon, value prop, and external download link. Uses `EXTERNAL_LINKS.download`.

### Console context (updated T10)
- `AppShell` **(T10)**: `<main>` is now a flex-column parent (`flex flex-col overflow-hidden`) with content wrapped in `<div className="min-w-0 flex-1 overflow-y-auto">`. This creates a "banner slot" above the scroll area.
- `DesktopAppBanner` **(T10)**: One-time dismissible nudge in the banner slot. `useDesktopBannerState()` hook uses `useSyncExternalStore` over localStorage (same pattern as sidebar in `use-layout-state.tsx`). Two keys: `stigmer:desktop-banner-first-seen` (ISO timestamp, seeded on first visit) and `stigmer:desktop-banner-dismissed` (`"true"`, set on dismiss). Server snapshot returns `false`.
- Visit-based trigger: first visit seeds first-seen and hides banner. Second+ visit shows banner if not dismissed. No API calls.
- Banner visual: thin bar with `bg-card` + `border-b border-border-muted`. `Monitor` icon, "Stigmer Desktop" title, value prop copy, "Download" link (`EXTERNAL_LINKS.download` + `ArrowUpRight`), dismiss X button.
- Shows in all authenticated zones (session + management). Public zone excluded.

### What exists for distribution today
- `site/src/app/download/page.tsx` + `site/src/components/pages/DownloadPage.tsx` — **(T06)**: `/download` route with platform-detected download buttons. Links to GitHub Release artifacts via `DESKTOP_CONFIG`.
- `site/src/lib/constants.ts` — **(T06+T07)**: `DESKTOP_CONFIG` with version, release tag, 5 platform artifacts, `getDownloadUrl()`. `NAV_LINKS` includes Download link between Pricing and GitHub. `FOOTER_LINKS.product` includes Download after Documentation.
- `client-apps/web/src/config/external-links.ts` — **(T08)**: `EXTERNAL_LINKS` with download page URL. Shared config for Console external links.
- `client-apps/web/src/domain/_shared/layout/UserMenu.tsx` — **(T08)**: `DesktopAppItem` in both menu variants. `Monitor` icon + `ArrowUpRight` external link indicator.
- `client-apps/web/src/domain/settings/RunnersSection.tsx` — **(T09)**: `DesktopAppPromo` component. Always-visible `<aside>` after runner list with `Monitor` icon, value prop copy, and "Download" external link. Shows in all page states (no-org, empty list, populated list).
- `client-apps/web/src/domain/_shared/layout/DesktopAppBanner.tsx` — **(T10)**: One-time dismissible nudge banner. `useDesktopBannerState()` hook with `useSyncExternalStore` over localStorage. Visit-based trigger (hidden on first visit, visible on second+). `DesktopAppBanner` component with `Monitor` icon, value prop, "Download" link, dismiss X.
- `client-apps/web/src/domain/_shared/layout/AppShell.tsx` — **(T10)**: Structural change: `<main>` is now a flex-column parent with inner scroll div. Banner renders above the scroll area in all authenticated zones. Public zone unchanged.

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

### T06 discoveries
- **Artifact filenames are convention-based**: Tauri 2 bundler output filenames are not hardcoded anywhere in the repo. `DESKTOP_CONFIG` in `constants.ts` uses standard Tauri 2 naming (`Stigmer_0.1.0_aarch64.dmg`, etc.). Must verify after first published release.
- **No Lucide brand icons**: Lucide does not carry Apple/Windows/Linux brand marks. Platform logos are inline SVGs in `DownloadPage.tsx`, following the `discord-icon.tsx` pattern.
- **Safari lacks `userAgentData`**: `navigator.userAgentData.getHighEntropyValues()` is Chromium-only. Safari macOS users default to Apple Silicon (majority of active Macs post-2020). This is a known trade-off.
- **`max-w-4xl` vs `max-w-5xl`**: Download page uses `max-w-4xl` (narrower than PricingPage's `max-w-5xl`) because cards are individually narrower. Header/footer still use `max-w-7xl` consistently.
- **Linux dual format**: Both `.deb` and `.AppImage` are listed as separate cards. On Linux detection, the `.deb` card is recommended (first match). Users who prefer AppImage can see and click the adjacent card.

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

- "Start T11" — Begin verification & polish
- "Show project status" — Get overview of progress

---

*This file provides direct paths to all project resources for quick context loading.*
