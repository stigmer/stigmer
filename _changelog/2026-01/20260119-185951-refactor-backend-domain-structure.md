# Refactor: Backend Domain Structure - Controllers to Domain Pattern

**Date**: 2026-01-19  
**Type**: Refactoring  
**Scope**: Backend Services - stigmer-server package structure  
**Impact**: Internal - No API or user-facing changes

## Summary

Reorganized backend package structure from `pkg/controllers/` to `pkg/domain/{name}/controller/` with clear separation between controller logic and domain-specific temporal workflows. This improves code organization by grouping all domain-related code (controllers and temporal workflows) under a single domain namespace.

## What Changed

### Before Structure
```
backend/services/stigmer-server/pkg/controllers/
  - agent/
  - agentexecution/
    - temporal/
  - agentinstance/
  - environment/
  - executioncontext/
  - session/
  - skill/
  - workflow/
    - temporal/
  - workflowexecution/
    - temporal/
  - workflowinstance/
```

### After Structure
```
backend/services/stigmer-server/pkg/domain/
  - agent/controller/
  - agentexecution/
    - controller/
    - temporal/
  - agentinstance/controller/
  - environment/controller/
  - executioncontext/controller/
  - session/controller/
  - skill/controller/
  - workflow/
    - controller/
    - temporal/
  - workflowexecution/
    - controller/
    - temporal/
  - workflowinstance/controller/
```

## Why This Change

### Motivation

The user requested better domain organization where:
1. Domain logic is grouped under `pkg/domain/`
2. Controllers are explicitly in `controller/` subdirectories
3. Temporal workflows stay within their domain namespace
4. Clear separation between different concerns within a domain

### Benefits

**Better Organization**:
- All domain-related code grouped together
- Clear distinction between controller logic and temporal workflows
- Domain ownership is explicit in the package path

**Improved Discoverability**:
- Developers can find all code for a domain in one place
- `domain/agentexecution/` contains both controllers and temporal code
- No need to look in multiple top-level directories

**Clearer Intent**:
- `domain/` prefix makes it clear this is business domain code
- `controller/` subdirectory explicitly indicates handler/controller code
- Package structure reflects architectural intent

## Implementation Details

### Files Affected

**Statistics**:
- 159 files modified/moved
- 10 domains reorganized
- 19 code files updated (imports and BUILD.bazel)

**Domains Reorganized**:
1. agent
2. agentexecution (with temporal/)
3. agentinstance
4. environment
5. executioncontext
6. session
7. skill
8. workflow (with temporal/)
9. workflowexecution (with temporal/)
10. workflowinstance

### Changes Made

**1. Directory Structure**:
- Created `pkg/domain/` directory
- Created `domain/{name}/controller/` subdirectories for all domains
- Moved temporal directories to `domain/{name}/temporal/` (3 domains: agentexecution, workflow, workflowexecution)

**2. File Moves (Git History Preserved)**:
- Used `git mv` for all file moves to preserve history
- Moved controller files: `*.go`, `*.md`, `BUILD.bazel`
- Moved temporal code: activities, workflows, config files
- Moved session steps subdirectory

**3. Import Path Updates**:

Updated 7 files with import references:
```go
// Before
github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agentexecution

// After
github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/controller
```

**Files Updated**:
- `cmd/server/main.go` - All controller imports
- `domain/agentexecution/temporal/workflows/invoke_workflow_impl.go`
- `domain/agentexecution/temporal/worker_config.go`
- `domain/agentexecution/temporal/workflow_creator.go`
- `domain/session/controller/list_by_agent.go`
- `domain/workflowexecution/temporal/workflows/invoke_workflow_impl.go`
- `domain/workflowexecution/temporal/worker_config.go`

**4. Build System**:
- Ran `bazel run //:gazelle` to regenerate BUILD.bazel files
- Updated 19 BUILD.bazel files with new package paths
- Gazelle automatically handled Go package dependencies

**5. Cleanup**:
- Removed old `pkg/controllers/` directory
- Deleted old BUILD.bazel files

## Technical Details

### Import Path Pattern

**Old Pattern**:
```go
import (
    agentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/controllers/agent"
)
```

**New Pattern**:
```go
import (
    agentcontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agent/controller"
)
```

### Temporal Workflow Structure

Domains with temporal workflows (agentexecution, workflow, workflowexecution) now have:
```
domain/{name}/
  - controller/          # gRPC handlers
  - temporal/            # Temporal workflows and activities
    - activities/
    - workflows/
    - config.go
    - worker_config.go
```

This keeps all domain logic together while maintaining clear separation of concerns.

### Session Domain Special Case

Session domain has a `steps/` subdirectory for pipeline steps:
```
domain/session/
  - controller/
    - session_controller.go
    - list_by_agent.go
    - steps/             # Pipeline steps
      - filter_by_agent_instance.go
```

