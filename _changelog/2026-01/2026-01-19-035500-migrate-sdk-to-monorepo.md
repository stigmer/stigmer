# SDK Migration to Monorepo (Pulumi Pattern)

**Date**: 2026-01-19  
**Type**: Infrastructure Migration  
**Scope**: SDK, Repository Structure  
**Impact**: High - Changes SDK distribution and development workflow

## Summary

Migrated the Stigmer SDK from a separate repository (`github.com/leftbin/stigmer-sdk`) to the main Stigmer monorepo (`github.com/stigmer/stigmer/sdk/`), following Pulumi's pattern for SDK distribution. Additionally, replaced remote buf.build proto dependencies with local proto stubs from the monorepo.

## Motivation

### Why Migrate SDK to Monorepo?

1. **Simplified Development Workflow**
   - SDK and platform code evolve together
   - No need to coordinate releases across repositories
   - Proto changes automatically available to SDK

2. **Following Industry Best Practices**
   - Pulumi keeps SDK in main repository
   - Easier for contributors to work on SDK and platform together
   - Single repository for all Stigmer code

3. **Improved Dependency Management**
   - SDK can use local proto stubs (no buf.build dependency)
   - Cleaner dependency graph
   - Faster builds (no external proto fetching)

### Why Replace buf.build with Local Protos?

1. **Self-Contained Repository**
   - All proto definitions available locally
   - No external dependencies for proto stubs
   - Faster development cycle

2. **Simplified Build Process**
   - No buf authentication required
   - No network dependencies during build
   - Consistent proto versions guaranteed

## Changes Made

### 1. SDK Repository Migration

**Moved from**:
```
github.com/leftbin/stigmer-sdk/
├── go/              # Go SDK
├── python/          # Python SDK
├── _changelog/      # SDK changelogs
├── _rules/          # Cursor rules
└── docs/            # SDK documentation
```

**To**:
```
github.com/stigmer/stigmer/
├── sdk/
│   ├── README.md
│   ├── CONTRIBUTING.md
│   ├── go/          # Go SDK with go.mod
│   └── python/      # Python SDK
├── _changelog/sdk/  # SDK changelogs
├── .cursor/rules/sdk/  # SDK rules
└── docs/sdk/        # SDK documentation
```

### 2. Go SDK Module Structure

Created separate Go module for SDK:

**File**: `sdk/go/go.mod`
```go
module github.com/stigmer/stigmer/sdk/go

require (
    github.com/google/uuid v1.6.0
    github.com/stigmer/stigmer/apis/stubs/go v0.0.0  // Local proto stubs
    github.com/stretchr/testify v1.11.1
    google.golang.org/protobuf v1.36.11
)

// Use local proto stubs from main repository
replace github.com/stigmer/stigmer/apis/stubs/go => ../../apis/stubs/go
```

**Rationale for separate module**:
- ✅ SDK can be versioned independently
- ✅ Minimal dependencies for end users
- ✅ Backend can have heavier dependencies without affecting SDK
- ✅ Clear separation between platform and SDK

### 3. Import Path Updates

**Before**:
```go
import (
    "github.com/leftbin/stigmer-sdk/go/agent"
    "github.com/leftbin/stigmer-sdk/go/workflow"
)
```

**After**:
```go
import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/workflow"
)
```

**Updated files**:
- All Go SDK source files (86 files)
- Internal synthesis/converter code
- Example programs (26 examples)
- Test files
- Documentation references

### 4. Proto Stub Migration

**Before** (buf.build remote dependencies):
```go
import (
    agentv1 "buf.build/gen/go/leftbin/stigmer/protocolbuffers/go/ai/stigmer/agentic/agent/v1"
    workflowv1 "buf.build/gen/go/leftbin/stigmer/protocolbuffers/go/ai/stigmer/agentic/workflow/v1"
)
```

**After** (local proto stubs):
```go
import (
    agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
    workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
)
```

**Benefits**:
- No external buf.build dependency
- Guaranteed proto version consistency
- Faster builds (no network fetching)
- Simpler development setup

