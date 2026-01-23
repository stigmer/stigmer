# Fix: Stigmer New SDK Version Resolution - Two-Mode Strategy

**Date**: 2026-01-23 03:52:56  
**Type**: Fix (CLI)  
**Scope**: `client-apps/cli`, `sdk/go`  
**Impact**: Development workflow and production releases

## Problem

The `stigmer new` command was generating projects with hardcoded SDK version references that didn't exist on GitHub, causing `go mod tidy` failures:

```
Error: failed to update dependencies:
go: github.com/stigmer/stigmer/sdk/go@v0.0.0-20260120203025-cfa15f93ba61: 
    invalid version: unknown revision cfa15f93ba61
```

**Root cause**: The CLI template hardcoded a specific commit hash that either:
1. Hadn't been pushed to GitHub yet
2. Was from a local branch not available remotely

This created a catch-22 for development:
- Developers make SDK changes locally
- Build CLI with `make release-local`
- Create new project with `stigmer new`
- Project can't resolve SDK dependencies (references non-existent remote commit)

## Solution: Two-Mode Version Strategy

Implemented intelligent SDK version resolution that adapts based on whether the CLI is a development build or production release.

### Mode 1: Development (buildVersion = "dev")

**Behavior**: Automatically detects and uses local Stigmer repository

**Detection logic**:
```go
// Searches common locations from home directory:
~/scm/github.com/stigmer/stigmer
~/code/stigmer/stigmer
~/projects/stigmer/stigmer
~/workspace/stigmer/stigmer
~/dev/stigmer/stigmer
~/stigmer/stigmer
~/go/src/github.com/stigmer/stigmer
```

**Generated go.mod** (when local repo found):
```go
module my-project

go 1.24

require (
	github.com/stigmer/stigmer/sdk/go v0.0.0-00010101000000-000000000000
)

// Development mode: Using local stigmer repository
// This ensures you're using the latest local changes
replace github.com/stigmer/stigmer/sdk/go => /Users/suresh/scm/github.com/stigmer/stigmer/sdk/go

replace github.com/stigmer/stigmer/apis/stubs/go => /Users/suresh/scm/github.com/stigmer/stigmer/apis/stubs/go
```

**Benefits**:
- ✅ Uses developer's local SDK changes immediately
- ✅ No need to push commits to GitHub
- ✅ No version mismatches
- ✅ Fast iteration (edit SDK → rebuild CLI → create project → works)

**Developer workflow**:
1. Edit SDK code in `~/scm/github.com/stigmer/stigmer/sdk/go`
2. Run `make release-local` to build CLI
3. Create project: `stigmer new my-project`
4. Project automatically uses local SDK via replace directives

### Mode 2: Production (buildVersion = "v0.1.0", "v0.2.0", etc.)

**Behavior**: Uses version tags synchronized with CLI version

**Generated go.mod**:
```go
module my-project

go 1.24

require (
	github.com/stigmer/stigmer/sdk/go v0.1.0
)
```

**Version synchronization**:
- CLI v0.1.0 → Generates projects using SDK v0.1.0
- CLI v0.2.0 → Generates projects using SDK v0.2.0

**Release process**:
```bash
# 1. Tag repository
git tag v0.1.0
git push origin v0.1.0

# 2. Build CLI with version injection
go build -ldflags "-X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=v0.1.0"

# 3. CLI automatically references SDK v0.1.0 in generated projects
```

**Benefits**:
- ✅ No manual version coordination needed
- ✅ CLI version determines SDK version automatically
- ✅ Users get stable, published SDK versions
- ✅ Version consistency across CLI and SDK

## Implementation

### New File: `client-apps/cli/embedded/sdk_version.go`

Created smart SDK version resolution:

