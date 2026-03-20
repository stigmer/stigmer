# Rename "Shared Environments" to "Environments" on Settings Page

**Date**: March 20, 2026

## Summary

Renamed the "Shared Environments" section to "Environments" on the Settings page and updated description copy across both sections. The previous naming created a false dichotomy between "Personal" and "Shared" that misrepresented user intent — users create environments to store secrets, not to share them.

## Problem Statement

The Settings page presented two environment sections with misleading labels:

### Pain Points

- **"Shared Environments" presupposed intent** — users create environments to hold credentials and configuration for agents, not to share them with teammates. Sharing is a consequence of org-scoped IAM, not a user action.
- **False category** — an environment used by a single person was still labeled "shared," which is confusing.
- **Missing lifecycle context** — the Personal Environment description didn't communicate that it's automatically managed by the system, a key behavioral difference from user-created environments.
- **Industry misalignment** — platforms like GitHub, AWS, and Kubernetes use scope-based qualifiers (personal, organization, project), not behavior-based ones (shared, private).

## Solution

Reframed the naming to reflect **scope** and **purpose** rather than **behavior**:

- "Shared Environments" → "Environments" (no qualifier needed — they're just environments)
- Updated the section description to focus on what environments are for (storing credentials and config for agents) rather than what happens to them (sharing)
- Added "automatically managed for you" to the Personal Environment description to communicate the auto-managed lifecycle

## Implementation Details

### Settings page (`EnvironmentsSection.tsx`)

| Element | Before | After |
|---------|--------|-------|
| Section heading | "Shared Environments" | "Environments" |
| Section description | "Environments shared across your organization. Members with access can view and manage variables." | "Named environments for your organization. Store credentials, API tokens, and configuration that agents need at runtime." |
| Personal description | "Your private secrets and configuration. These are only visible to you and are used when running agents that require credentials." | "Your private secrets and configuration, automatically managed for you. Only visible to you — used when running agents that require your personal credentials." |
| Internal component name | `OrgEnvironmentsCard` | `EnvironmentsCard` |

### SDK component (`EnvironmentListPanel.tsx`)

Updated JSDoc for `excludeLabels` prop: "shared list" → "organization list".

### What did NOT change

- "Personal Environment" heading — kept as-is; correctly describes scope
- "YOU" badge — kept as-is
- Proto definitions — no changes; `stigmer.ai/personal` label convention unchanged
- SDK hook names — `usePersonalEnvironment`, `useEnvironmentList`, `useCreateEnvironment` unchanged
- SDK component names — `EnvironmentListPanel`, `CreateEnvironmentForm`, `EnvironmentVariableEditor` unchanged
- `CreateEnvironmentForm` copy — "Create environment" button and field labels unchanged

## Benefits

- **Accurate mental model** — the UI no longer implies that creating an environment is an act of sharing
- **Lifecycle clarity** — users now understand the Personal Environment is auto-managed, not something they need to create or maintain
- **Purpose-driven copy** — descriptions tell users what environments are *for*, not what *happens* to them

## Impact

- **Settings page** — all users see the updated labels and descriptions
- **SDK consumers** — no breaking changes; only a JSDoc comment updated in `EnvironmentListPanel`
- **Blast radius** — copy-only change in two files; zero API, hook, or component signature changes

## Related Work

- [Settings page environment management](./2026-03-19-192354-settings-page-environment-management.md) — initial implementation of the environments settings UI
- [Personal env/instance orchestration hooks](./2026-03-19-180749-personal-env-instance-orchestration-hooks.md) — the `usePersonalEnvironment` hook that manages the auto-created environment

---

**Status**: ✅ Production Ready
