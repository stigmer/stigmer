# Web-Desktop Feature Parity: Usage Gate Removal, Billing Messaging, and Session Nav

**Date**: May 13, 2026

## Summary

Audited all feature gaps between the Stigmer web console and desktop app. Discovered the billing/usage "cloud-only" gates are deployment-mode driven (local vs cloud), not platform driven (web vs desktop). Removed the incorrect local-mode gate from the Usage page, improved the Billing page messaging to frame local mode positively, and aligned the desktop app's "Back to Sessions" navigation with the web console's session-return behavior.

## Problem Statement

The desktop app's Billing and Usage settings pages showed `CloudFeatureNotice` banners saying the features were only available on Stigmer Cloud, giving the impression these were web-exclusive features. Investigation revealed the gate was based on `deploymentMode` (local vs cloud), not the host platform.

### Pain Points

- Usage page was blanket-gated behind `mode === "local"` despite the OSS Go server having a **full implementation** of `getOrgUsageReport` with aggregation by model, agent, and daily cost trend
- Billing page messaging implied local mode was a limitation rather than a valid operating mode where users bring their own LLM API keys
- Desktop app's "Back to Sessions" always navigated to `/` instead of returning users to the session they were viewing before entering settings

## Solution

Three targeted fixes, all in the SDK and desktop client layers:

1. **Usage gate removal**: Stripped the `useDeploymentMode` + `CloudFeatureNotice` gate from `UsageSection.tsx`. The `OrgUsagePanel` now renders in all deployment modes, and the OSS server returns real usage data.

2. **Billing messaging**: Reworded the `CloudFeatureNotice` from "Connect to a Cloud organization" to "Local mode uses your own LLM API keys directly — no Stigmer credits needed." The gate remains because the OSS server has no billing RPCs.

3. **Session navigation parity**: Added `lastSessionZonePath` tracking to the desktop `AppShell` via a ref-based effect, passed to `ManagementSidebar` as a prop. The "Back to Sessions" link now navigates to the last session-zone path (e.g., `/sessions/abc123`) instead of always going to `/`.

## Implementation Details

- `sdk/react/src/settings/UsageSection.tsx`: Removed `useDeploymentMode` import and the ternary branch that rendered `CloudFeatureNotice` when `mode === "local"`. The component now has a single gate: no org selected.

- `sdk/react/src/billing/BillingSection.tsx`: Updated the `CloudFeatureNotice` children text only. No structural changes.

- `client-apps/desktop/src/shell/AppShell.tsx`: Added `isSessionZonePath()` helper, `lastSessionZonePathRef` and `prevPathnameRef` refs, and a `useEffect` that captures the last session-zone pathname when the user navigates away from the session zone.

- `client-apps/desktop/src/shell/ManagementSidebar.tsx`: Added `lastSessionZonePath` prop with `string | null | undefined` type. The "Back to Sessions" `NavLink` now uses `lastSessionZonePath ?? "/"`.

## Comprehensive Gap Audit

Conducted a full audit of web-vs-desktop feature parity. Findings:

| Gap | Severity | Action |
|-----|----------|--------|
| Usage page gated in local mode | High | **Fixed** — gate removed |
| Billing messaging misleading | Low | **Fixed** — reworded |
| Workflows missing from desktop | Medium | **Deferred** — part of workflow foreground project |
| Session nav "Back" always goes to `/` | Low | **Fixed** — tracks last session path |
| Invite flow web-only | None | Intentionally web-only (browser deep links) |
| Cloud IAM settings gated | None | Correctly gated (no OSS implementation) |

## Benefits

- Desktop users in local mode now see the Usage page with real execution data instead of a dismissive "not available" notice
- Local mode is framed as a valid operating mode, not a second-class experience
- Desktop "Back to Sessions" behavior now matches the web console, reducing disorientation when navigating between settings and sessions

## Impact

- **SDK consumers**: `UsageSection` no longer requires cloud mode to render — platform builders embedding it get usage in all environments
- **Desktop users**: Two UX improvements (usage visibility, session return navigation)
- **Web users**: Billing notice wording improved (same component, shared SDK)

## Related Work

- `20260513.01.cursor-experience-parity` — parent project for usage tracking and context visibility
- `20260508.01.bring-workflows-to-foreground` — deferred desktop workflow parity belongs here

---

**Status**: Production Ready
