# Implementation Notes

## Session 1: Basic Bazel Setup (2026-01-18)

### Files Created

1. **MODULE.bazel** - Bazel module configuration
   - Go dependencies from go.mod
   - Protobuf and proto rules
   - rules_go and Gazelle for BUILD file generation
   - rules_oci and rules_pkg for container builds
   - Alpine Linux base image for Go services
   - Go SDK version 1.24.6

2. **.bazelrc** - Bazel build configuration
   - Simplified compared to stigmer-cloud (no Java settings, no BuildBuddy remote cache)
   - Basic workspace defaults

3. **bazelw** - Bazel wrapper script
   - Auto-installs bazelisk if not present
   - Identical to stigmer-cloud version

4. **REPO.bazel** - Repository ignore patterns
   - Ignores `.venv`, `node_modules`, `.next`

5. **BUILD.bazel** (root) - Gazelle configuration
   - Prefix: `github.com/stigmer/stigmer`
   - Excludes: `apis/ai` (proto sources), `sdk` (Python)
   - Gazelle target for BUILD file generation

6. **.bazelignore** - Directories to exclude from Bazel
   - `backend/services/workflow-runner` - has cloud-specific dependencies
   - `backend/services/agent-runner` - has cloud-specific dependencies

### Gazelle BUILD File Generation

Ran `./bazelw run //:gazelle` which generated BUILD.bazel files for:

- `cmd/stigmer/` - CLI binary
- `backend/libs/go/**` - Go libraries
- `backend/services/stigmer-server/**` - Server packages
- `apis/stubs/go/**` - Generated proto Go stubs

### Proto Handling Strategy

**Decision**: Use `buf` for proto generation, not Bazel proto rules.

- Deleted BUILD.bazel files from `apis/ai/` (proto sources)
- Kept BUILD.bazel files in `apis/stubs/go/` (generated Go code)
- Gazelle configured to exclude `apis/ai` directory

**Rationale**: 
- Proto generation is already working via `buf` + Makefile
- Simpler to maintain one proto generation approach
- Bazel handles Go compilation of generated stubs

### Build Results

✅ **Successful Builds:**
```bash
./bazelw build //cmd/stigmer:stigmer
./bazel-bin/cmd/stigmer/stigmer_/stigmer --help  # Works!
```

❌ **Failed Builds:**
```bash
./bazelw build //...
```

**Errors Found:**

1. **backend/libs/go/sqlite/store_test.go** - Test compilation errors
   - `unknown field ApiResourceMetadata` - proto schema changed
   - `unknown field OrgId` - field renamed or moved
   - `unknown field Model` - field renamed or moved
   - Needs update to match current proto definitions

2. **backend/services/stigmer-server/pkg/controllers/agentinstance/create.go**
   - `undefined: steps.NewSetDefaultsStep`
   - Function was renamed to `NewBuildNewStateStep` in recent refactor
   - Needs code update

### Structure Differences from stigmer-cloud

**stigmer-cloud:**
- Java + Go multi-language build
- Java services with Spring Boot
- BuildBuddy remote cache
- More complex build configuration
- Extensive tools/bazel/macros for helpers

**stigmer OSS:**
- Go-only build (simpler)
- No remote caching
- Minimal build configuration
- No custom Bazel macros needed (yet)

### Next Steps

**To complete full Bazel integration:**

1. Fix compilation errors:
   - Update `store_test.go` proto field references
   - Fix `agentinstance/create.go` step reference
   
2. Re-enable ignored services:
   - Remove workflow-runner from .bazelignore
   - Remove agent-runner from .bazelignore
   - Fix cloud-specific dependencies or copy tools from stigmer-cloud

3. Documentation:
   - Add Bazel build instructions to README
   - Document `./bazelw` commands
   - Document relationship with Makefile

4. CI/CD Integration:
   - Update GitHub Actions to use Bazel
   - Consider BuildBuddy remote cache for CI

### Key Learnings

1. **Gazelle is powerful** - Automatically generated correct BUILD files for most Go code
2. **Proto handling needs care** - Decided to keep buf for proto gen, Bazel for Go compilation
3. **Incremental approach works** - Got basic setup working, can iterate on fixes
4. **Reference implementation helps** - stigmer-cloud provided good patterns to follow

### Commands Reference

```bash
# Install bazelisk and run Bazel
./bazelw version

# Generate/update BUILD files
./bazelw run //:gazelle

# Build everything
./bazelw build //...

# Build specific target
./bazelw build //cmd/stigmer:stigmer

# Query all targets
./bazelw query //...

# Test all
./bazelw test //...
```
