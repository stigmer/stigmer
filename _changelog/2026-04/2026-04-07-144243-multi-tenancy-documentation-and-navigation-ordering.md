# Multi-Tenancy Documentation and Navigation Ordering

**Date**: April 7, 2026

## Summary

Added multi-tenant platform documentation to the identity federation guides, corrected a factual error in the Organizations concept page, enriched the page with management mode and multi-tenancy explanations, reordered the docs sidebar to match Diataxis, and added missing vocabulary entries for Identity Provider, Identity Account, and identity federation.

## Problem Statement

The federation documentation only covered the single-organization use case: register an Identity Provider, provision federated accounts, grant access, authenticate. But Stigmer's domain model fully supports multi-tenant platforms where an external platform creates one platform-managed Organization per customer, giving each tenant isolated resources. This use case had no documentation.

### Pain Points

- The `platform_managed` description in `concepts/organizations.mdx` was factually wrong — it said "Stigmer Cloud manages infrastructure" when the proto definition says "Created programmatically by an external platform via an IdentityProvider"
- No documentation explained how to create platform-managed Organizations, map external tenant IDs, or provision users per tenant
- The sidebar ordered Concepts before Guides, putting explanation before action — opposite of the Diataxis recommendation (Tutorial → How-to → Reference → Explanation)
- `docs/vocabulary.md` had no entries for Identity Provider, Identity Account, or identity federation despite extensive federation documentation

## Solution

### Sidebar reordering

Changed `docs/meta.json` from `[getting-started, concepts, guides, sdk]` to `[getting-started, guides, sdk, concepts]`. This matches Diataxis: Getting Started (Tutorial), Guides (How-to), SDK Reference (Reference), Concepts (Explanation). Action-oriented content now sits closer to the entry point.

### Organizations concept page overhaul

Fixed the `platform_managed` table description to match the proto definition. Added three new sections:

- **Management modes** — explains self-managed vs platform-managed with YAML examples and when each is appropriate
- **Multi-tenant platforms** — explains the one-org-per-tenant pattern with a Mermaid diagram and a 4-step overview (register IdP → create orgs → provision users → authenticate)
- **What's next** — links to the federation guide, multi-tenant setup guide, and SDK reference

### New multi-tenant platform setup guide

Created `docs/guides/federation/multi-tenant-setup.mdx` — a Diataxis how-to page for platform developers who need per-tenant Organizations. Includes:

- Architecture diagram showing the multi-tenant wiring (platform → IdP → tenant orgs → isolated resources)
- SDK code in all 4 languages (TypeScript, Go, Python, Java) for: creating platform-managed Organizations, looking up orgs by external ID, provisioning users per tenant, granting access
- A complete tenant onboarding flow example combining all operations
- Cross-links to prerequisite and follow-up pages

### Federation overview update

Added a "Multi-tenant platforms" section at the end of the federation overview with a card linking to the new guide page. The existing 4-step linear flow is preserved; multi-tenancy is an extension for platforms that need it.

### Vocabulary entries

Added three entries to `docs/vocabulary.md` under Tier 2 (Platform structure):

- **Identity Provider** — trust relationship for token validation
- **Identity Account** — principal with three provisioning modes (direct, federated, machine)
- **Identity federation** — the pattern of external auth integration (lowercase, not a resource type)

Also added corresponding rows to the quick-reference table.

## Implementation Details

### Files modified

- `docs/meta.json` — sidebar reordering (1 line)
- `docs/concepts/organizations.mdx` — error fix + 3 new sections (+125 lines)
- `docs/guides/federation/multi-tenant-setup.mdx` — new file (~650 lines)
- `docs/guides/federation/meta.json` — registered new page
- `docs/guides/federation/overview.mdx` — added multi-tenant card section
- `docs/vocabulary.md` — 3 new entries + quick-reference rows (+56 lines)

### SDK code pattern consistency

All code examples in the new guide follow the exact SDK patterns established in the existing federation pages: `<SDKTabs>` with TypeScript/Go/Python/Java tabs, consistent org names ("acme", "acme-cloud-auth"), consistent method signatures matching the auto-generated SDK reference, and proper error handling patterns.

### Domain model alignment

The documentation directly reflects the proto definitions:

- `ManagementMode` enum from `tenancy/organization/v1/enum.proto`
- `OrganizationSpec` fields (`management_mode`, `identity_provider_ref`, `external_org_id`) from `spec.proto`
- `getByExternalOrgId` RPC from `query.proto`
- `OrganizationExternalLookup` message from `io.proto`
- `createFederatedAccount` from `iam/identityaccount/v1/command.proto`

## Benefits

- Platform developers building multi-tenant applications on Stigmer now have a complete guide for per-tenant Organization setup
- The factual error about `platform_managed` is corrected before it could mislead integrators
- Sidebar ordering now follows Diataxis, putting actionable content (Guides, SDK Reference) before conceptual content
- Identity/federation terms are formally defined in the vocabulary, ensuring consistent language across all docs

## Impact

- **Documentation**: Federation guide section grows from 5 to 6 pages; Organizations concept page doubles in size with essential multi-tenancy content
- **Discoverability**: Guides and SDK Reference move up in the sidebar, matching how developers actually use documentation (action first, theory later)
- **Correctness**: The `platform_managed` description now matches the proto source of truth

## Related Work

- [Federation Documentation](2026-04-07-112452-federation-documentation.md)
- [Federation Visual Scenarios and Interaction Framework](2026-04-07-141850-federation-visual-scenarios-and-interaction-framework.md)
- [IdP Federation Hardening](2026-04-07-124000-idp-federation-hardening.md)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session
