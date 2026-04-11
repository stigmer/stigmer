# Fix OAuthApp Enum Constant and Go Formatting

**Date**: April 11, 2026

## Summary

Fixed a build-breaking typo in the Go SDK where the `ApiResourceKind` enum constant for OAuthApp was referenced as `ApiResourceKind_o_auth_app` instead of the correct `ApiResourceKind_oauth_app`. Also applied gofmt formatting fixes to the OAuthApp controller files and updated generated site assets.

## Problem Statement

`make check` was failing in the stigmer OSS repo with a compilation error in `sdk/go/internal/gen/oauthapp.go`:

```
undefined: apiresourcekind.ApiResourceKind_o_auth_app
```

### Pain Points

- The Go SDK `GetByReference` method for OAuthApp was completely broken and could not compile
- The enum constant name `o_auth_app` did not match the proto-generated constant `oauth_app`

## Solution

Changed the enum reference from `ApiResourceKind_o_auth_app` to `ApiResourceKind_oauth_app` to match the actual generated protobuf constant. Applied gofmt whitespace alignment across OAuthApp controller files.

## Implementation Details

- `sdk/go/internal/gen/oauthapp.go`: Fixed enum constant reference
- `backend/services/stigmer-server/pkg/domain/oauthapp/controller/*.go`: gofmt alignment
- `backend/services/stigmer-server/pkg/domain/mcpserver/oauth/discovery.go`: gofmt alignment
- `site/src/data/react-sdk-summary.json`: Updated generated hook/component counts

## Impact

- Go SDK builds cleanly again
- OAuthApp `GetByReference` is now functional

---

**Status**: ✅ Production Ready
