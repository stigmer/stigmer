# Go SDK: Publishable via `go get`

**Date**: March 16, 2026

## Summary

Made the Go SDK externally consumable by removing the monorepo-local `replace` directive from `sdk/go/go.mod` and adding `sdk/go/vX.Y.Z` tags to the release workflow. The SDK now resolves all dependencies via the Go module proxy, enabling standard `go get` installation.

## Problem Statement

The Go SDK was structurally un-consumable from outside the monorepo despite being feature-complete with Stripe-style clients for all 17 API resources.

### Pain Points

- `sdk/go/go.mod` contained `replace github.com/stigmer/stigmer/apis/stubs/go => ../../apis/stubs/go`, which only works locally — the Go module proxy ignores `replace` directives with relative paths
- The stubs dependency used a zero pseudo-version (`v0.0.0-00010101000000-000000000000`) that cannot be resolved externally
- No `sdk/go/vX.Y.Z` Git tags existed, so the SDK had no versioned releases for consumers to pin
- The `make release` target tagged `apis/stubs/go/` and `mcp-server/` but not `sdk/go/`

## Solution

Two changes to make the SDK publishable:

1. **Clean `go.mod`**: Removed the `replace` directive and set the stubs dependency to the real tagged version (`v0.0.35`). Local development continues to work via the existing `go.work` workspace file at the repo root.

2. **Release automation**: Extended `make release` to update the stubs version in `sdk/go/go.mod`, commit the change, create a `sdk/go/vX.Y.Z` tag, and push it alongside the existing tags.

## Implementation Details

### sdk/go/go.mod

Removed the `replace` directive and zero pseudo-version. The module now depends on the real tagged stubs module:

```go
require (
    github.com/stigmer/stigmer/apis/stubs/go v0.0.35
    google.golang.org/grpc v1.79.2
    google.golang.org/protobuf v1.36.11
)
```

Local development is unaffected because `go.work` at the repo root already includes both `./sdk/go` and `./apis/stubs/go` — the Go toolchain resolves dependencies from the local filesystem when a workspace is active.

### Makefile release target

Added three operations to the existing `make release` flow:

1. **Pre-tag version update**: `go mod edit -require` updates `sdk/go/go.mod` to reference the new stubs version, followed by `git add` and `git commit`
2. **SDK tag creation**: `git tag -a "sdk/go/$NEW_TAG"` alongside the existing `apis/stubs/go/`, root, and `mcp-server/` tags
3. **Tag push**: Added `sdk/go/$NEW_TAG` to the `git push origin` command

### Verification

Confirmed the SDK builds and vets without `go.work` (`GOWORK=off go build ./...`), simulating the external consumer experience where dependencies resolve entirely via the Go module proxy.

## Benefits

- **Standard `go get` installation**: `go get github.com/stigmer/stigmer/sdk/go@v0.0.36`
- **Zero manual steps**: Release automation handles version bumping, committing, tagging, and pushing
- **No local dev friction**: `go.work` transparently handles monorepo resolution
- **Consistent distribution model**: Go SDK now follows the same tag-based release pattern as TypeScript (npm), Java (Maven), and Python (PyPI)

## Impact

- **SDK consumers**: Can now install the Go SDK via standard Go tooling without cloning the monorepo
- **Release process**: `make release bump=patch` now produces all four module tags in a single atomic operation
- **Go module proxy**: Auto-caches the SDK on first `go get`, providing global CDN-backed distribution with checksum verification

## Related Work

- [Go SDK Stripe-Style Restructure](2026-03-16-112653-go-sdk-stripe-style-restructure.md) — initial SDK restructure
- [Go SDK All-Resource Codegen](2026-03-16-115418-go-sdk-all-resource-codegen.md) — extended codegen to 17 resources

---

**Status**: Production Ready
**Timeline**: 1 session (~15 minutes)