## Verification

**Directory Structure**:
```bash
$ find backend/services/stigmer-server/pkg/domain -type d | head -20
backend/services/stigmer-server/pkg/domain
backend/services/stigmer-server/pkg/domain/agent/controller
backend/services/stigmer-server/pkg/domain/agentexecution/controller
backend/services/stigmer-server/pkg/domain/agentexecution/temporal
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/activities
backend/services/stigmer-server/pkg/domain/agentexecution/temporal/workflows
# ... (all domains present)
```

**Git Status**:
- 159 files with git changes
- Old controllers directory deleted
- All files moved with `git mv` (history preserved)

**Import References**:
```bash
$ grep -r "pkg/controllers" backend/services/stigmer-server/
# No results - all imports updated
```

## Migration Notes

### For Future Development

**Adding New Controllers**:
```bash
# Create domain structure
mkdir -p backend/services/stigmer-server/pkg/domain/{name}/controller

# Add controller files
touch backend/services/stigmer-server/pkg/domain/{name}/controller/{name}_controller.go

# Run gazelle
bazel run //:gazelle
```

**Import Pattern**:
```go
import (
    "{name}controller" "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/{name}/controller"
)
```

**Temporal Workflows** (if needed):
```bash
# Create temporal structure
mkdir -p backend/services/stigmer-server/pkg/domain/{name}/temporal/{activities,workflows}

# Add temporal files
touch backend/services/stigmer-server/pkg/domain/{name}/temporal/config.go
```

## Build Status

**Pre-existing Build Issues** (not related to this refactoring):
1. Bazel dependency issue with `@build_buf_gen_go_bufbuild_protovalidate_protocolbuffers_go`
2. Type mismatch errors in `backend/libs/go/grpc/request/pipeline/steps/` (from changes already in progress)

**Refactoring Verification**:
- All import paths updated correctly
- No references to old `pkg/controllers/` path remain
- Gazelle regenerated BUILD.bazel files successfully
- Git history preserved for all moved files

Once pre-existing build issues are resolved, the build should succeed with the new structure.

## Impact Assessment

**No Changes Required For**:
- ✅ API definitions (protos)
- ✅ Client code (CLIs, SDKs)
- ✅ Downstream services
- ✅ Configuration files
- ✅ Database schemas
- ✅ Deployment manifests

**Changes Required For**:
- ✅ Internal imports within stigmer-server (completed)
- ✅ BUILD.bazel files (regenerated)

**Developer Experience**:
- Improved code discoverability
- Better domain separation
- Clearer package structure
- Git history preserved (easy to trace changes)

## Rationale for Structure

### Why `domain/` Instead of `controllers/`?

**Domain-Driven Design**:
- Package names should reflect business concepts, not technical patterns
- `domain/agent/` is more meaningful than `controllers/agent/`
- Groups all domain logic together (controllers, temporal, etc.)

**Separation of Concerns**:
- `controller/` subdirectory explicitly indicates handler code
- `temporal/` subdirectory explicitly indicates workflow code
- Domain namespace encompasses both

**Scalability**:
- Easy to add more domain-specific packages (e.g., `domain/agent/validator/`, `domain/agent/mapper/`)
- Clear place for domain logic that isn't controller or temporal
- Supports future growth without restructuring

### Why `controller/` Subdirectory?

**Explicit Intent**:
- Makes it clear these are gRPC handlers/controllers
- Distinguishes from other domain code
- Follows convention from other frameworks

**Future Flexibility**:
- Room for other domain packages (validators, mappers, etc.)
- Example: `domain/agent/{controller, validator, mapper, temporal}/`

## Lessons Learned

**Git Operations**:
- Using `git mv` preserves file history (important for large refactors)
- Running gazelle after moving files ensures BUILD.bazel correctness
- Clean bazel cache (`bazel clean --expunge`) helps resolve caching issues

**Import Updates**:
- Grep to find all old import references
- Update imports before running gazelle
- Verify no old references remain

**Build System**:
- Gazelle automatically handles Go package dependencies
- BUILD.bazel files regenerate based on Go imports
- Pre-existing build issues can mask refactoring errors

## References

**Affected Code**:
- `backend/services/stigmer-server/pkg/domain/` (all domains)
- `backend/services/stigmer-server/cmd/server/main.go` (imports)

**Related Documentation**:
- None (internal refactoring, no documentation updates needed)

**Git History**:
- All file moves preserved with `git mv`
- 159 files affected
- Clean refactoring with no logic changes

---

**Status**: ✅ Complete  
**Build**: ⚠️ Pre-existing issues (not related to refactoring)  
**Next Steps**: Resolve pre-existing build issues, then verify clean build
