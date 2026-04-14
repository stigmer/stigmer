# Vendor OAuth Startup Reconciler and Registration Link Fix

**Date**: April 14, 2026

## Summary

Replaced the pattern of writing one-time Mongock migrations for every vendor OAuth config change with a startup reconciler that ensures database state matches vendor definitions on every restart. Also fixed the broken placeholder documentation URL with vendor-specific developer portal links for all five OAuth vendors.

## Problem Statement

Six Mongock migrations (orders 013-018) had accumulated over three days to manage vendor OAuth apps. Every config change — Figma token URL fix, Slack scope parameter, adding GitHub and Google Calendar, setting approval status — required a new one-time migration. The placeholder `vendorApprovalDocsUrl` (`https://docs.stigmer.ai/guides/bring-your-own-oauth`) pointed to a page that does not exist, resulting in a broken link shown to users in the BYOA flow.

### Pain Points

- Changing a single OAuth field (e.g., GitHub client ID rotation) required writing, reviewing, and deploying a new Mongock migration
- The migration folder was growing with incremental patches for what is fundamentally a config reconciliation problem, not schema evolution
- The placeholder BYOA documentation URL sent users to a dead page
- No way to update vendor OAuth state without a code change + migration

## Solution

A dedicated Spring `ApplicationRunner` (`VendorOAuthReconciler`) that runs on every startup and reconciles vendor OAuth apps against a declarative registry of vendor definitions. The reconciler follows the Kubernetes controller reconciliation pattern: desired state is declared in code, the reconciler ensures MongoDB matches.

## Implementation Details

### New Components (`stigmer-cloud`)

**`VendorOAuthDefinition`** — Java record holding the complete desired state for one vendor OAuth app: slug, provider name, OAuth endpoints, scopes, scope parameter name, approval status, and vendor-specific docs URL.

**`VendorOAuthDefinitionRegistry`** — Static registry containing all five vendor definitions as the single source of truth for non-credential fields. Vendor-specific registration URLs:

| Vendor | Registration URL |
|--------|-----------------|
| Slack | `https://api.slack.com/apps` |
| Figma | `https://www.figma.com/developers/apps` |
| Salesforce | `https://help.salesforce.com/s/articleView?id=sf.connected_app_create.htm` |
| GitHub | `https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app` |
| Google Calendar | `https://console.cloud.google.com/apis/credentials` |

**`VendorOAuthReconciler`** — Spring `ApplicationRunner` with `@Order(LOWEST_PRECEDENCE)` that on each startup:

1. Iterates vendor definitions from the registry
2. Resolves credentials from `VendorOAuthBootstrapConfig` (env vars)
3. Skips unconfigured vendors (incremental rollout)
4. For missing OAuthApps: creates with FGA authorization tuples
5. For existing OAuthApps: detects spec drift on non-credential fields and updates if drifted
6. For matching state: no-op (debug log)

Drift detection compares provider, authorizationUrl, tokenUrl, scopes, scopeParameterName, vendorApprovalStatus, and vendorApprovalDocsUrl. Credential comparison is excluded because encrypted values are non-deterministic.

### Existing Migrations: Untouched

All six vendor OAuth migrations (013-018) remain unmodified. They have already been pushed and executed in production. Mongock tracks them in the changelog, and modifying them could cause checksum mismatches that break deployments. The reconciler naturally supersedes their behavior.

### No Proto or Frontend Changes

The `McpServerVendorApprovalEnricher` already reads `vendorApprovalDocsUrl` from the OAuthApp spec and copies it to the McpServer status response. Once the reconciler updates the OAuthApp documents with vendor-specific URLs, the frontend automatically receives the corrected links.

## Benefits

- **Eliminates migration churn**: changing a vendor OAuth field is now a code change to the registry + restart — no migration
- **Fixes broken BYOA link**: users clicking "bring your own app" now reach the actual vendor developer portal
- **Centralized source of truth**: all vendor OAuth definitions live in one registry class
- **Idempotent and safe**: multiple replicas, restarts, and cold starts all produce the same state
- **Adding new vendors**: add definition to registry, add credential config, deploy

## Impact

- **Backend (stigmer-cloud)**: 3 new files, 1 modified file in `config/vendoroauth/`
- **Frontend**: no changes — automatically picks up corrected URLs via enricher
- **Ops**: no changes — credentials continue through the same Planton env var pipeline
- **OSS edition**: not affected — vendor OAuth bootstrap is cloud-only

## Related Work

- [T05: Vendor OAuth Bootstrap Migration](2026-04-11-115305-t05-vendor-oauth-bootstrap-migration.md)
- [Vendor OAuth Approval Status Gating](2026-04-12-111400-vendor-oauth-approval-status-gating.md)
- [BYOA Infrastructure and Resolution Service](2026-04-13-153826-byoa-infrastructure-resolution-service.md)
- [Frontend BYOA Experience](2026-04-13-170304-frontend-byoa-experience.md)

---

**Status**: Production Ready
**Timeline**: Single session
