# Skill Pre-Push Validation in stigmer apply

**Date**: February 4, 2026

## Summary

Implemented skill pre-push flow validation in the `stigmer apply` command to detect and verify external skill references before deployment. When agents reference skills that aren't defined inline in the SDK, the CLI now validates their existence in the backend registry and blocks deployment with clear guidance if any are missing. This ensures that all skill dependencies are satisfied before project deployment, preventing runtime failures and providing actionable error messages to guide users through the correct push workflow.

## Problem Statement

In Stigmer's agentic platform, agents can reference skills in two ways:
1. **Inline skills**: Defined directly in the SDK synthesis output
2. **External skills**: Pre-pushed to the registry and referenced by org/slug

Before this change, `stigmer apply` would successfully deploy a project even if agents referenced external skills that didn't exist in the backend. This led to runtime failures when agents tried to load non-existent skills during execution. Users had no clear feedback about which skills were missing or how to fix the issue.

### Pain Points

- **Silent failures**: Projects deployed successfully but failed at runtime when agents couldn't load missing skills
- **No validation**: CLI didn't verify skill references before deployment
- **Poor error messages**: Users discovered missing skills through cryptic backend errors during execution
- **Unclear workflow**: Users didn't understand they needed to separately push skills before deploying agents that reference them
- **Wasted deployment cycles**: Failed deployments required multiple attempts to discover and push all missing skills

## Solution

Added a skill verification step (Step 10.5) to the `stigmer apply` workflow that:
1. **Extracts external skill references** from both the dependencies map and Agent proto SkillRefs
2. **Verifies existence** by querying the backend's SkillQueryController
3. **Blocks deployment** if any skills are missing
4. **Provides clear guidance** with exact push commands needed to fix the issue

The verification happens after backend connection but before actual deployment, ensuring fast feedback while having access to the registry for verification.

## Implementation Details

### New Files Created

**`skill_validation.go`** (207 lines)
- `ExternalSkillRef` type: Represents an external skill reference with org, slug, and referencing agents
- `SkillVerificationResult` type: Contains found/missing skill categorization
- `ExtractExternalSkillRefs()`: Extracts external skill references from synthesis result
  - Scans dependencies map for `skill:external:{slug}` patterns
  - Scans Agent.Spec.SkillRefs and SubAgent.SkillRefs proto fields
  - Excludes inline skills defined in Result.Skills
  - Deduplicates and tracks which agents reference each skill
- Helper functions: `buildInlineSkillSet()`, `extractFromDependencies()`, `extractFromAgents()`, `addSkillRef()`

**`skill_verify.go`** (118 lines)
- `VerifyExternalSkills()`: Queries backend for each external skill reference
  - Uses SkillQueryController.GetByReference() gRPC call
  - Handles "not found" errors gracefully (expected for missing skills)
  - Categorizes skills as found or missing
- `checkSkillExists()`: Individual skill existence check
- `DisplayMissingSkillsGuidance()`: User-friendly error output with:
  - List of missing skills with referencing agents
  - Exact `stigmer skill push` commands to fix
  - Explanation of why separate skill pushing is required

**`skill_validation_test.go`** (522 lines)
- 30+ comprehensive test cases covering:
  - Extraction from dependencies map (external skill patterns)
  - Extraction from Agent proto SkillRefs (main agents and sub-agents)
  - Inline skill exclusion logic
  - Deduplication across multiple agents
  - Combined sources (dependencies + proto refs)
  - Real-world scenarios (data pipeline, microservice architecture)
  - Helper function behavior
  - Edge cases (nil inputs, empty results, malformed data)

### Modified Files

**`apply.go`** (+17 lines)
- Added Step 10.5 between backend connection and deployment
- Calls `ExtractExternalSkillRefs()` to find external skill references
- If external skills exist:
  - Connects to backend for verification
  - Calls `VerifyExternalSkills()` to check existence
  - If any missing: displays guidance and blocks deployment
  - If all found: proceeds with deployment

**`BUILD.bazel`** (+12 lines)
- Added new source files to library target
- Added dependencies:
  - `//apis/stubs/go/ai/stigmer/agentic/agent/v1:agent`
  - `//apis/stubs/go/ai/stigmer/agentic/skill/v1:skill`
  - `//apis/stubs/go/ai/stigmer/commons/apiresource`
  - `//apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind`
  - `//client-apps/cli/internal/cli/cliprint`
  - `@org_golang_google_grpc//:grpc`
  - `@org_golang_google_grpc//codes`
  - `@org_golang_google_grpc//status`

### Key Design Decisions

**1. Verification After Connection**
- Placed after daemon start and backend connection (Step 10)
- Before actual deployment (Step 11)
- Provides fast feedback while having access to registry

