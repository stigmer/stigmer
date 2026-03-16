# Notes: 20260316.04.theme-system-gaps

**Created**: 2026-03-16

## Purpose

Use this file to capture important information as you work:

- 🎯 **Decisions**: Why you chose approach A over B
- 🐛 **Gotchas**: Issues discovered and how you solved them
- 💡 **Learnings**: Insights that might help later
- 📝 **Commands**: Useful commands or snippets
- 🔗 **References**: Links to docs, Stack Overflow, etc.

Keep entries **timestamped** and **concise**. This isn't a novel - just enough context to remember later.

---

## 2026-03-16 - Project kickoff & architectural analysis

### `@stigmer/theme` should move to `sdk/theme/`

- Currently at `client-apps/web/_libs/ui/theme/` but published as `@stigmer/theme` on npm (v0.0.34)
- `@stigmer/react` depends on it — SDK depending on a client app internal lib is an inverted dependency
- Platform builders install it directly — it's a first-class SDK surface, not a web app internal
- The `_libs` convention implies non-publishable internals; this package is neither
- **Not in scope for this quick project** — fits in `20260316.01.sdk-package-restructure`

### Gap audit summary

10 gaps identified in theming system. This project addresses 6:
1. SDK `@theme inline` missing semantic tokens (success, warning, info, chart, sidebar)
2. `StigmerProvider` has no `preset` prop — host must wire CSS classes manually
3. No shadow tokens (`--stgm-shadow-*`)
4. No transition tokens (`--stgm-transition-*`)
5. No z-index base token (`--stgm-z-base`) for stacking context isolation
6. No `@stigmer/react` README for platform builders

Deferred: spacing tokens, typography scale, RTL/locale/density, Storybook

---