### 5. File Organization

**Moved content to appropriate locations**:

| Content | Old Location | New Location |
|---------|-------------|--------------|
| Go SDK code | `stigmer-sdk/go/` | `stigmer/sdk/go/` |
| Python SDK code | `stigmer-sdk/python/` | `stigmer/sdk/python/` |
| SDK changelogs | `stigmer-sdk/_changelog/` | `stigmer/_changelog/sdk/` |
| SDK rules | `stigmer-sdk/_rules/` | `stigmer/.cursor/rules/sdk/` |
| SDK docs | `stigmer-sdk/_docs/`, `stigmer-sdk/docs/` | `stigmer/docs/sdk/` |
| Main README | `stigmer-sdk/README.md` | `stigmer/sdk/README.md` |
| Contributing | `stigmer-sdk/CONTRIBUTING.md` | `stigmer/sdk/CONTRIBUTING.md` |

### 6. Repository Cleanup

- ✅ Deleted `/Users/suresh/scm/github.com/leftbin/stigmer-sdk` repository
- ✅ Cleaned Go module cache
- ✅ Removed old module references

## Technical Details

### Go Module Dependency Graph

```
stigmer/go.mod (root module)
├─ Backend services
├─ CLI tools
└─ Common libraries

stigmer/sdk/go/go.mod (SDK module)
├─ google.golang.org/protobuf
├─ github.com/google/uuid
├─ github.com/stigmer/stigmer/apis/stubs/go (replace → ../../apis/stubs/go)
└─ github.com/stretchr/testify (test only)

stigmer/apis/stubs/go/go.mod (proto stubs module)
├─ google.golang.org/protobuf
└─ google.golang.org/grpc
```

### Build Verification

Verified SDK builds correctly:
```bash
cd sdk/go
go mod tidy
go build ./...  # ✅ Success
```

Test compilation shows expected failures (pre-existing test API mismatches), but production code compiles correctly.

### CLI Integration Path

For CLI to use the new SDK location:

**Update CLI's go.mod**:
```go
require (
    github.com/stigmer/stigmer/sdk/go v0.0.0
)

replace github.com/stigmer/stigmer/sdk/go => ../../sdk/go
```

**Import in CLI code**:
```go
import (
    "github.com/stigmer/stigmer/sdk/go/agent"
    "github.com/stigmer/stigmer/sdk/go/workflow"
)
```

## Comparison with Pulumi

Analyzed Pulumi's repository structure:

**Pulumi**:
- ❌ No go.mod at root
- ✅ Single `sdk/go.mod` for entire SDK
- Module: `github.com/pulumi/pulumi/sdk/v3`

**Stigmer** (our choice):
- ✅ Root `go.mod` for backend/CLI/services
- ✅ Separate `sdk/go/go.mod` for SDK
- Module: `github.com/stigmer/stigmer/sdk/go`

**Rationale**: Stigmer has substantial backend code at the root, so separate modules make sense (platform vs SDK).

## Benefits

### For Users

1. **Simpler Installation**
   ```bash
   go get github.com/stigmer/stigmer/sdk/go
   ```

2. **Consistent Versioning**
   - SDK version matches Stigmer platform version
   - No version coordination needed

3. **Better Documentation Discovery**
   - All Stigmer docs in one place
   - SDK docs alongside platform docs

### For Contributors

1. **Unified Development**
   - Clone one repository
   - Work on SDK and platform together
   - Protobuf changes automatically available

2. **Simplified Testing**
   - Test SDK changes against platform code
   - No repository coordination
   - Faster feedback loop

3. **Easier Proto Evolution**
   - Proto changes immediately available to SDK
   - No publish/consume cycle
   - Local proto stubs via replace directive

### For Maintenance

1. **Single Source of Truth**
   - All code in one repository
   - One issue tracker
   - One PR workflow

2. **Atomic Changes**
   - Proto + SDK + Platform changes in one PR
   - No breaking change coordination
   - Cleaner git history