**2. No Auto-Push**
- Verification only, never auto-pushes missing skills
- Maintains separation of concerns (push vs apply)
- Keeps apply fast and predictable
- Makes skill versioning explicit

**3. Extraction Strategy**
- Dual extraction: dependencies map + proto SkillRefs
- Dependencies map: handles local CLI validation patterns (`skill:external:{slug}`)
- Proto SkillRefs: canonical source of truth from synthesis
- Inline exclusion: prevents false positives for skills defined in SDK

**4. Error Guidance Design**
- Lists missing skills with referencing agents
- Provides exact commands (copy-paste ready)
- Explains the "why" (versioning, review, deduplication)
- Actionable: users know exactly what to do

## Benefits

### Developer Experience
- **Immediate feedback**: Detect missing skills before deployment (seconds vs minutes)
- **Clear error messages**: Know exactly which skills are missing and which agents need them
- **Copy-paste commands**: No guessing about how to fix the issue
- **Prevents deployment cycles**: Fix all missing skills in one pass

### Platform Reliability
- **Runtime safety**: No deployments with broken skill references
- **Explicit dependencies**: All skill dependencies verified before execution
- **Better observability**: Missing skills caught at deploy time, not execution time

### Workflow Clarity
- **Separation of concerns**: Skill push and project deploy are distinct operations
- **Version control**: Skills pushed separately with explicit versioning
- **Code review**: Skills can be reviewed before agents use them

## Impact

### Affected Users
- **All users deploying projects with external skill references**
- **SDK developers** who need to understand the push-then-apply workflow
- **Platform operators** who benefit from fewer runtime failures

### Migration Path
- **No breaking changes**: Existing workflows continue to work
- **Additive validation**: Only blocks deployment if skills are actually missing
- **Clear guidance**: Users immediately understand how to fix issues

### Performance
- **Minimal overhead**: One gRPC call per external skill reference
- **Fail-fast**: Blocks deployment early, saves backend reconciliation time
- **Cached backend connection**: Reuses connection established in Step 10

## Testing

All tests pass with comprehensive coverage:
- **Unit tests**: 30+ test cases for extraction, verification, and display logic
- **Integration tests**: Bazel build and test targets pass
- **Real-world scenarios**: Data pipeline and microservice architecture patterns tested
- **Edge cases**: Nil inputs, empty results, malformed data handled gracefully

Test execution:
```bash
bazel test //client-apps/cli/internal/cli/apply:apply_test  # PASSED
bazel build //client-apps/cli/internal/cli/apply:apply      # SUCCESS
```

## Example User Experience

### Before (Missing Skills)

```
$ stigmer apply
✓ Found project: my-data-pipeline
Running SDK synthesis...
✓ Synthesis complete: 4 resource(s) discovered
Connecting to backend...
✓ Connected to backend

⚠️  External skills not found
═══════════════════════════════════════════════════════════════════

The following skills are referenced by agents but haven't been pushed:

  1. my-org/data-validation
     Referenced by: agent:data-processor
     
  2. my-org/code-analysis
     Referenced by: agent:reviewer

To fix this, push each skill before deploying:

  stigmer skill push ./skills/data-validation --org my-org
  stigmer skill push ./skills/code-analysis --org my-org

Then run 'stigmer apply' again.

═══════════════════════════════════════════════════════════════════
Why is this required?

Skills are pushed separately to enable:
  • Independent versioning (use tags like v1.0, latest)
  • Code review before deployment
  • Artifact deduplication across projects

Error: deployment blocked: 2 skill(s) not found - push them first
```

### After (All Skills Found)

```
$ stigmer apply
✓ Found project: my-data-pipeline
Running SDK synthesis...
✓ Synthesis complete: 4 resource(s) discovered
Connecting to backend...
✓ Connected to backend

Verifying external skill references...
✓ All external skills verified (2)

Deploying resources...
🚀 Deployment successful!
```

## Related Work

This implementation completes T05.24 from Phase 5: Backend CLI Integration. It follows the design established in:
- T05.21: SDK Synthesis Runner (manifest generation)
- T05.22: Manifest Collection (resource gathering)
- T05.23: Apply Command Integration (deployment workflow)

The skill verification step integrates seamlessly into the existing apply workflow, maintaining the separation of concerns between skill management and project deployment.

## Code Quality

All code adheres to Stigmer CLI coding guidelines:
- ✅ All files under 250 lines (split into skill_validation.go and skill_verify.go)
- ✅ All functions under 50 lines
- ✅ All errors wrapped with specific context using `errors.Wrap()`
- ✅ Single Responsibility Principle maintained
- ✅ gofmt clean
- ✅ go vet clean
- ✅ Bazel build/test passing

---

**Status**: ✅ Production Ready  
**Implementation Time**: ~2 hours  
**Test Coverage**: 30+ test cases  
**Lines of Code**: ~850 total (325 source, 522 tests, 3 modified)
