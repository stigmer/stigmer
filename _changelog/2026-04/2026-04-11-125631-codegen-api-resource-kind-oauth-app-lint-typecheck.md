# Fix ApiResourceKind codegen for OAuthApp and tighten `make lint`

**Date**: April 11, 2026

## Summary

SDK client code generation derived `ApiResourceKind` enum members from `pascalToSnake(protoResType)`, which turned `OAuthApp` into `o_auth_app` instead of the real protobuf value `oauth_app`. The generator now resolves the correct enum name from each service schema’s embedded `ApiResourceKind` definition. Regenerated OAuthApp clients (TypeScript, Python, Java), added tests, and wired `npm run typecheck -w @stigmer/sdk` into the root `lint` target so similar issues surface earlier in `make check`.

## Problem Statement

`make local` failed during the web console build because generated TypeScript referenced a non-existent `ApiResourceKind.o_auth_app`. The enum in `@stigmer/protos` exposes `oauth_app`. The mismatch came from naive PascalCase-to-snake conversion on the message type name `OAuthApp`, not from the canonical enum spelling in the schema.

### Pain Points

- Broken generated SDK code for OAuthApp `getByReference` / search `list` kind constants.
- `make check`’s `lint` step did not run TypeScript `tsc` on `@stigmer/sdk`, so the failure only appeared at Next.js build time.

## Solution

Introduce `resolveResourceKind` in `deriveResourceConfig`: for each schema, find the `ApiResourceKind` enum in `enumTypes` and pick the value whose name matches `schema.Resource` after removing underscores (e.g. `oauth_app` ↔ `oauthapp`). Fall back to `pascalToSnake(schema.Resource)` when the enum block is absent. Thread the result as `cfg.resourceKind` through Go, TypeScript, Python, and Java client generators instead of `pascalToSnake(cfg.protoResType)` for those call sites.

## Implementation Details

- **Files**: `tools/codegen/generator/sdk_client.go` (config + `resolveResourceKind`), `sdk_client_ts.go`, `sdk_client_python.go`, `sdk_client_java.go`; `main_test.go` (`TestResolveResourceKind`).
- **Regenerated**: `sdk/typescript/src/gen/oauthapp.ts`, `sdk/python/src/stigmer/_gen/_oauthapp.py`, `sdk/java/.../OAuthAppClient.java`.
- **Repo**: Root `Makefile` `lint` target runs `npm run typecheck -w @stigmer/sdk` before web ESLint.

## Benefits

- Enum members for API resource kinds stay aligned with protobuf and JSON schemas without special-casing acronyms like OAuth in `pascalToSnake`.
- Local `make lint` / full `make check` catches TypeScript SDK type errors without building the web app.

## Impact

- **Developers**: Safer codegen for any resource whose PascalCase type name does not map 1:1 to `ApiResourceKind` snake names.
- **CI**: Earlier failure signal for SDK typing issues.

## Related Work

- OAuthApp / MCP OAuth connect work on branch `feat/mcp-oauth-connect`.

---

**Status**: ✅ Production Ready  
**Timeline**: Single session