```go
// GetSDKVersionForTemplate returns version based on build type
func GetSDKVersionForTemplate() string {
	version := GetBuildVersion()
	
	// Development mode
	if version == "dev" || version == "development" {
		return "latest"
	}
	
	// Production mode
	return version  // e.g., "v0.1.0"
}

// findStigmerRepo searches common locations for local repo
func findStigmerRepo() string {
	homeDir, _ := os.UserHomeDir()
	possiblePaths := []string{
		filepath.Join(homeDir, "scm/github.com/stigmer/stigmer"),
		filepath.Join(homeDir, "code/stigmer/stigmer"),
		// ... more locations
	}
	// Validates by checking for sdk/go and apis/stubs/go subdirectories
}

// GenerateGoModContent generates appropriate go.mod based on mode
func GenerateGoModContent(projectName string) string {
	sdkVersion := GetSDKVersionForTemplate()
	
	if sdkVersion == "latest" {
		stigmerRepo := findStigmerRepo()
		if stigmerRepo != "" {
			// Use local replace directives
			return goModWithLocalPaths(projectName, stigmerRepo)
		}
		// Fallback to @latest from GitHub
		return goModWithLatest(projectName)
	}
	
	// Production: use version tag
	return goModWithVersion(projectName, sdkVersion)
}
```

### Updated: `client-apps/cli/cmd/stigmer/root/new.go`

Integrated smart version resolution:

```go
import (
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	// ...
)

files := []struct {
	name     string
	filename string
	content  string
}{
	{"Stigmer.yaml", "Stigmer.yaml", generateStigmerYAML(projectName)},
	{"main.go (AI-powered PR reviewer)", "main.go", templates.AgentAndWorkflow()},
	{"go.mod", "go.mod", embedded.GenerateGoModContent(projectName)},  // ← Smart version resolution
	{".gitignore", ".gitignore", generateGitignore()},
	{"README.md", "README.md", generateReadme(projectName)},
}
```

Removed old `generateGoMod()` function with hardcoded commit hash.

## Testing

### Development Mode Test

```bash
# Build dev CLI
cd ~/scm/github.com/stigmer/stigmer
make release-local

# Create project
cd ~
mkdir test-local-sdk
cd test-local-sdk
stigmer new
```

**Result**:
```
✓ Creating go.mod
ℹ Installing dependencies...
✓ Dependencies installed

✓ Project created successfully!
```

**Generated go.mod**:
```go
module test-local-sdk

go 1.24

require github.com/stigmer/stigmer/sdk/go v0.0.0-00010101000000-000000000000

// Development mode: Using local stigmer repository
replace github.com/stigmer/stigmer/sdk/go => /Users/suresh/scm/github.com/stigmer/stigmer/sdk/go
replace github.com/stigmer/stigmer/apis/stubs/go => /Users/suresh/scm/github.com/stigmer/stigmer/apis/stubs/go
```

✅ **Success**: Local SDK is used via replace directives, `go mod tidy` succeeds

### Production Mode (Simulated)

For production releases, the build process would inject version:

```bash
go build -ldflags "-X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=v0.1.0" \
    -o stigmer client-apps/cli
```

Generated projects would reference:
```go
require github.com/stigmer/stigmer/sdk/go v0.1.0
```

## Known Issues & Deferred Work

### Template API Mismatch

The `main.go` template generated by `sdk/go/templates/templates.go` uses APIs that don't yet exist in the current SDK:

```go
// Template uses (doesn't exist yet):
workflow.AgentModel("claude-3-5-sonnet")
workflow.AgentTimeout(60)
pipeline.SetVars("name", val1, val2)

// SDK currently has:
workflow.Set("name", workflow.SetVars(map[string]interface{}{"key": val}))
```

**Impact**: Generated projects compile with local SDK but produce compilation errors when executed.

**Deferred**: User explicitly requested deferring this fix:
> "The template is not working. I got that point. I'll fix that once. I'll fix that later. Right now I'm in testing phase. Once all the SDK features are tested, then we'll see how to generate templates."

**Future work**: After SDK features are fully tested and stabilized, update templates to match current SDK APIs or implement missing SDK convenience methods.

## Benefits

### For Developers

