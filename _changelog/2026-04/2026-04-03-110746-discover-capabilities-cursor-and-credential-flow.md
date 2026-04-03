# Add cursor overlay and credential entry flow to Discover Capabilities demo

**Date**: April 3, 2026

## Summary

Enhanced the Discover Capabilities playback demo with an animated cursor overlay and a full credential entry flow. The demo now walks through every step a user would see — clicking Discover, entering an API key, saving credentials, and seeing tools appear — using the real SDK `McpServerDetailView` and `EnvVarForm` components.

## Problem Statement

The Discover Capabilities demo on the "Connect your tools" Getting Started page was missing two things that made it feel incomplete:

### Pain Points

- No cursor overlay — unlike the MCP creation tour (which has an animated pointer), the Discover demo had no visual guide showing where to click
- The credential entry step was invisible — the demo jumped from "no tools" straight to "tools discovered," skipping the real-world flow where the user must enter an API key before discovery can proceed
- Readers unfamiliar with the product had to guess what happens between clicking Discover and seeing results

## Solution

Extended the demo from 3 steps to 5, adding the cursor component and two credential-entry steps. Added small, non-breaking props to `McpServerDetailView` so the credential form can be pre-opened and pre-filled without user interaction — keeping everything rendered by real SDK components.

## Implementation Details

### SDK changes (non-breaking)

**`McpServerDetailView`** — two new optional props:

- `defaultShowCredentialForm` — initializes the credential form as open on mount (normally it opens only after clicking Discover with missing creds)
- `credentialPoolValues` — flows to `EnvVarForm.poolValues`, pre-filling input fields on mount

Added `data-cursor-target` attributes to the Discover button (`discover-button`) and credential form wrapper (`credential-form`) so the cursor can target them.

**`EnvVarForm`** — added `data-cursor-target="env-form-submit"` on the submit button.

### Demo changes

**Steps** expanded from 3 → 5:

1. `no-tools` — server detail with env spec visible, no cursor
2. `click-discover` — cursor moves to the Discover button
3. `credential-form` — credential form opens with empty API_KEY input, cursor on the form
4. `credential-filled` — API key pre-filled, cursor on Save button
5. `tools-discovered` — 3 tools appear

**Component** updated to mount a `Cursor` overlay, map each step to a cursor target, and pass `defaultShowCredentialForm` / `credentialPoolValues` to `McpServerDetailView`. Each step forces a component remount via `key={step.view}` so internal state initializes correctly.

## Benefits

- The demo now mirrors the actual product flow — no invisible steps
- Credential entry is shown explicitly, reducing confusion for first-time readers
- The animated cursor draws attention to the right element at each step
- All UI is rendered by real SDK components (`McpServerDetailView`, `EnvVarForm`) — no recreated or mocked sections

## Impact

- **Docs site**: "Connect your tools" Getting Started page — the Discover Capabilities demo is more interactive and self-explanatory
- **SDK**: `McpServerDetailView` gains two optional props useful for embedding scenarios, onboarding flows, and deep-linking
- **SDK**: `EnvVarForm` and `McpServerDetailView` gain `data-cursor-target` attributes useful for guided tours and test automation

## Related Work

- 2026-04-02-195258 — Connect your tools Getting Started page (introduced this demo)
- 2026-04-02-192704 — MCP server detail view UX overhaul
- 2026-04-02-141121 — Skill creation guided tour demo (established the cursor pattern)

---

**Status**: ✅ Production Ready
