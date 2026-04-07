# Federation Visual Scenarios and Mid-Step Interaction Framework

**Date**: April 7, 2026

## Summary

Built four interactive visual demo scenarios for the federation documentation and introduced a mid-step interaction framework that enables narration-synced scrolling and cursor movement within scenario steps. Also redesigned the ManagementShell demo component to match the real web app's sidebar layout with all navigation groups.

## Problem Statement

The federation documentation was text-only with Mermaid diagrams. The existing demo infrastructure only supported SDK React component scenarios (AppShell-based). Federation guides needed visual walkthroughs using browser UIs, terminal output, API exchange panels, and code editors — view types that didn't exist yet.

Additionally, the scenario player only supported step-level transitions. There was no way to scroll or move the cursor within a single step during narration, causing content below the fold (like the Audience field in Auth0 settings) to be hidden.

### Pain Points

- Federation docs lacked the visual storytelling present in other guides
- No terminal, browser, API exchange, or code editor view components existed
- Scenario player couldn't animate within a step (only between steps)
- ManagementShell demo sidebar didn't match the real web app's navigation structure
- Hardcoded millisecond timings for mid-step effects would break when narration text changes

## Solution

### Four New Federation Demo Scenarios

1. **federation-overview-tour** — 5-step overview showing IdP registration (real `ProviderPicker`), account provisioning (code), access granting (code), user login (browser), and API authorization (DevTools panel)
2. **register-idp-playback** — 5-step walkthrough: Auth0 dashboard → Identity Providers list → pick provider (real SDK `ProviderPicker`) → configure → registered
3. **provision-grant-playback** — 7-step code-focused flow: signup → check account → NOT_FOUND → create federated account → created → grant IAM Policy → granted
4. **authentication-flow-playback** — 8-step end-to-end flow: login → JWT → API call → token validation → identity resolution → 200 OK → 401 error → 403 error

### Four New View Components

- **BrowserView** — Chrome-style browser with tab strip, navigation bar, address bar with lock icon
- **TerminalView** — macOS iTerm2-style terminal with traffic lights, tab bar, colored prompt
- **APIExchangeView** — Chrome DevTools Network panel with validation pipeline, timing indicators
- **CodeEditorView** — VS Code-style editor with activity bar, file tree sidebar, line numbers, syntax highlighting

### Mid-Step Interaction Framework

New `useStepInteractions` hook with percentage-based timing (`atPercent: 0.0–1.0`) synced to narration clip duration from the manifest. Falls back to `delayMs` when no narration is available.

- **Browser path**: `setTimeout` at `atPercent * durationMs`
- **Video export path**: synchronous firing via `useTimeSource()` for Remotion frame accuracy
- **Action types**: `scroll-to` (data-scroll-target), `set-cursor`, `clear-cursor`
- Interactions automatically adjust when narration is re-generated — proportional, not hardcoded

### ManagementShell Redesign

Rebuilt with CSS `zoom` approach: authored at real-app dimensions (`text-sm`, `size-4` icons, standard spacing from `settings-nav.ts`) then uniformly scaled to fit the demo container. Includes all three navigation groups (Organization, Configuration, Billing & Usage) with all 8 items matching the real Console.

## Implementation Details

### New Engine Files
- `engine/scroll-utils.ts` — Shared `scrollTargetIntoView` and `findScrollParent` extracted from `Cursor.tsx`, plus `scrollTargetIntoViewInstant` for video export
- `engine/useStepInteractions.ts` — Hook with `StepAction`, `StepInteractions` types, dual browser/Remotion execution paths

### Scenario Wiring
- **register-idp-playback**: Scroll to Audience field at 55% of step 0 narration
- **authentication-flow-playback**: Cursor walks through 4 validation checks (step 3) and 2 resolve checks (step 4) at evenly spaced percentages
- `APIExchangeView` check items annotated with `data-cursor-target="check-{i}"` for cursor targeting

### MDX Integration
- All 4 scenarios embedded in their respective federation guide pages via `Demo*` components
- Registered in `SCENARIO_REGISTRY` for video export
- Narration audio generated for all scenarios

## Benefits

- Federation guides now have the same visual storytelling quality as the Quickstart and SDK guides
- Mid-step interactions are a reusable framework — any future scenario can add scroll/cursor effects
- Percentage-based timing eliminates fragile hardcoded delays
- ManagementShell zoom approach is future-proof — new nav items automatically fit
- Video export works for all interactions via the Remotion time source path

## Impact

- **Documentation**: All 5 federation guide pages now have interactive demos with narration
- **Framework**: Scenario player gains mid-step interaction capability (opt-in, backward compatible)
- **Demo fidelity**: ManagementShell, BrowserView, TerminalView, APIExchangeView all redesigned for realism

## Related Work

- [Federation Documentation](2026-04-07-112452-federation-documentation.md)
- [IdP Federation Hardening](2026-04-07-124000-idp-federation-hardening.md)
- [Demo Components Three-Tier Architecture](2026-04-02-164409-demo-components-three-tier-architecture.md)
- [Scenario Player Audio Narration Engine](2026-04-03-151559-scenario-player-audio-narration-engine.md)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
