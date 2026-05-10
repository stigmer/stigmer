# Runner UX Overhaul: E2E Verification and Polish Pass (T07)

**Date**: May 10, 2026

## Summary

Completed the final phase of the runner management UX overhaul (T07): end-to-end verification of the auto-ensure lifecycle and a systematic code polish across all T01-T06 work spanning Go, Rust, and TypeScript. Fixed a missing theme token, six token opacity modifier violations, keyboard accessibility gaps, and dead code.

## Problem Statement

T01-T06 delivered a complete runner management overhaul across five layers (Go CLI, Rust sidecar, TypeScript hooks, Desktop UI, SDK React). Before shipping, the full stack needed:

### Pain Points

- No end-to-end verification that the auto-ensure lifecycle (first-run prompt -> active runner -> disable -> re-enable) works as a complete flow
- No systematic review of token compliance, accessibility, or code quality across the 30+ files touched
- Potential visual bug: `bg-success-subtle` used in the ActiveCard but `--stgm-success-subtle` token was never defined in the theme
- Opacity modifiers on token classes (`border-primary/30`, etc.) violating the platform's `no-token-opacity-modifiers` rule
- Interactive buttons in the runner page missing keyboard focus indicators (WCAG 2.4.7)

## Solution

Two-phase approach: build verification + manual lifecycle walkthrough, followed by a file-by-file quality review across all four codebases with targeted fixes.

## Implementation Details

### Build Verification

All compilation targets confirmed clean: Go build/vet/test (67+ tests), Rust `cargo check`, TypeScript `tsc --noEmit`, `make verify-desktop`.

### Manual E2E Walkthrough

Verified the complete auto-ensure lifecycle on a live Desktop app:
1. Clean slate (no preferences, no runner state, no socket)
2. FirstRunPrompt renders correctly with Enable/Not now
3. Enable -> EnsuringCard spinner -> ActiveCard with runner details
4. Disable -> graceful socket stop -> DisabledCard
5. Re-enable -> ensuring -> active (faster with cached venv)

### Code Polish (30+ files across 4 languages)

**Go CLI (16 files):** Removed dead code — two unused identical functions (`hintForOrgConflict`, `hintForEndpointConflict`) and their orphaned `fmt` import in `ensure.go`. All other files passed quality review: naming, error messages, function decomposition, test coverage.

**Rust Tauri (3 files):** Clean review. `unix_http_request` half-close fix confirmed correct. `RunnerStateFile` struct parity with Go `RunnerState` verified. Error messages descriptive throughout.

**Desktop TypeScript (8 files):** Three categories of fixes:
- **Missing token:** Added `--stgm-success-subtle` (oklch light: `0.95 0.03 150`, dark: `0.24 0.04 150`) to `tokens.css` and mapped it in Desktop `globals.css`
- **Opacity violations:** Replaced `border-primary/30`, `border-success/30`, `border-destructive/30` with `border-border`; `text-primary-foreground/80` with `text-primary-foreground`; `bg-muted-foreground/30|/60` with `bg-border`/`bg-muted-foreground`
- **Accessibility:** Added `focus-visible:ring-2 focus-visible:ring-ring` to Enable, Disable, Retry, Not now buttons and ActionButton

**SDK React (3 files):** Clean review. Zero framework imports (DD-004). All T06 exports present in both runner barrel and top-level barrel. TSDoc on public APIs. `"use client"` directives present.

## Benefits

- Verified that the full runner lifecycle works end-to-end — no dead paths
- ActiveCard green background now renders correctly in both light and dark modes
- All interactive elements in the runner page are keyboard-accessible
- Zero token opacity modifier violations in runner files
- Dead code removed from the CLI

## Impact

- **Desktop users:** ActiveCard visual fix (green background was transparent), keyboard navigation now works for all runner actions
- **Theme system:** `--stgm-success-subtle` token available for future use across all client apps
- **Codebase quality:** T01-T06 work reviewed against architect, backend, UX, and web role standards

## Related Work

- T01-T06 runner management UX overhaul (sessions 1-7)
- `2026-05-09-222132-desktop-runner-status-card.md` (T05 status card)
- `2026-05-09-224710-fleet-view-polish.md` (T06 fleet polish)
- `2026-05-09-232313-runner-startup-latency-socket-fix.md` (session 7 socket fix)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
