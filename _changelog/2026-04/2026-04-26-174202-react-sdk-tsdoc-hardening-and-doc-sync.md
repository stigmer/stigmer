# Harden React SDK TSDoc Validation and Sync Generated Docs

**Date**: April 26, 2026

## Summary

Stigmer's full quality gate (`make check`) was failing because React SDK TypeDoc validation treats documentation warnings as errors. This session closed that gap by documenting missing public exports in `@stigmer/react`, then regenerating React SDK reference artifacts so code and generated docs stay aligned. The result is a clean end-to-end check run without relaxing validation strictness.

## Problem Statement

The React SDK had public symbols and nested exported prop fields without TypeDoc coverage. Because the repo enforces `typedoc --treatValidationWarningsAsErrors`, these warnings blocked `make check` and prevented a clean merge path even though runtime behavior was correct.

### Pain Points

- `make check` failed in `sdk/react` due to API documentation warnings.
- Fixing source docs surfaced a second blocker: stale generated React SDK docs.
- Manual recovery steps were required to restore CI-readiness (`tsdoc` + docs generation).

## Solution

Added concise, targeted TSDoc for all flagged public React SDK exports and export-linked properties, then regenerated React SDK docs and metadata artifacts. This preserved strict quality policy while making the API surface self-documented.

## Implementation Details

- Documented `OrgGateState` variants in `sdk/react/src/organization/useOrgGate.ts`.
- Documented settings navigation API in `sdk/react/src/settings/settings-nav.ts`.
- Added export-level docs to all settings section components:
  - `ApiKeysSection`
  - `MembersSection`
  - `OrgProfileSection`
  - `EnvironmentsSection`
  - `InvitationsSection`
  - `IdentityProvidersSection`
  - `PlatformClientsSection`
  - `OAuthAppsSection`
  - `UsageSection`
- Documented exported nested user prop fields in `sdk/react/src/user/UserMenu.tsx`.
- Documented `useBreadcrumbOverride` return contract in `sdk/react/src/library/LibraryBreadcrumbContext.tsx`.
- Regenerated React SDK reference output with `make gen-react-sdk-docs`, updating:
  - `docs/sdk/react/*` (including new `settings.mdx` and `user.mdx`)
  - `site/src/data/react-sdk-summary.json`
  - `site/yarn.lock`

## Benefits

- Restores green `make check` without downgrading quality gates.
- Improves public API discoverability and generated docs quality.
- Reduces future friction when evolving settings and organization-facing SDK surfaces.

## Impact

- **Developers**: can run strict checks locally and in CI without docs-related false blockers.
- **SDK consumers**: get clearer generated references for settings, org gate, and user-menu APIs.
- **Documentation pipeline**: remains source-of-truth driven and consistent with exported code.

## Related Work

- `2026-04-26-124022-useorggate-sdk-extraction.md` (prior org-gate SDK extraction)
- Project: `20260405.03.settings-layout-refactor`

---

**Status**: ✅ Production Ready
**Timeline**: Same-session quality hardening and validation remediation
