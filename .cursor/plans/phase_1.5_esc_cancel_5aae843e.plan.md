---
name: Phase 1.5 Esc Cancel
overview: Map Esc to the existing cancel-confirm flow (`c` key) when an execution is running. Single-file logic change in `update.go`, plus footer/help text updates in `view.go` and `help.go`, plus tests.
todos:
  - id: logic
    content: Add Esc as cancel trigger in handleKeyPress (update.go line 135)
    status: completed
  - id: footer
    content: Update footer hints to show Esc/c cancel (view.go, 4 locations)
    status: completed
  - id: help
    content: Update help panel Execution Control binding (help.go)
    status: completed
  - id: tests
    content: Add 6 Esc-cancel tests in update_test.go
    status: completed
  - id: verify
    content: Run tests, check lints, verify existing tests still pass
    status: completed
isProject: false
---

# Phase 1.5: Esc as Cancel Shortcut

## UX Audit

**Current state**: During a running execution, `c` enters the cancel-confirm prompt (`Cancel execution? [y] yes [n] no`). Esc has no meaning in this state — it falls through to the viewport and does nothing.

**User expectation**: Esc is the universal "stop" key across terminal apps (Codex CLI, Copilot CLI, most TUIs). Users reflexively press Esc to stop a running operation.

**Interaction states for Esc today** (priority order in `handleKeyPress`):

1. Input active --> exits session (no change)
2. Cancel confirm active --> dismisses confirm, same as `n` (no change)
3. Help showing --> dismisses help (no change)
4. Approval active --> falls to `handleNavigationKey` via `handleApprovalKey` default case (no change -- cancel is inappropriate during a tool approval decision)
5. **Normal running state --> does nothing** (this is the gap)

**Fix**: In state 5, Esc enters the cancel-confirm flow (same as `c`). This produces the natural two-step pattern: Esc to enter cancel, Esc again to back out.

**No new state or model fields required.** The existing `cancelConfirm` bool and `handleCancelConfirmKey` handler are reused.

## Changes

### 1. `update.go` -- Add Esc to cancel key check

In [update.go](client-apps/cli/pkg/executiontui/update.go) line 135, the cancel key condition:

```go
if msg.String() == "c" && !m.done && !m.cancelling && m.activeCancelFn != nil {
```

Becomes:

```go
if (msg.String() == "c" || msg.Type == tea.KeyEsc) && !m.done && !m.cancelling && m.activeCancelFn != nil {
```

This is the only logic change. All guard conditions (`!m.done`, `!m.cancelling`, `activeCancelFn != nil`) apply identically to Esc.

### 2. `view.go` -- Update footer hints

In [view.go](client-apps/cli/pkg/executiontui/view.go), update the four footer hint strings that reference `c cancel` to show `Esc/c cancel`:

- Line 146 (scroll paused, with expandable blocks): `c cancel` --> `Esc/c cancel`
- Line 148 (scroll paused, no expandable blocks): `c cancel` --> `Esc/c cancel`
- Line 151 (normal, with expandable blocks): `c cancel` --> `Esc/c cancel`
- Line 153 (normal, default): `c cancel` --> `Esc/c cancel`

### 3. `help.go` -- Update help panel

In [help.go](client-apps/cli/pkg/executiontui/help.go) line 75, the "Execution Control" section binding:

```go
{"c", "Cancel execution (with confirmation)"},
```

Becomes:

```go
{"Esc / c", "Cancel execution (with confirmation)"},
```

### 4. Tests in `update_test.go`

Add tests covering Esc behavior in each relevant state:

- **Esc during running execution** -- sets `cancelConfirm = true` (enters cancel-confirm flow)
- **Esc when done** -- does not enter cancel-confirm (falls through to viewport/navigation)
- **Esc when already cancelling** -- does not re-enter cancel-confirm
- **Esc during approval** -- does not trigger cancel (handled by `handleApprovalKey`, delegated to navigation)
- **Esc then Esc** -- enters cancel-confirm, then dismisses it (the "I changed my mind" pattern)
- **Esc then y** -- enters cancel-confirm, then confirms cancel (full cancel path)

Existing tests for Esc during input (`handleInputKey`) and Esc during help (`TestHelp_Esc_DismissesHelp`) already cover those states.

### 5. Help test update

In [help_test.go](client-apps/cli/pkg/executiontui/help_test.go), the `TestRenderHelp_ContainsKeyBindings` test checks for known bindings. If the test checks for the literal string `"c"` as a cancel binding, update it to match the new `"Esc / c"` text. (Currently it does not check for the cancel binding specifically, so this may not need a change.)

## Files Changed

- [update.go](client-apps/cli/pkg/executiontui/update.go) -- 1 line changed
- [view.go](client-apps/cli/pkg/executiontui/view.go) -- 4 lines changed (footer hints)
- [help.go](client-apps/cli/pkg/executiontui/help.go) -- 1 line changed
- [update_test.go](client-apps/cli/pkg/executiontui/update_test.go) -- ~6 new test functions added

