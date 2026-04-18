# PlatformClient Demo Scenarios for Documentation

**Date**: April 18, 2026

## Summary

Added two interactive Scenar demo scenarios to the PlatformClient documentation page, closing the last deferred item from the PlatformClient project (20260417.01). The demos bring the PlatformClient guide to parity with the federation section, where every page has a live demo.

## Problem Statement

The PlatformClient project completed T01-T06 across 10 sessions, delivering protos, backend, SDK helpers, Console UI, and documentation. However, demo visualizations were explicitly deferred during sessions 6 and 9 as "separate engineering work." The PlatformClient overview page had comprehensive prose and a static mermaid diagram, but no interactive demos --- unlike every page in the federation section.

### Pain Points

- Documentation parity gap: federation pages each have demos, PlatformClient did not
- The "How it works" mermaid diagram was static and couldn't convey timing, interaction patterns, or error scenarios
- Readers couldn't see the Console UI flow for creating a PlatformClient without having a live account
- The token minting flow (backend → Stigmer → frontend) was described in prose but never visualized

## Solution

Created two demo scenarios following the established patterns from the existing demo framework:

1. **platform-client-setup-tour** --- Console walkthrough mirroring the `api-key-setup` pattern, using real `@stigmer/react` SDK components with `PreviewProvider` + `connectFixture` stubs
2. **platform-client-token-flow** --- End-to-end token minting flow visualization mirroring the `authentication-flow-playback` pattern, using BrowserView, TerminalView, and APIExchangeView

## Implementation Details

### Demo 1: platform-client-setup-tour

An 8-step Console walkthrough:

1. Session view → user profile click → menu → Settings
2. ManagementShell with `PlatformClientListPanel` (fixture: one existing "Mobile App" client)
3. Click "New platform client" → `CreatePlatformClientForm`
4. `PlatformClientSecretAlert` with one-time credentials

Technical approach:
- `PreviewProvider` + `connectFixture(PlatformClientQueryController, "listByOrg")` stubs the gRPC query
- Inline protobuf fixtures using `create(PlatformClientSchema, {...})` from `@bufbuild/protobuf`
- Cursor animation on user profile, Settings menu item, and create button
- Mid-step interactions: hover on create button, type animation for client name

### Demo 2: platform-client-token-flow

An 8-step end-to-end flow:

1. BrowserView: user signs in on "Acme Dashboard" (platform builder's app)
2. TerminalView: backend calls `mintUserToken` with client credentials + user identity
3. APIExchangeView: Stigmer validates credentials, resolves user (JIT), 4 validation checks with cursor walk-through
4. TerminalView: JWT response returned
5. BrowserView: frontend initializes `StigmerProvider` with `getAccessToken`
6. APIExchangeView: Stigmer validates user token on API calls, 4 checks with cursor walk-through + authorized result
7. TerminalView: error --- invalid credentials (UNAUTHENTICATED)
8. TerminalView: error --- user not found (NOT_FOUND)

### Supporting Changes

- Added `"platform-clients"` to `ManagementShell` nav (with `Plug` icon, under Configuration group)
- Registered both scenarios in `SCENARIO_REGISTRY` for video export
- Exported `DemoPlatformClientSetupTour` and `DemoPlatformClientTokenFlow` from docs component barrel
- Embedded demos in `overview.mdx`: token flow after "How it works", setup tour after "Prerequisites"

## Benefits

- Documentation parity: PlatformClient guide now has the same interactive demo quality as federation pages
- Console preview: readers can see the PlatformClient CRUD flow without a live account
- Error scenarios: readers see what UNAUTHENTICATED and NOT_FOUND responses look like before encountering them
- Video export: both scenarios are registered in `SCENARIO_REGISTRY` for automated video generation
- Real SDK components: setup tour uses production `@stigmer/react` components, ensuring demos stay in sync with the actual Console

## Impact

- **Documentation readers**: PlatformClient guide is now a first-class documented feature with interactive visual walkthroughs
- **Video generation**: two new scenarios available for automated demo video export
- **Platform builders**: can see the full integration flow (Console setup + token minting + frontend wiring) animated before writing any code

## Related Work

- PlatformClient project (20260417.01): sessions 1-10 built the feature; session 11 (this work) closes the deferred demo item
- Scenar product extraction (20260417.02): the demo framework (`@scenar/react`, `@scenar/preview/connect`) used by these demos
- Federation demo scenarios: `authentication-flow-playback`, `federation-overview-tour`, `register-idp-playback` served as reference implementations

---

**Status**: Production Ready
**Timeline**: 1 session (session 11 of PlatformClient project)
