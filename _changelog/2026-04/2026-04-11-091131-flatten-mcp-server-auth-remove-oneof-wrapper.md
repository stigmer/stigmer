# Flatten McpServerAuth: Remove Anemic Oneof Wrapper

**Date**: April 11, 2026

## Summary

Simplified `McpServerAuth` from a three-message oneof structure into a single flat message. The auth mode is now determined by presence/absence of `oauth_app_ref` rather than an explicit oneof discriminator wrapping two one-field messages. Net reduction of ~1,600 lines across generated stubs.

## Problem Statement

The initial `McpServerAuth` design used an explicit `oneof method` containing `McpOAuth` (one field: `scope_hints`) and `McpServerVendorOAuth` (one field: `oauth_app_ref`). Three message types to express a simple idea: "does this server need an OAuthApp or not?"

### Pain Points

- `McpOAuth` and `McpServerVendorOAuth` each had exactly one field -- anemic models that existed purely for type discrimination
- The oneof prevented no invalid states: the two fields (`scope_hints` and `oauth_app_ref`) don't conflict and are valid on the same message
- YAML authoring required extra nesting (`mcp_oauth:` or `vendor_oauth:` wrappers) for no semantic benefit
- Handler code needed oneof variant switching instead of a simple nil check
- Generated 4 extra Java classes, additional Go interface types, and extra TypeScript types -- all structural overhead

## Solution

Replaced with a single flat message where `oauth_app_ref` presence is the natural discriminator:

```protobuf
message McpServerAuth {
  ApiResourceReference oauth_app_ref = 1;  // empty = DCR, set = vendor OAuth
  string target_env_var = 2;
  string token_lifetime_hint = 3;
  repeated string scope_hints = 4;
}
```

## Implementation Details

The refactoring touched only `apis/ai/stigmer/agentic/mcpserver/v1/spec.proto`:

- Removed `McpOAuth` message (was: 1 field)
- Removed `McpServerVendorOAuth` message (was: 1 field)
- Removed `oneof method` from `McpServerAuth`
- Promoted `oauth_app_ref` to a direct field on `McpServerAuth` (optional -- empty means DCR)
- Moved `scope_hints` from `McpOAuth` to `McpServerAuth` (useful for both auth modes)
- Renumbered fields 1-4 (safe: proto was created in the same session, no deployed consumers)

## Benefits

- **1,600 fewer generated lines** across Go, Java, Python, TypeScript stubs
- **4 Java files deleted** (`McpOAuth.java`, `McpOAuthOrBuilder.java`, `McpServerVendorOAuth.java`, `McpServerVendorOAuthOrBuilder.java`)
- **Cleaner YAML**: `auth: { target_env_var: ... }` instead of `auth: { mcp_oauth: {} target_env_var: ... }`
- **Simpler handlers**: `if auth.OauthAppRef != nil` instead of switching on oneof variant
- **Passes the 5-minute test**: a new engineer immediately understands the presence/absence pattern

## Impact

- Proto source: 1 file changed (spec.proto), 3 messages reduced to 1
- Generated stubs: 41 files changed across all 4 languages
- No breaking changes to existing data (proto was created in the same session)

## Related Work

- Created in the same session as [OAuthApp Proto Definitions](2026-04-11-084912-oauth-app-proto-definitions-and-mcp-server-auth.md)
- Architectural principle applied: Reject Anemic Models (Architect Mandate #5)

---

**Status**: Production Ready
**Timeline**: Immediate follow-up to T01 proto definitions
