# Fix codegen cross-package enum resolution and web static export

**Date**: April 6, 2026

## Summary

Fixed two `make check` failures: the Go SDK codegen was emitting incorrect type references for cross-package proto enums (e.g. `invitationv1.IamRole` instead of `iamv1.IamRole`), and the new `/invite/[token]` route broke the Next.js static export build. Both issues are resolved and the full CI gate passes cleanly.

## Problem Statement

After introducing the Invitation resource (which references `ai.stigmer.iam.v1.IamRole` from its spec), `make check` failed at two stages:

### Pain Points

- **`go mod tidy` for `tools/`**: The `tools` module imported `apis/stubs/go` packages that were ahead of the last published tag, causing the Go module proxy to reject the import during `go mod tidy`.
- **SDK Go lint failure**: The generated `sdk/go/internal/gen/invitation.go` referenced `invitationv1.IamRole`, but `IamRole` lives in `ai.stigmer.iam.v1`, not `ai.stigmer.iam.invitation.v1`.
- **Web build failure**: The new dynamic `/invite/[token]` page was a `"use client"` component and could not export `generateStaticParams()`, which Next.js 16 requires for `output: "export"`.

## Solution

Three targeted fixes, all verified by a green `make check`:

1. **`tools/go.mod` — local replace directive**: Since `tools/` is a monorepo-only generator (never installed externally), a `replace` pointing at `../apis/stubs/go` lets `go mod tidy` resolve packages that are committed locally but not yet published.

2. **Codegen — cross-package enum resolution**: `protoTypeToPackageAlias` required `>= 6` parts to detect versioned packages, but `ai.stigmer.iam.v1.IamRole` has only 5. Relaxing to `>= 5` makes `iamv1` resolve correctly. New helpers (`goSDKEnumGoType`, `collectSDKEnumImports`, `walkTypeSpecEnumImports`) derive the correct Go type and import path for any enum referenced from a different proto package.

3. **Web static export**: Split `/invite/[token]/page.tsx` into a server `page.tsx` (exports `generateStaticParams`) and a client `InvitePageClient.tsx`. A placeholder param `{ token: "_" }` satisfies Next.js 16's requirement that static export routes produce at least one path.

## Implementation Details

### `tools/go.mod`
- Added `replace github.com/stigmer/stigmer/apis/stubs/go => ../apis/stubs/go` so generators always compile against the in-repo stubs.

### `tools/codegen/generator/main.go`
- `protoTypeToPackageAlias`: lowered minimum parts from 6 to 5 so shorter versioned packages like `ai.stigmer.iam.v1.IamRole` resolve to `iamv1`.

### `tools/codegen/generator/sdk_client.go`
- `goSDKEnumGoType`: resolves a fully-qualified proto enum type to its Go type (`iamv1.IamRole`).
- `walkTypeSpecEnumImports` / `collectSDKEnumImports`: walk spec fields to discover cross-package enum imports.
- `generateResourceClient`: emits additional import lines for discovered enum packages.
- `goTypeForTypeSpec`: delegates enum type rendering to `goSDKEnumGoType` instead of hard-coding the resource alias.

### `tools/codegen/generator/main_test.go`
- Added test case for `ai.stigmer.iam.v1.IamRole` → `iamv1`.

### `sdk/go/internal/gen/invitation.go` (regenerated)
- Now imports `iamv1` and uses `iamv1.IamRole` for the `Role` field.

### `client-apps/web/src/app/invite/[token]/`
- New `InvitePageClient.tsx`: client component extracted from `page.tsx`.
- `page.tsx`: server component with `generateStaticParams()` returning `[{ token: "_" }]`.

## Benefits

- **`make check` passes end-to-end**: tidy, lint, build, format, link-check, and all 1437+ tests green.
- **Generalised enum handling**: any future resource that references enums from a different proto package will be resolved correctly without manual codegen fixes.
- **No `replace` leakage**: the `replace` is scoped to `tools/`, which is never imported externally; `sdk/go` and `mcp-server` remain clean.

## Impact

- **Developers**: `make check` unblocked on `feat/identity-provider-flow`.
- **Codegen**: cross-package proto enum fields now generate correct Go types and imports automatically.
- **Web Console**: static export builds correctly with the new invitation route.

## Related Work

- [Invitation React components](_changelog/2026-04/2026-04-06-181319-invitation-react-components.md)
- Prior `mcp-server` replace removal: [MCP server single protobuf source](_changelog/2026-03/2026-03-21-115938-mcp-server-use-shared-apis-stubs.md)

---

**Status**: ✅ Production Ready
