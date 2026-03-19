# Vendor Go Proto Stubs into SDK & Add Slug Field to All SDK Code Generators

**Date**: March 19, 2026

## Summary

Made the Go SDK fully self-contained by generating proto stubs directly inside the module, eliminating the external dependency on `apis/stubs/go` and the two-step release coordination it required. Also extended the `slug` field (previously TypeScript-only) to the Go, Python, and Java SDK code generators, ensuring consistent API surfaces for platform builders across all languages.

## Problem Statement

Two issues were addressed:

### Version coordination friction (Go SDK)

The Go SDK depended on a separately-versioned module (`github.com/stigmer/stigmer/apis/stubs/go` at `v0.0.37`). Every proto change required tagging the stubs module first, then updating the SDK's `go.mod` and tagging the SDK. The `replace` directive worked locally but is ignored by Go for downstream consumers -- they resolve stubs at whatever version is in `require`.

### Inconsistent slug support across SDKs

The `slug` field was only available in the TypeScript SDK input types. Go, Python, and Java SDK users had no way to set an explicit slug when creating resources, leading to inconsistent API ergonomics across languages.

### Pain Points

- Two-step release process for any proto change affecting the Go SDK
- External consumers could hit version mismatches between SDK and stubs
- Platform builders using Go, Python, or Java couldn't control resource slugs
- Inconsistent API surface across SDK languages

## Solution

### Proto stub vendoring

Generate a second copy of Go proto stubs directly inside the SDK module at `sdk/go/proto/...` using a dedicated buf config (`apis/buf.gen.sdk-go.yaml`). The SDK's generated client code imports from this internal copy. External consumers get everything they need from a single `go get github.com/stigmer/stigmer/sdk/go`.

### Slug field propagation

Extended the codegen to emit `slug` as an optional field in all SDK input types across Go, Python, and Java, mirroring the existing TypeScript implementation.

## Implementation Details

### New buf generation config

Created `apis/buf.gen.sdk-go.yaml` mirroring `buf.gen.go.yaml` with two key differences:
- `go_package_prefix`: `github.com/stigmer/stigmer/sdk/go/proto` (not `apis/stubs/go`)
- `out`: `../sdk/go/proto` (outputs into SDK module)

### SDK Makefile changes

Added `codegen-stubs` target to `sdk/go/Makefile` that wipes `proto/`, runs `buf generate`, and fixes the directory structure. Wired as the first prerequisite of `codegen`, so `make protos` automatically generates SDK stubs before client code.

### Import path migration

Updated all import references from `github.com/stigmer/stigmer/apis/stubs/go` to `github.com/stigmer/stigmer/sdk/go/proto` in:
- `tools/codegen/generator/sdk_client.go` (7 locations)
- `tools/codegen/generator/main.go` (1 location)
- `tools/codegen/generator/main_test.go` (test expectations)
- `sdk/go/github.go`, `sdk/go/search.go`, `sdk/go/examples/basic_crud.go` (hand-written files)

### Go module cleanup

Removed `apis/stubs/go` from `sdk/go/go.mod` require and replace directives. Promoted `buf.build/gen/go/bufbuild/protovalidate/...` to a direct dependency. `go mod tidy` confirms zero external stubs dependency.

### Slug field in codegen

- **Go** (`sdk_client.go`): Added `Slug string` to input structs and `Slug: i.Slug` to `toProto()` metadata
- **Python** (`sdk_client_python.go`): Added `slug: str | None = None` to dataclasses and conditional `metadata.slug = self.slug`
- **Java** (`sdk_client_java.go`): Added `slug` to class fields, constructor, builder, and conditional `metaBuilder.setSlug(this.slug)` in `toProto()`

## Benefits

- **Single-version releases**: Tag `sdk/go` once and external consumers get everything
- **No version coordination**: Proto changes flow into the SDK in one `make protos` pass
- **Consistent API surface**: All four SDKs (TypeScript, Go, Python, Java) now support explicit slug control
- **Self-contained SDK**: `go get github.com/stigmer/stigmer/sdk/go` is all an external consumer needs

## Impact

- **External SDK consumers**: Simpler dependency -- no transitive dependency on `apis/stubs/go`
- **Platform builders**: Can now set explicit slugs in Go, Python, and Java (previously TypeScript-only)
- **Internal monorepo**: `apis/stubs/go` unchanged -- backend, CLI, and internal tools continue using it
- **Proto type duplication**: ~170 generated Go files exist in both `apis/stubs/go/` and `sdk/go/proto/` -- acceptable cost for generated code serving distinct audiences

## Related Work

- Preceded by [fix-personal-resource-slug-uniqueness](_changelog/2026-03/2026-03-19-203225-fix-personal-resource-slug-uniqueness.md) which added slug support to TypeScript SDK

---

**Status**: ✅ Production Ready
