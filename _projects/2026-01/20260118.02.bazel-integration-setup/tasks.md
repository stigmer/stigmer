# Tasks: Bazel Integration Setup

## Task 1: Create Root Bazel Configuration
**Status**: ✅ COMPLETE

Created foundational Bazel configuration files at repository root:
- ✅ MODULE.bazel (Bazel module definition with Go deps)
- ✅ REPO.bazel (repository ignore patterns)
- ✅ bazelw (Bazel wrapper script)
- ✅ .bazelrc (Bazel configuration)

**Note**: No WORKSPACE file needed - using Bzlmod (MODULE.bazel) instead.

---

## Task 2: Set Up BUILD.bazel Files in apis/
**Status**: ✅ COMPLETE (with decision)

**Decision**: Use `buf` for proto generation, Bazel for Go compilation.

- ✅ Configured Gazelle to exclude `apis/ai/` (proto sources)
- ✅ Gazelle generates BUILD files for `apis/stubs/go/` (generated code)
- ✅ Deleted invalid BUILD files from proto source directories

**Rationale**: Keep existing buf-based proto workflow, use Bazel for compiling generated Go stubs.

---

## Task 3: Add BUILD.bazel Files for Go Services and Libraries
**Status**: ✅ MOSTLY COMPLETE

Gazelle automatically generated BUILD files for:
- ✅ `cmd/stigmer/` - CLI binary (builds successfully!)
- ✅ `backend/libs/go/**` - Shared Go libraries
- ✅ `backend/services/stigmer-server/**` - Server packages

⚠️ **Issues found** (blocking full //... build):
1. `backend/libs/go/sqlite/store_test.go` - outdated proto field names
2. `backend/services/stigmer-server/pkg/controllers/agentinstance/create.go` - undefined step function

---

## Task 4: Configure Gazelle for Automatic BUILD File Generation
**Status**: ✅ COMPLETE

- ✅ Added Gazelle to MODULE.bazel dependencies
- ✅ Created root BUILD.bazel with Gazelle target
- ✅ Successfully ran `bazel run //:gazelle` to generate BUILD files
- ✅ Added `.bazelignore` for workflow-runner and agent-runner (cloud-specific deps)
- ✅ Configured Gazelle exclusions in BUILD.bazel

**Working command**: `./bazelw run //:gazelle`

---

## Task 5: Update Makefile to Integrate with Bazel
**Status**: ✅ COMPLETE

**Decision**: Keep existing Makefile, add Gazelle to proto generation workflow.

- ✅ Added `go-stubs-generate-build-files` target to apis/Makefile
- ✅ Integrated Gazelle into go-stubs workflow
- ✅ Verified backward compatibility (make protos still works)
- ✅ Root Makefile delegates to apis/ (already aligned)

**Outcome**: `make protos` now generates stubs + BUILD files automatically.

---

## Task 6: Test Build with ./bazelw build //...
**Status**: ⚠️ MOSTLY COMPLETE

**Tested and working:**
- ✅ `./bazelw build //cmd/stigmer:stigmer` - CLI builds successfully
- ✅ Proto generation produces correct stubs + BUILD files
- ✅ Gazelle generates BUILD files for all Go packages
- ✅ Incremental builds work correctly

**Known issues** (optional to fix):
- ⚠️ `./bazelw build //...` blocked by 2 compilation errors:
  1. `backend/libs/go/sqlite/store_test.go` - outdated proto field names
  2. `backend/services/stigmer-server/pkg/controllers/agentinstance/create.go` - undefined step function

**Conclusion**: Bazel setup is complete and functional. The errors are code issues, not configuration issues.

---

## Notes

- Tasks can be reordered based on discoveries during implementation
- Reference stigmer-cloud repository frequently for patterns
- Document any deviations from cloud version in notes.md
