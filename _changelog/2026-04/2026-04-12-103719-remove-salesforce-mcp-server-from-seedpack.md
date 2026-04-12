# Remove Salesforce MCP Server from Seedpack

**Date**: April 12, 2026

## Summary

Removed the Salesforce MCP server from the seedpack catalog. The Salesforce OAuth integration was encountering `invalid_client` errors during token exchange, indicating the Connected App credentials were not properly configured. Rather than ship a broken integration, the server was removed until credentials and configuration are validated.

## Problem Statement

Attempting to connect a Salesforce MCP server via the OAuth Connect flow resulted in an HTTP 400 `invalid_client` / `invalid client credentials` error from Salesforce's token endpoint. The root cause is likely misconfigured or missing Connected App credentials in the Planton service-hub secrets.

### Pain Points

- Users could discover and attempt to connect the Salesforce MCP server, only to hit a hard failure at the token exchange step
- The error is opaque from the user's perspective — the backend logs reveal the cause, but the UI cannot surface it clearly

## Solution

Remove the Salesforce MCP server definition from the seedpack so it no longer appears in the marketplace catalog. This prevents users from encountering the broken OAuth flow.

## Implementation Details

- Deleted `seedpack/mcp-servers/mcp-server-salesforce.yaml`
- Removed the Bazel embed reference from `seedpack/BUILD.bazel`
- Updated `seedpack/mcp-servers/CONTRIBUTING.md` to remove Salesforce from the `crm-support` category example

## Impact

- Salesforce MCP server will no longer appear in the marketplace for new installations
- The `stigmer-cloud` backend still retains the Salesforce vendor OAuth bootstrap migration and environment wiring — these are inert without a corresponding seedpack entry but can be cleaned up separately

---

**Status**: Production Ready
