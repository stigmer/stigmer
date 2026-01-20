# Fix: `stigmer new` Module Dependency Resolution

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: CLI (`stigmer new` command), SDK (Go module dependencies), Proto Stubs (tracking in git)  
**Branch**: `fix/stigmer-new-command`

## Problem

The `stigmer new` command was failing during dependency installation when users tried to create new projects. Go was unable to resolve the `github.com/stigmer/stigmer/apis/stubs/go` module, resulting in errors:

```
unknown revision apis/stubs/go/v0.0.0
missing github.com/stigmer/stigmer/apis/stubs/go/go.mod at revision ...
```

This broke the getting-started experience for external users trying to use Stigmer.

## Root Cause

The generated protobuf stubs in `apis/stubs/` were in `.gitignore`, so they didn't exist in the GitHub repository. When external users ran `go get github.com/stigmer/stigmer/sdk/go@latest`, the dependency resolution failed because:

1. SDK's `go.mod` required `github.com/stigmer/stigmer/apis/stubs/go v0.0.0`
2. The SDK used a `replace` directive pointing to a relative path: `replace github.com/stigmer/stigmer/apis/stubs/go => ../../apis/stubs/go`
3. This replace directive only worked inside the Stigmer repository (local development)
4. External users had no local copy of the stubs, and the stubs didn't exist on GitHub
5. Go tried to fetch `v0.0.0` from GitHub but couldn't find the module

**Architectural Issue**: Generated code distribution for Go modules requires either:
- Publishing generated code to the repository (chosen solution)
- Using a separate published module for generated code
- Bundling generated code directly into the consuming module

## Solution

### 1. Track Generated Stubs in Git

**Changed**: `apis/.gitignore`
- Removed `stubs/` from gitignore (commented out with rationale)
- Added ~495 generated Go protobuf files to version control (`.pb.go`, `_grpc.pb.go`)
- Also includes Python, TypeScript, and Java stubs

**Why**: External SDK usage requires these files to be available in the repository. This is standard practice for Go projects with protobuf dependencies (similar to how grpc-go and other projects handle generated code).

**Commit**: `fc443b1640d1fbbb3d610e6a43f14d50a6737223`

### 2. Update SDK go.mod

**Changed**: `sdk/go/go.mod`  
**Before**:
```go
require (
    github.com/stigmer/stigmer/apis/stubs/go v0.0.0
    ...
)
```

**After**:
```go
require (
    github.com/stigmer/stigmer/apis/stubs/go v0.0.0-20260120004624-4578a34f018e
    ...
)
```

**Why**: The pseudo-version format (`v0.0.0-YYYYMMDDHHMMSS-commithash`) tells Go exactly where to find the module in the repository's git history. This allows Go to resolve the dependency from GitHub.

### 3. Update `stigmer new` Command

**Changed**: `client-apps/cli/cmd/stigmer/root/new.go`  
**Function**: `generateGoMod()`

**Implementation**: Generated `go.mod` now includes replace directives pointing to the specific commit that has tracked stubs:

```go
replace github.com/stigmer/stigmer/sdk/go => github.com/stigmer/stigmer/sdk/go v0.0.0-20260120005545-fc443b1640d1

replace github.com/stigmer/stigmer/apis/stubs/go => github.com/stigmer/stigmer/apis/stubs/go v0.0.0-20260120005545-fc443b1640d1
```

**Why**: Ensures new projects use a version that has the stubs available in the repository, providing a consistent and working experience for external users.

**Commit**: `a669587` (updated to use correct commit with tracked stubs)

## Testing

### Before Fix ❌
```bash
$ stigmer new my-project
✓ Creating project files...
ℹ Installing dependencies...
go: downloading github.com/stigmer/stigmer/apis/stubs/go v0.0.0
go: stigmer_project imports
    github.com/stigmer/stigmer/sdk/go/stigmer imports
    github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1:
    unknown revision apis/stubs/go/v0.0.0
⚠ Failed to run 'go mod tidy' - you may need to run it manually
```

### After Fix ✅
```bash
$ stigmer new my-project
✓ Creating project files...
ℹ Installing dependencies...
go: downloading github.com/stigmer/stigmer/sdk/go v0.0.0-20260120005545-fc443b1640d1
go: downloading github.com/stigmer/stigmer/apis/stubs/go v0.0.0-20260120005545-fc443b1640d1
✓ Dependencies installed

✓ Project created successfully!
```

Generated project builds successfully:
```bash
$ cd my-project && go build
# Success - binary created
```

## Impact

### User Impact
- ✅ **`stigmer new` command now works for external users**
- ✅ Dependencies install automatically without manual intervention
- ✅ Smooth getting-started experience restored
- ✅ No user-visible breaking changes (command works as originally intended)

### Developer Impact
- Generated stubs now tracked in git (~495 files across Go, Python, TypeScript, Java)
- Standard practice for Go projects with protobuf dependencies
- Enables external SDK distribution via Go modules

### Alternative Solutions Considered

1. **Separate stubs repository**: More complex, requires CI/CD setup to publish stubs
2. **Bundle stubs into SDK**: Code duplication, larger SDK module
3. **User-generated stubs**: Poor UX, requires users to run code generation
4. **Current solution (track generated code)**: Pragmatic, follows industry standards

## Files Changed

```
apis/.gitignore                              # Removed stubs/ from ignore
apis/stubs/go/                               # Added 495 generated files
sdk/go/go.mod                                # Updated stubs dependency version
client-apps/cli/cmd/stigmer/root/new.go     # Updated generateGoMod()
```

## Related Issues

- External users unable to use `stigmer new` command
- Go module dependency resolution for external SDK usage
- Generated code distribution strategy for Go modules

## Lessons Learned

### Go Module Distribution with Generated Code

When distributing a Go SDK that depends on generated code (protobuf, gRPC, etc.):

1. **Generated code must be in the repository** if using direct module dependencies
2. **Pseudo-versions** (`v0.0.0-YYYYMMDDHHMMSS-commit`) work for unversioned modules
3. **Replace directives with relative paths** only work for local development, not external users
4. **Alternative**: Publish separate modules with proper semantic versioning

### SDK Dependency Management

- SDK dependencies should be resolvable externally (not rely on local development setup)
- Test `go get @latest` from outside the repository to verify external usability
- Consider the user experience of downloading and using the SDK independently

## Next Steps

- [x] Fix verified and working
- [ ] Merge `fix/stigmer-new-command` branch to `main`
- [ ] Consider semantic versioning strategy for SDK and stubs modules
- [ ] Document SDK distribution architecture (if needed for contributors)

## Commits

- `fc443b1` - Main fix: track stubs, update SDK go.mod, update CLI
- `a669587` - Update to use correct commit with tracked stubs

## References

- Error report: `_cursor/error.md`
- Fix summary: `_cursor/fix-summary.md`
- Branch: `fix/stigmer-new-command`
