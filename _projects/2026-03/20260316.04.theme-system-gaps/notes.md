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

### `@stigmer/theme` moved to `sdk/theme/` (done)

- Was at `client-apps/web/_libs/ui/theme/` but published as `@stigmer/theme` on npm
- `@stigmer/react` depends on it — SDK depending on a client app internal lib was an inverted dependency
- Platform builders install it directly — it's a first-class SDK surface, not a web app internal
- The `_libs` convention implies non-publishable internals; this package is neither
- **Completed in session 2** — moved via `git mv`, updated workspace config, made tsconfig self-contained, fixed publish script path and order, removed orphaned `_libs/`

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

## 2026-03-16 - Task 1: Token sync decision

### Sidebar tokens excluded from SDK (deliberate)

- Sidebar is a Console layout concern — embedded SDK components (chat widgets, execution viewers) don't have sidebars
- Excluding sidebar from `@theme inline` in SDK means Tailwind won't generate `bg-sidebar`, `text-sidebar-foreground`, etc. in SDK components
- This acts as a compile-time guard: if an SDK component author tries to use `bg-sidebar`, it simply won't exist — steering them toward generic surface tokens (background, card, muted)
- The Console gets sidebar tokens through `globals.css`, which imports SDK styles and adds sidebar mappings on top — correct layering
- Cost of being wrong is near zero: adding sidebar later is 7 lines of CSS; removing after adoption is a breaking change

### Token grouping in styles.css

- Status tokens (success, warning, info) grouped after destructive — all semantic status colors together
- Chart tokens grouped after ring — matching the grouping in globals.css
- 11 new mappings total, bringing SDK from 19 to 30 token mappings

---

