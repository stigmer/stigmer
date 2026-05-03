# React SDK: Stable Thread Keys and Pending Message Reconciliation

**Date**: May 3, 2026

## Summary

Replaced all index-based React keys in the message thread with stable execution-ID-based keys, eliminating unnecessary DOM remounts during streaming and session navigation. The pending-to-confirmed user message transition now uses a shared bridging key so React updates in place instead of tearing down and rebuilding the DOM.

## Problem Statement

The `@stigmer/react` SDK's `MessageThread` component used array-position-based keys (`e${ei}-m${mi}`) for thread items. This caused three classes of issues:

### Pain Points

- **Key instability during streaming**: When an execution transitioned from "active stream" to "completed" (or a new follow-up started), its array index shifted, causing React to unmount and remount all DOM nodes for that execution — destroying collapse state in ThinkingMessage, ToolCallGroup, and SubAgentSection
- **Pending message flash**: The optimistic user message used key `pending-user-message` while the server-confirmed spec message used `e${ei}-spec-msg` — different keys AND different component types, forcing React to destroy one and create the other, producing a visible flash
- **Sub-agent key collisions**: Sub-agent inner thread items used a generic `sa-m${i}` prefix, meaning two concurrent sub-agents could produce identical keys (`sa-m0` from sub-agent A vs `sa-m0` from sub-agent B)

## Solution

Derive keys from stable server identifiers instead of array positions. Bridge the pending-to-confirmed user message transition through a shared key and consistent component type.

## Implementation Details

### Execution-ID-based keys in `buildThreadItems`

All thread item keys now use `exec.metadata.id` (a server-assigned, immutable UUID) instead of the execution's array index:

| Before | After |
|--------|-------|
| `e${ei}-spec-msg` | `${execId}-spec` |
| `e${ei}-m${mi}` | `${execId}-m${mi}` |
| `e${ei}-m${mi}-tc` | `${execId}-m${mi}-tc` |
| `e${ei}-m${mi}-sa${ti}` | `sa-${subAgent.id}` |

A defensive fallback `exec.metadata?.id ?? _e${ei}` handles the edge case where metadata is absent.

### Pending message bridging

The pending user message and the active stream execution's spec message now share the key `pending-user-turn`. The pending message is rendered through `MessageEntry` (as a synthetic `AgentMessage` with `isPending: true`) instead of a raw div, so React sees the same component type across the transition and updates in place.

Transition lifecycle:
1. **Phase A** (user submitted, no stream yet): pending message with key `pending-user-turn`, `opacity-70`
2. **Phase B** (stream delivers first snapshot): spec message takes the same key — React updates in place, no remount
3. **Phase C** (execution completes): spec message transitions to permanent key `${execId}-spec` — one-time key change at a quiet moment

The `ThreadItem` union was simplified: the `pending-message` variant was removed entirely, replaced by the existing `message` variant with an optional `isPending` flag.

### Sub-agent key scoping

`buildSubAgentThreadItems` now receives the `SubAgentExecution.id` and uses it as a prefix (`${subAgentId}-m${i}`), ensuring globally unique keys even with concurrent sub-agents.

### Dev tooling: duplicate key detection

The `useKeyStability` hook gained a duplicate key check that runs every render, warning immediately if two thread items share the same key. This catches collision bugs during development before they cause silent React rendering issues.

### Test coverage

14 new tests in `thread-keys.test.ts` cover:
- Execution-ID-based keys (messages, tool groups, sub-agents)
- Key stability across active-to-completed transition
- Pending-to-confirmed bridging (5 scenarios: basic pending, bridging match, permanent key, mismatch, suppression)
- No duplicate keys in a realistic multi-execution scenario
- MESSAGE_TOOL skipping, empty AI message handling, metadata-missing fallback

## Benefits

- **No more key-swap remounts during streaming**: Completed message rows keep their DOM nodes and local state (collapse toggles, scroll position) when a new execution starts or the active execution completes
- **Seamless pending → confirmed transition**: Users see their message smoothly transition from "sending" to "sent" without a flash
- **Correct key uniqueness**: Sub-agent items are properly scoped, preventing potential rendering anomalies
- **Dev-time safety net**: Duplicate key detection catches future regressions immediately during development

## Impact

- **`@stigmer/react` SDK consumers**: Zero API changes. All existing props and component contracts preserved. The improvement is purely internal.
- **Test suite**: 266/266 pass (14 new, 252 existing unchanged)
- **Bundle size**: No new dependencies, negligible code size change

## Related Work

- Preceded by: [React SDK Streaming Render Instrumentation](2026-05-03-102015-react-sdk-streaming-render-instrumentation.md) (T02) — dev-only instrumentation that surfaces the key instability this change fixes
- Next phase: T04 (ConversationStore with structural sharing) will build on these stable keys to implement row-level subscriptions via `useSyncExternalStore`

---

**Status**: Production Ready
**Commit**: `7dd39aafe`
**Timeline**: T03 of the React SDK Streaming UX project (Phase 1: Fix Keys & Pending Reconciliation)
