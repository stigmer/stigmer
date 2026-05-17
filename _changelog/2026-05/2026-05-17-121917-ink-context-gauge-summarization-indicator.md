# Ink CLI Context Gauge + Summarization Indicator

**Date**: May 17, 2026

## Summary

Added a terminal-native context window gauge and summarization indicator to the `@stigmer/ink` SDK, closing the last feature delta between the React SDK and the CLI terminal experience. The Ink `ContextGauge` component renders an ASCII progress bar with health-based coloring, token counts, and summarization event details, reusing the headless `useContextWindow` hook from `@stigmer/react`.

## Problem Statement

The React SDK had full context window visibility (ContextGauge, SummarizationCard, SummarizationBadge) since Session 4-5, but the CLI terminal experience had only a minimal one-liner: "Context compacted (N events, X% utilization)". Users running agents from the terminal had no visual indication of how much context window capacity remained or when summarization occurred.

### Pain Points

- Terminal users had no context utilization visibility during long-running agent sessions
- No health indication (healthy/warning/critical) for context window state
- Summarization events showed no details (token reduction, model, duration, cost)
- Feature gap between web console and CLI terminal undermined parity goals

## Solution

Created a `ContextGauge` component in `@stigmer/ink` that follows the same headless-first architecture as the React SDK: the Ink component calls `useContextWindow` from `@stigmer/react` (the same hook used by the web console's ContextGauge), then renders a terminal-appropriate visualization using Ink primitives.

## Implementation Details

- **`sdk/ink/src/components/ContextGauge.tsx`**: 20-character ASCII progress bar (`█` filled, `░` empty), health-based ANSI coloring (green/yellow/red), compact token formatting (82K, 1.5M), optional health label for non-healthy states, latest summarization event details
- **`sdk/ink/src/app/SessionView.tsx`**: Removed manual `contextInfo` extraction and inline summarization one-liner, replaced with `<ContextGauge>` component positioned between UsageWidget and FollowUpInput
- **`sdk/ink/src/index.ts`**: Barrel export of `ContextGauge` and `ContextGaugeProps`
- **`sdk/ink/src/__tests__/context-gauge.test.tsx`**: 8 test cases covering null/empty/healthy/warning/critical states, token formatting, and summarization event rendering

## Benefits

- CLI terminal users now see real-time context window utilization during agent execution
- Health-based coloring provides at-a-glance status (green = healthy, yellow = approaching limit, red = near limit)
- Summarization events show actionable details: token reduction ratio, model used, duration, cost
- Zero new dependencies — reuses existing `useContextWindow` hook and `@stigmer/react` dependency
- Consistent architecture — same headless hook, different rendering layer (matches UsageWidget pattern)

## Impact

- **CLI users**: Improved visibility into agent execution context state
- **Platform builders**: `ContextGauge` is exported from `@stigmer/ink` for use in custom terminal applications
- **Codebase**: Removed ad-hoc context extraction from SessionView in favor of the established hook pattern

## Related Work

- Session 4: Phase 2 Context Window Visibility (React SDK ContextGauge, useContextWindow hook)
- Session 5: Phase 3a Chat Summarization (ContextTracker, SummarizationCard, SummarizationBadge)
- Session 8-9: CLI mode parity (--mode flag, Ctrl+T toggle)

---

**Status**: Production Ready
**Timeline**: Single session (~30 minutes)
