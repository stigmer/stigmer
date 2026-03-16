# Tasks: 20260316.04.theme-system-gaps

**Created**: 2026-03-16

## How to Use This File

Update task status as you progress:
- **⏸️ TODO** - Not started yet
- **🚧 IN PROGRESS** - Currently working on this
- **✅ DONE** - Completed

Add timestamps and notes to track your progress.

---

## Task 1: Sync SDK styles.css @theme inline with globals.css — add success, warning, info, chart token mappings

**Status**: ✅ DONE
**Created**: 2026-03-16 17:08
**Completed**: 2026-03-16

### Subtasks
- [x] Add success/success-foreground, warning/warning-foreground, info/info-foreground token mappings
- [x] Add chart-1 through chart-5 token mappings
- [x] Verify SDK styles.css and Console globals.css alignment

### Notes
- Added 11 token mappings to `sdk/react/src/styles.css` `@theme inline` block
- **Sidebar tokens deliberately excluded from SDK.** Sidebar is a Console layout concern — embedded SDK components (chat widgets, execution viewers) don't have sidebars. Excluding sidebar from `@theme inline` means Tailwind won't generate `bg-sidebar` etc. in SDK components, acting as a compile-time guard enforcing the Console/SDK boundary. The Console gets sidebar tokens through its own `globals.css`, which imports the SDK styles and adds sidebar on top.
- No existing SDK components use the newly added tokens — this is a proactive addition to complete the theme surface for future components.

## Task 2: Add preset prop to StigmerProvider so platform builders can apply presets programmatically

**Status**: ⏸️ TODO
**Created**: 2026-03-16 17:08

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 3: Add shadow tokens (--stgm-shadow-sm/md/lg) to tokens.css and override per preset

**Status**: ⏸️ TODO
**Created**: 2026-03-16 17:08

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 4: Add transition tokens (--stgm-transition-duration, --stgm-transition-timing) and override per preset

**Status**: ⏸️ TODO
**Created**: 2026-03-16 17:08

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 5: Add z-index base token (--stgm-z-base) for embedded component stacking context isolation

**Status**: ⏸️ TODO
**Created**: 2026-03-16 17:08

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]

## Task 6: Write @stigmer/react README — integration guide, theming instructions, preset usage, custom token override examples

**Status**: ⏸️ TODO
**Created**: 2026-03-16 17:08

### Subtasks
- [ ] [Add specific steps as you work]

### Notes
- [Add notes about this task here]


## Project Completion Checklist

When all tasks are done:
- [ ] All tasks marked ✅ DONE
- [ ] Final testing completed
- [ ] Documentation updated (if applicable)
- [ ] Code reviewed/validated
- [ ] Ready for use/deployment

---

**Quick Tip**: Keep this file updated as your single source of truth for project progress!

