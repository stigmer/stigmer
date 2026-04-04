# SDK Overview Landing Page for SDK Reference Section

**Date**: April 4, 2026

## Summary

Added the SDK Overview page (`docs/sdk/index.mdx`) — the landing page for the SDK Reference section. This is the first of three manual pages planned for T06, covering installation, authentication, client configuration, resource access patterns, error handling, pagination, and streaming across all four SDK languages.

## Problem Statement

The SDK Reference section had 18 auto-generated resource pages but no landing page. A developer clicking "SDK Reference" in the nav would land on the first resource page (Agent) with no orientation — no install instructions, no authentication guide, no error handling reference, no explanation of how the SDK is organized.

### Pain Points

- No single page explaining how to install the SDK in any language
- Authentication and client configuration undocumented outside the quickstart tutorial
- Error handling types and classification helpers (isNotFound, isRetryable, etc.) not documented anywhere as reference material
- No explanation of the `client.<resource>.<method>()` naming convention across languages
- Pagination pattern undocumented

## Solution

Created a hand-written Reference page (Diataxis type: Reference) that serves as the section landing page. The page uses SDKTabs for cross-page language persistence and documents every cross-cutting SDK concern in one scannable location.

## Implementation Details

- **File**: `docs/sdk/index.mdx`
- **Register**: Reference / SDK — precise, uses API field names, assumes platform familiarity
- **Components**: Uses `<SDKTabs>`, `<Tab>`, `<Callout>`, `<Cards>`, `<Card>` (all globally available in the Fumadocs MDX setup)
- **Sections**: Installation, Authentication, Configuration, Resource Clients, Error Handling, Pagination, Streaming, What's Next

### Key decisions

- **Error handling**: Showed one example per language rather than one language only, because the error APIs genuinely differ (TS free functions, Go package functions, Python free functions with snake_case, Java instance methods on the exception)
- **TypeScript `getAccessToken`**: Included as a second code block within the Authentication TS tab — it's a real configuration option and a Reference page should document all options
- **Configuration tables**: Per-language option tables rather than a single cross-language table, since each language has different options
- **Accessor names**: Used correct names from actual SDK source (Python plural `client.agents`, Java plural `client.agents()`) which differ from generated resource pages — flagged as a pre-existing codegen bug for separate fix

## Benefits

- Developers landing on SDK Reference now get immediate orientation
- Installation, auth, and error handling documented in one scannable page
- Resource access pattern table shows all four naming conventions at a glance
- Links to Streaming guide and React SDK page (coming next in T06)

## Impact

- SDK Reference section has a proper entry point
- Quickstart no longer the only place documenting authentication
- Foundation established for the streaming guide and React SDK page (remaining T06 work)

## Related Work

- Part of project `20260403.03.sdk-docs-auto-generation`, task T06
- Builds on the 18 auto-generated resource pages from T02–T04
- Depends on proto comment cleanup from T05 (sessions 4–6)
- Streaming guide and React SDK page are the remaining T06 deliverables

---

**Status**: ✅ Production Ready (page 1 of 3 in T06)
**Timeline**: Session 7, ~1 hour
