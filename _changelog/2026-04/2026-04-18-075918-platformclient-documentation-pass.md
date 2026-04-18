# PlatformClient Documentation Pass

**Date**: April 18, 2026

## Summary

Completed the T06 documentation pass for the PlatformClient feature, fixing factual inaccuracies in the identity concepts page, adding PlatformClient to the platform vocabulary, polishing the PlatformClient integration guide, and ensuring cross-reference consistency across the documentation.

## Problem Statement

The PlatformClient feature (T01–T05, sessions 1–8) shipped fully functional backend, SDK, and Console UI, but the documentation had three categories of gaps:

### Pain Points

- The `docs/concepts/identity.mdx` page was factually wrong — it claimed "Stigmer never provisions automatically" despite JIT provisioning existing for both federation and PlatformClient
- The identity concepts page listed only three account types (Direct, Federated, Machine) with no mention of PlatformClient-provisioned accounts
- PlatformClient was missing from the vocabulary guide and glossary, creating an inconsistency with every other IAM resource
- The PlatformClient integration guide lacked "when to use this" framing, troubleshooting guidance, and forward navigation links
- Cross-references from concepts pages didn't link to the PlatformClient guide

## Solution

Focused on fixing real gaps rather than manufacturing additional guide pages. The original plan called for splitting PlatformClient into four guide pages (overview, quick-start, token-endpoint, auto-provisioning). Pushed back on this — PlatformClient's value proposition is simplicity, and the documentation structure should reflect that. One comprehensive guide page is proportional to the feature's complexity, matching the signal federation's seven pages sends about its greater complexity.

## Implementation Details

### Identity concepts page (`docs/concepts/identity.mdx`)

- Added "Platform" as a fourth account type alongside Direct, Federated, and Machine
- Rewrote the federated authentication section to acknowledge both JIT and manual provisioning modes
- Added a new "How PlatformClient authentication works" section with a Mermaid sequence diagram showing the mint-validate-authorize flow
- Updated "What's next" with decision-oriented links to all three auth paths

### Vocabulary and glossary

- Added PlatformClient to the quick-reference table in `docs/vocabulary.md`
- Created a full detailed entry with definition, API surface, key fields, context rules, and industry-pattern note (Twilio, Stream, Liveblocks)
- Updated the Identity Account entry from three types to four, corrected the provisioning mode list, and fixed the stale "never creates accounts automatically" note
- Added PlatformClient tooltip to `site/src/components/docs/glossary.ts`

### PlatformClient guide polish (`docs/guides/authentication/platform-client/overview.mdx`)

- Added "When to use this" section with three use-case bullets and a Callout routing readers to federation or API keys if they landed on the wrong page
- Renamed "JIT provisioning" heading to "Automatic account creation" (plainer language per doc writer role)
- Added a four-step `<Steps>` troubleshooting section: verify credentials, check user existence, verify user ID consistency, check allowed origins
- Replaced the negative "What this is NOT" section with a constructive "What's next" linking to SDK reference, React hooks, federation, and auth overview

### Cross-reference audit

- Added PlatformClient link to `docs/concepts/identity.mdx` "What's next"
- Added PlatformClient bullet to `docs/concepts/organizations.mdx` "What's next" with org-scoped identity note
- Verified all six pages that reference the PlatformClient guide link correctly
- Confirmed zero stale links to old `docs/guides/federation/` or `docs/guides/platform-client-auth.mdx` paths

## Benefits

- Identity concepts page is now factually accurate for all provisioning modes
- PlatformClient is discoverable through the `<Term>` tooltip system and vocabulary guide
- Readers landing on the PlatformClient guide can immediately tell if it's the right auth method for them
- Troubleshooting section reduces support burden for the four most common integration errors
- Cross-references create a connected documentation surface — readers can navigate from concepts to guides to SDK reference without dead ends

## Impact

- **Documentation accuracy**: Fixed three factual inaccuracies in a high-traffic concepts page
- **Discoverability**: PlatformClient now appears in vocabulary, glossary, and cross-references from two concepts pages and four guide/SDK pages
- **Reader experience**: The PlatformClient guide now matches the quality bar set by the federation guides (context framing, troubleshooting, forward navigation)

## Related Work

- [PlatformClient proto definition](2026-04-17-110512-platformclient-proto-definition.md)
- [PlatformClient backend CRUD](2026-04-17-114806-platform-client-backend-crud.md)
- [PlatformClient auth chain and JIT](2026-04-17-160746-platform-client-auth-chain-jit-provisioning.md)
- [PlatformClient SDK auth helpers](2026-04-17-165012-platform-client-sdk-auth-helpers.md)
- [PlatformClient Console UI](2026-04-17-171918-platform-client-console-ui.md)
- [Rescope PlatformClient identity to org](2026-04-17-183632-rescope-platformclient-identity-to-org.md)

---

**Status**: ✅ Production Ready
**Timeline**: 1 session (session 9)
