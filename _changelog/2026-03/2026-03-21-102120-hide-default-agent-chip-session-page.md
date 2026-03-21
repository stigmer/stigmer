# Hide Default Agent Chip on Session Page

**Date**: March 21, 2026

## Summary

Suppressed the agent chip on the session page when the session's agent is the org's default agent, making the behavior consistent with the home page where the default agent is treated as implicit (no chip visible).

## Problem Statement

There was a UX inconsistency between the home page and the session page regarding the default agent chip.

### Pain Points

- On the home page, when no agent is explicitly selected, `agentRef` stays `null` and no chip appears — establishing the mental model "no chip = default agent is being used implicitly"
- On the session page, `useAgentRefFromSession` derived the agent ref from the session's `agentInstanceId` and set it unconditionally, causing the chip to always appear — even when the session was created with the default agent
- A user who started a session without selecting an agent saw no chip on the home page but saw one appear after navigating to the session, breaking consistency

## Solution

Modified the agent-init effect in `SessionPage.tsx` to compare the session's derived agent ref with the org's default agent before setting `agentRef`. When they match, `agentRef` stays `null` and no chip is rendered.

The change was made at the Console level (`client-apps/web`) rather than in the SDK `SessionComposer`, preserving the SDK's simple contract: "show a chip when `agentRef` is set." The decision about what constitutes a "default" agent remains a consumer concern.

## Implementation Details

- Added `useDefaultAgent(org)` call in `SessionPage` to fetch the org's default agent
- Modified the agent-init effect to guard on `isDefaultAgentLoading` and compare `derivedAgentRef` with the default agent's metadata (org + slug)
- When the session's agent matches the default, `agentRef` and `resolution` remain `null` — no chip appears and follow-ups use the session's already-bound agent

## Benefits

- Consistent mental model across home and session pages: "no chip = default agent"
- Reduced visual noise for the most common case (sessions using the default agent)
- No impact on submit logic — the session's bound agent handles follow-ups without needing an override

## Impact

- **Users**: Cleaner session page when using the default agent; agent picker remains accessible via the configure toolbar for those who want to check or change the agent
- **SDK boundary**: No changes to `SessionComposer` or any SDK component — the change is isolated to Console-specific orchestration

## Related Work

- `2026-03-20-182100-session-first-ux-default-agent-resolution.md` — Default agent resolution foundation
- `2026-03-17-121340-session-launcher-sdk-architecture.md` — Session launcher architecture where the "no chip for default" pattern was first established

---

**Status**: ✅ Production Ready
