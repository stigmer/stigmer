# Fix Empty ApiResourceReference Guard Across All SDK Code Generators

**Date**: May 2, 2026

## Summary

Fixed a bug where optional `ApiResourceReference` fields (e.g., `oauth_app_ref` on `McpServerAuth`) were unconditionally serialized during `toProto()` conversion, even when empty. This sent `ApiResourceReference{slug: "", kind: oauth_app}` on the wire, causing server-side validation failures. The fix was applied to all five code generators (Go, TypeScript, Python, Java, MCP) and regenerated.

## Problem Statement

When a YAML resource like `mcp-server-atlassian.yaml` has an `auth` block without `oauth_app_ref`, the CLI's apply path performs a round-trip: YAML -> proto -> `McpServerInput` -> `toProto()` -> gRPC. The `fromProto` step creates a zero-valued `ResourceRef{}` for the absent field, and `toProto()` then unconditionally converts it into a proto `ApiResourceReference` with an empty slug. The server rejects this with:

> Error: Input validation failed: spec.auth.oauth_app_ref.slug -- value is required

### Pain Points

- `stigmer apply` on seedpacks with MCP servers lacking OAuth (Atlassian, Linear, Monday, etc.) would fail
- The bug existed in all four SDK generators, not just Go — any SDK client hitting the same round-trip path would produce the same error
- The Go SDK codegen already had the correct guard for top-level spec `ApiResourceReference` fields but missed nested message types

## Solution

Added empty-ref guards to all five code generators so that `ApiResourceReference` fields are only serialized when `org` or `slug` is non-empty. Each language uses its idiomatic check:

- **Go**: `if i.OauthAppRef.Org != "" || i.OauthAppRef.Slug != ""`
- **TypeScript**: `if (input.oauthAppRef?.slug || input.oauthAppRef?.org)`
- **Python**: `if self.oauth_app_ref is not None and (self.oauth_app_ref.org or self.oauth_app_ref.slug)`
- **Java**: `if (this.oauthAppRef != null && this.oauthAppRef.hasIdentifier())` (new `hasIdentifier()` method on `ResourceRef`)
- **MCP**: Optional singular refs now use pointer types, getting automatic nil-guard from existing codegen

## Implementation Details

### Generator changes (5 files)

| File | Change |
|------|--------|
| `tools/codegen/generator/sdk_client.go` | Added `Org/Slug` guard in nested `toProto()` emission; expanded `needsImperative` to cover all `ApiResourceReference` fields |
| `tools/codegen/generator/sdk_client_ts.go` | Changed both top-level and nested checks from truthy to `?.slug \|\| ?.org` |
| `tools/codegen/generator/sdk_client_python.go` | Added dedicated `ApiResourceReference` case with `org or slug` check |
| `tools/codegen/generator/sdk_client_java.go` | Changed both levels to `hasIdentifier()`; added method to `ResourceRef` generation |
| `tools/codegen/generator/mcp.go` | Optional singular refs now use `*RefInput` pointer type |

### Regenerated output (18 files across 4 SDKs + MCP)

All generated files were regenerated via `make codegen` targets — no manual edits to generated code.

## Benefits

- MCP servers without OAuth (majority of seedpack) can now be applied via `stigmer apply`
- Consistent empty-ref handling across all four SDK languages
- The guard is now baked into the generators, so future resources with optional `ApiResourceReference` fields get the guard automatically

## Impact

- **CLI**: Fixes seedpack apply for all MCP servers without `oauth_app_ref`
- **Go SDK**: All resources with nested optional `ApiResourceReference` fields are now safe
- **TypeScript/Python/Java SDKs**: Same fix applied preemptively, preventing the same class of bug when those SDKs are used for apply operations
- **MCP server tools**: Pointer-based nil guard for optional refs

## Related Work

- `31042cf10` — companion fix wiring the apply handler registry in `apply_declarative.go` (separate nil-pointer panic)

---

**Status**: Production Ready
