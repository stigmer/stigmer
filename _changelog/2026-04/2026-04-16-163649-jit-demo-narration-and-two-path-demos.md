# JIT Demo Narration Regeneration and Two-Path Federation Demos

**Date**: April 16, 2026

## Summary

Regenerated stale narration audio for two JIT-updated demos, redesigned the federation overview tour as a two-path JIT-vs-manual comparison demo, and created a new standalone multi-tenant JIT demo showing `tenantOrgClaim` tenant routing. All demos now visually match the three-mode provisioning model introduced by JIT.

## Problem Statement

The T08 documentation work added JIT provisioning content to all federation guide pages and updated two demo scenarios (`register-idp-playback` and `authentication-flow-playback`) with new steps and narration. Three issues remained:

### Pain Points

- `register-idp-playback` had 6 steps in code but only 5 narration audio entries — the new JIT config step had no audio
- `authentication-flow-playback` step 4 narration text was rewritten for JIT but the MP3 was stale
- `DemoFederationOverviewTour` still showed only the manual 5-step path, despite the overview page now describing three provisioning modes with JIT as the primary recommendation
- The "JIT provisioning for multi-tenant platforms" section in `multi-tenant-setup.mdx` had no visual demo — only code examples and text

## Solution

Three-phase approach: regenerate stale audio, redesign the overview tour, create a new standalone demo.

## Implementation Details

### Phase 1: Narration Audio Regeneration

Ran `make gen-narration` to regenerate MP3s from step `narration` fields. The pipeline uses Microsoft Edge TTS (`edge-tts-universal`) with content-hash caching.

- `register-idp-playback`: Manifest updated from 5 to 6 entries (new `step-4.mp3` for JIT config, new `step-5.mp3` for updated final step)
- `authentication-flow-playback`: `step-4.mp3` re-synthesized (duration 7500ms → 10763ms reflecting longer JIT narration)

### Phase 2: Federation Overview Tour Redesign

Restructured from a 5-step manual-only tour to a 7-step two-path demo:

**JIT path (steps 0-2):**
- Register IdP with JIT enabled (ManagementShell + ProviderPicker + JitToggleSection with enabled toggles)
- User signs in — first login triggers JIT auto-provisioning (BrowserView)
- API call succeeds with 4 checks: token validated, account auto-provisioned (JIT), role granted (JIT), access authorized (APIExchangeView)

**Manual path (steps 3-6):**
- Register IdP without JIT (ManagementShell + ProviderPicker + JitToggleSection with disabled toggles)
- Provision a federated account (CodeEditorView with `createFederatedAccount` code)
- Grant access via IAM Policy (CodeEditorView with `iamPolicy.create` code)
- API call succeeds with 3 checks: token validated, identity resolved, access authorized (APIExchangeView)

Step interactions wired: cursor walks through APIExchangeView checks on steps 2 and 6.

### Phase 3: New Multi-Tenant JIT Demo

Created `DemoMultiTenantJitPlayback` — a 6-step standalone demo placed inside the "JIT provisioning for multi-tenant platforms" section of `multi-tenant-setup.mdx`:

1. Register IdP with JIT + `tenantOrgClaim` (CodeEditorView highlighting the four JIT fields)
2. Create tenant Organization (CodeEditorView with `organization.create`)
3. Tenant org created (TerminalView)
4. User authenticates with tenant JWT (BrowserView with highlighted `org_id` claim in JWT payload)
5. Stigmer resolves tenant and provisions automatically (APIExchangeView with 4 resolution checks)
6. Request succeeds in correct tenant (APIExchangeView with tenant-scoped success)

Step interactions: cursor walks through resolution checks on steps 4-5.

## Benefits

- All demo narration now matches the code — no silent steps or stale audio
- The overview tour visually communicates the JIT value proposition through direct comparison: 3 steps and zero code vs 4 steps and explicit API calls
- The multi-tenant JIT demo makes the "zero per-user provisioning code" promise tangible by showing the full `tenantOrgClaim` resolution flow
- All 26 demos pass `validate-demos.ts` with zero linter errors

## Impact

- **Federation guide readers** see the JIT/manual comparison on the landing page before diving into detailed guides
- **Multi-tenant integrators** get a visual walkthrough of tenant routing alongside the SDK code examples
- **Demo framework** gains 2 new well-structured scenarios following all established patterns (step interactions, narration, cursor walks, visual consistency tokens)

## Related Work

- T08 Documentation (Session 6): Added JIT content to all 6 federation guide pages
- T01-T07: Backend implementation of JIT provisioning across proto, auth pipeline, validation, and testing

---

**Status**: Production Ready
**Timeline**: 1 session
