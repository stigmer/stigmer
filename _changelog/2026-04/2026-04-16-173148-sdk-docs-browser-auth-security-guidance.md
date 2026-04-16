# SDK Docs: Browser Authentication Security Guidance

**Date**: April 16, 2026

## Summary

Updated the React SDK and SDK Overview documentation to clearly separate server-side (`apiKey`) from browser (`getAccessToken`) authentication. The docs now warn against exposing API keys in client-side code and guide developers toward identity federation with JIT provisioning for browser apps.

## Problem Statement

A customer generated an API key in the Stigmer dashboard and asked how to use it in their React app (browser). The existing documentation showed `apiKey` as the primary setup example with no indication that it is a server-side-only credential, and the browser auth path was a single easy-to-miss link redirecting to another page.

### Pain Points

- The React SDK page showed `apiKey` as the default example with no security warning
- No mention that `sk_` keys must not be exposed in client-side JavaScript
- The `getAccessToken` pattern for browser apps was buried in the SDK Overview, not on the React page
- Customers had to piece together three separate docs to understand the correct browser auth approach
- No connection between the React SDK docs and the federation/JIT provisioning guides

## Solution

Added clear server-vs-browser sections to the two SDK documentation pages that developers read first, with security callouts and complete code examples.

## Implementation Details

### React SDK page (`docs/sdk/react/index.mdx`)

- Labeled the existing `apiKey` example under a new "Server-side and internal tools" heading
- Added a "Browser authentication" section with a warning about API key exposure, a complete `getAccessToken` React example using `useMemo`, and links to the Identity Provider registration and federation guides
- Added a summary callout explaining when to use which auth method

### SDK Overview page (`docs/sdk/index.mdx`)

- Replaced the single-method opening paragraph with a dual-method list presenting both `apiKey` (server-side) and `getAccessToken` (browser) upfront
- Added an error-level callout: "Never expose API keys in client-side code"
- Updated the TypeScript tab's `getAccessToken` description to reference browser apps and JIT provisioning instead of the generic "rotating credentials" framing

## Benefits

- Developers landing on the React SDK page immediately see the correct auth pattern for their environment
- The security risk of exposing API keys in browsers is called out explicitly
- The path from "I have an API key" to "I need federation with JIT provisioning" is a single section on the page they are already reading
- No context-switching across multiple documentation pages to understand the browser auth flow

## Impact

- **Customer-facing**: Customers building browser React apps are guided to the secure `getAccessToken` + federation path directly from the React SDK setup page
- **Documentation**: Two files changed (`docs/sdk/react/index.mdx`, `docs/sdk/index.mdx`); federation guides unchanged (already comprehensive)
- **SDK**: No code changes; documentation-only update

## Related Work

- JIT provisioning feature (`_projects/2026-04/20260416.01.jit-provisioning`) — the backend capability that makes browser auth frictionless (one-time IdP registration, automatic account provisioning)
- Federation documentation (`docs/guides/federation/`) — the full guide set that the new sections link to
- Design decision DD-002 ("No token from API key endpoint") — confirmed that the platform JWT is the Stigmer token; no exchange endpoint needed

---

**Status**: ✅ Production Ready
