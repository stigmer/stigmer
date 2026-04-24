# Desktop app guide (T03) and Scenar DesktopView shell

**Date**: April 24, 2026

## Summary

Shipped the **Stigmer Desktop** how-to guide as three MDX pages under
`docs/guides/desktop/`, wired the Guides sidebar, added a live demo that frames
`RunnerListPanel` in a new **DesktopView** shell from Scenar, and corrected the
document writer role so it describes the real **PreviewProvider** /
**connectFixture** demo stack. Scenar **v0.1.18** publishes `DesktopView` for reuse
across docs and scenarios.

## Problem Statement

Runner and desktop documentation needed a first-class guide path from the
[Runners](/docs/concepts/runners) concept page to install and operational
how-tos. The document writer role still described a non-existent
`createDemoClient` pattern, which misled authors implementing demos.

### Pain Points

- No `docs/guides/desktop/` section despite links from the runners concept page
- No native-app shell in Scenar to show desktop-framed UI next to browser shells
- Demo authoring guidance out of sync with `PreviewProvider` + MSW + `.scenar/`

## Solution

1. **Docs**: Section hub (`overview.mdx`), install how-to with platform tabs and
   honest macOS Gatekeeper note, manage-runners how-to with Mermaid sequence for
   `stigmer://` flow, plus `meta.json` and `docs/guides/meta.json` ordering
   (`desktop` before integrations).
2. **Scenar**: New `DesktopView` component (title bar + traffic lights + content),
   tests, exports; released as **v0.1.18** from the Scenar repo.
3. **Stigmer site**: `DemoDesktopRunnerManagement` scenario, MDX registration,
   `@scenar/*` bump to 0.1.18, `scenar preview sync` for `.scenar/` artifacts.
4. **Role**: `_roles/002_document_writer.md` updated for shells, `.scenar/`, and
   registration flow.

## Implementation Details

| Area | Key paths |
| ---- | --------- |
| Guides | `docs/guides/desktop/overview.mdx`, `install.mdx`, `manage-runners.mdx`, `meta.json` |
| Nav | `docs/guides/meta.json` — `"desktop"` first in `pages` |
| Demo | `site/src/components/docs/demos/scenarios/desktop-runner-management/index.tsx` |
| MDX | `site/src/components/docs/index.ts`, `site/src/components/mdx.tsx` |
| Deps | `site/package.json`, lockfiles; `site/.scenar/views.generated.ts`, `report.md` |
| Role | `_roles/002_document_writer.md` |
| Project | `_projects/2026-04/20260424.01.desktop-app-promotion/next-task.md` — T03 complete |

**Naming**: Third page is `manage-runners.mdx` (not `launch-runner.mdx`) to match
scope (tray, notifications, stop paths, deep links).

**External**: Scenar commit `feat(react): add DesktopView shell component`; tag
`v0.1.18` on [github.com/stigmer/scenar](https://github.com/stigmer/scenar).

## Benefits

- Readers get a clear path: concepts → desktop install → runner operations
- Demos can show native-window framing consistently with other Scenar shells
- Authors follow accurate Preview / MSW / registration documentation

## Impact

- **Docs site**: New guide section and demo; Fumadocs sidebar picks up `desktop`
- **Authors**: Document writer role matches implementation
- **Scenar consumers**: Any app on `@scenar/react` 0.1.18+ can import `DesktopView`

## Related Work

- Project: `_projects/2026-04/20260424.01.desktop-app-promotion/` (T03 complete;
  T04 CLI runner guides next)
- Prior: `_changelog/2026-04/2026-04-23-201449-desktop-deep-link-url-scheme-handling.md`
- Prior: `_changelog/2026-04/2026-04-23-172611-desktop-sidecar-runner-management.md`

---

**Status**: Production ready (docs + site + Scenar release)
**Timeline**: Single session (T03)
