---
name: Tab hint discoverability fix
overview: Update the TUI footer hints in `view.go` to communicate that both Tab (forward) and Shift+Tab (backward) navigation are available for expandable blocks. The underlying functionality already exists and is fully implemented.
todos:
  - id: update-footer-hints
    content: Replace 'Tab focus' with 'Tab/S-Tab focus' in all three footer hint strings in view.go renderFooter()
    status: completed
isProject: false
---

# Fix Tab/Shift+Tab discoverability in TUI footer

## Context

The Shift+Tab backward navigation is already fully implemented:

- `[focus.go](client-apps/cli/pkg/executiontui/focus.go)` lines 32-51: `focusPrevExpandable()` walks backward with wraparound
- `[update.go](client-apps/cli/pkg/executiontui/update.go)` lines 85-90: handles `"shift+tab"` key
- `[help.go](client-apps/cli/pkg/executiontui/help.go)` line 60: documented in the `?` help panel

The problem is purely a **discoverability issue** in the footer hints of `[view.go](client-apps/cli/pkg/executiontui/view.go)`.

## Change

In `[view.go](client-apps/cli/pkg/executiontui/view.go)` `renderFooter()` (lines 83-113), update the three places where "Tab focus" appears to show both directions:

- **Line 89** (done state): `"Tab focus"` -> `"Tab/S-Tab focus"`
- **Line 97** (scroll paused, has expandable blocks): `"Tab focus"` -> `"Tab/S-Tab focus"`
- **Line 102** (normal with expandable blocks): `"Tab focus"` -> `"Tab/S-Tab focus"`

The notation "S-Tab" is a well-understood terminal convention (used by vim, tmux, etc.) and keeps the footer compact. The full "Shift+Tab" is already spelled out in the `?` help panel for users who want the full reference.

## Scope

- Single file change: `[client-apps/cli/pkg/executiontui/view.go](client-apps/cli/pkg/executiontui/view.go)`
- 3 string literal edits (one per footer state)
- No logic changes, no new functionality, no test changes needed