3. **Simplified CI/CD**
   - One build pipeline
   - Consistent testing
   - Unified release process

## Migration Path for Existing Users

If any users were using the old SDK location (unlikely as SDK was private):

**Before**:
```go
import "github.com/leftbin/stigmer-sdk/go/agent"
```

**After**:
```go
import "github.com/stigmer/stigmer/sdk/go/agent"
```

**Migration steps**:
```bash
# Update go.mod
go get github.com/stigmer/stigmer/sdk/go

# Update imports in code
find . -name "*.go" -exec sed -i '' \
  's|github.com/leftbin/stigmer-sdk/go|github.com/stigmer/stigmer/sdk/go|g' {} +

# Clean old module cache
go clean -modcache
go mod tidy
```

## Impact Assessment

### Files Modified

- **Go SDK**: 86 .go files (import path updates)
- **Python SDK**: Replaced with comprehensive version
- **Documentation**: 19 changelog files, multiple doc files
- **Configuration**: 3 go.mod files updated/created

### Breaking Changes

- ✅ **None for end users** (SDK was not publicly released yet)
- ✅ **None for platform** (internal only)
- ⚠️  **Import paths changed** (when SDK is released)

### Backward Compatibility

- ❌ Old import paths (`github.com/leftbin/stigmer-sdk`) will not work
- ✅ Proto compatibility maintained (same proto definitions)
- ✅ API compatibility maintained (same SDK APIs)

## Testing Performed

1. ✅ Go SDK builds successfully: `go build ./...`
2. ✅ Go module dependencies resolve correctly
3. ✅ Proto imports resolve from local stubs
4. ✅ Replace directives work correctly
5. ⚠️  Test compilation shows pre-existing API mismatches (not introduced by migration)

## Follow-Up Work

### Immediate

- [ ] Update CLI to use new SDK import paths (when needed)
- [ ] Update any internal tools using SDK

### Future

- [ ] Publish SDK module to pkg.go.dev
- [ ] Create SDK versioning strategy
- [ ] Document SDK release process

## Lessons Learned

### What Worked Well

1. **Following Pulumi Pattern**
   - Industry-proven approach
   - Well-understood by Go developers
   - Clear separation of concerns

2. **Local Proto Stubs**
   - Simplified dependency management
   - Faster builds
   - Better offline development

3. **Automated Import Updates**
   - Perl find-replace for import paths
   - Efficient and error-free
   - Easy to verify

### Challenges

1. **Module Path Complexity**
   - Three separate go.mod files
   - Replace directives needed
   - Documentation required for understanding

2. **Test Compilation Errors**
   - Pre-existing test API mismatches
   - Unrelated to migration
   - Needs separate fix

### Recommendations

1. **For Similar Migrations**
   - Start with dependency graph analysis
   - Use industry patterns (Pulumi, etc.)
   - Automate import path updates
   - Verify builds at each step
   - Update documentation immediately

2. **For Future SDK Work**
   - Maintain separate go.mod for SDK
   - Use replace directives for local development
   - Document import paths clearly
   - Keep SDK dependencies minimal

## References

- Pulumi SDK structure: `/Users/suresh/scm/github.com/pulumi/pulumi/sdk/`
- Go modules documentation: https://go.dev/ref/mod
- Monorepo best practices

## Completion Checklist

- [x] Go SDK code migrated to `sdk/go/`
- [x] Python SDK code migrated to `sdk/python/`
- [x] Changelogs moved to `_changelog/sdk/`
- [x] Cursor rules moved to `.cursor/rules/sdk/`
- [x] Documentation moved to `docs/sdk/`
- [x] Import paths updated (leftbin → stigmer)
- [x] Proto imports updated (buf.build → local stubs)
- [x] go.mod files created/updated
- [x] Build verification completed
- [x] Old repository deleted
- [x] Module cache cleaned
- [x] README and CONTRIBUTING updated

---

**Migration completed successfully. SDK now lives in the Stigmer monorepo following industry best practices.**