**Before**:
- ❌ Hard to test SDK changes locally
- ❌ Needed to push commits to GitHub to test
- ❌ Version mismatches and errors
- ❌ Manual coordination of versions

**After**:
- ✅ Automatic local SDK detection
- ✅ Instant feedback loop (edit SDK → test immediately)
- ✅ No GitHub pushes needed for testing
- ✅ Zero version coordination required

### For Production

**Before**:
- ❌ Manual version management
- ❌ Risk of SDK/CLI version mismatches
- ❌ Unclear which SDK version to use

**After**:
- ✅ CLI version automatically determines SDK version
- ✅ One tag controls both CLI and SDK versions
- ✅ Clear version synchronization (CLI v0.1.0 → SDK v0.1.0)

## Files Changed

```
client-apps/cli/embedded/sdk_version.go (NEW)
  - GetSDKVersionForTemplate()
  - findStigmerRepo()
  - GenerateGoModContent()

client-apps/cli/cmd/stigmer/root/new.go (MODIFIED)
  - Import embedded package
  - Use embedded.GenerateGoModContent()
  - Remove old generateGoMod() function
```

## Design Decisions

### Why Search Multiple Paths?

Different developers have different workspace layouts. Searching common patterns increases the chance of finding the local repo without requiring configuration.

### Why Home-Relative Paths?

Projects can be created anywhere (`/tmp`, `~/Desktop`, `~/projects`). Using home-relative paths for the search ensures we find the Stigmer repo regardless of where the user runs `stigmer new`.

### Why Version Synchronization?

Keeping CLI and SDK versions synchronized simplifies:
- Version management (one tag, not two)
- User communication ("install CLI v0.1.0" implicitly means SDK v0.1.0)
- Release process (tag once, build CLI, done)

### Why Local Replace Directives vs @latest?

**Option A**: Use `@latest` (pulls from GitHub main)
- ❌ Requires pushing every SDK change to test
- ❌ May pull changes from other developers
- ❌ Slower (network dependency)

**Option B**: Use local replace directives ✅
- ✅ Uses developer's exact local changes
- ✅ No network required
- ✅ Instant feedback
- ✅ Isolated from other developers' changes

## Future Enhancements

### 1. Environment Variable Override

Allow developers to specify custom Stigmer repo location:

```bash
export STIGMER_REPO_PATH="/custom/path/to/stigmer/stigmer"
stigmer new my-project
```

### 2. Configuration File

Support `.stigmerrc` or `stigmer.toml` for persistent configuration:

```toml
[development]
repo_path = "/custom/path/to/stigmer/stigmer"
```

### 3. Verbose Mode

Add `--verbose` flag to show version resolution logic:

```bash
stigmer new my-project --verbose
# Output:
# ℹ Build version: dev
# ℹ Searching for local Stigmer repo...
# ✓ Found: /Users/suresh/scm/github.com/stigmer/stigmer
# ✓ Using local SDK via replace directives
```

## Related Issues

None (this was discovered during initial testing of `stigmer new` command)

## Testing Checklist

- [x] Development mode: Local repo detected
- [x] Development mode: Replace directives generated
- [x] Development mode: `go mod tidy` succeeds
- [x] Development mode: Dependencies resolve
- [ ] Production mode: Version tag resolution (requires release build)
- [ ] Production mode: Public SDK version used (requires actual release)
- [x] Edge case: No local repo found (falls back to @latest)
- [ ] Template API compatibility (deferred - user requested)

## Conclusion

This fix establishes a robust two-mode version strategy that:

1. **Empowers developers** with instant local SDK testing
2. **Simplifies production releases** with automatic version synchronization
3. **Eliminates version mismatches** through intelligent detection
4. **Reduces coordination overhead** through automation

The development workflow is now seamless, and the production release process is straightforward and reliable.

**Status**: ✅ Core infrastructure complete  
**Deferred**: Template API compatibility (user explicitly requested deferring until SDK testing complete)
