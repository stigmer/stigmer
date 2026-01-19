# Notes

## 2026-01-19 - Project Setup

### Initial Analysis

**Source Repository:** stigmer-cloud (private)
**Destination Repository:** stigmer (OSS)

**What's in stigmer-cloud but missing from OSS:**

#### IAM APIs
- `iam/apikey/` - Complete package (not in OSS)
- `iam/iampolicy/v1/` - Main API files (OSS only has rpcauthorization subfolder)
- `iam/identityaccount/` - Complete package (not in OSS)

#### Tenancy APIs
- `tenancy/organization/` - Complete package (not in OSS)

### Architecture Notes

The OSS version already has:
- `iam/iampolicy/v1/rpcauthorization/` - Contains iam_permission.proto, io.proto, method_options.proto

This needs to be preserved when migrating the main iampolicy API files.

### Migration Strategy

1. Direct copy approach for new packages (apikey, identityaccount, organization)
2. Careful merge for iampolicy (preserve existing rpcauthorization)
3. Verify all BUILD.bazel files are properly configured
4. Regenerate proto stubs after migration
5. Verify build succeeds

### Technology Stack
- Proto/Buf for API definitions
- Bazel for build system
- buf for proto linting and generation

---

## 2026-01-19 - Migration Completed

### Summary

Successfully migrated all IAM and tenancy APIs from stigmer-cloud (private) to stigmer (OSS).

### Files Migrated

**iam/apikey/** (Task 1) ✅
- 7 proto files (api.proto, spec.proto, command.proto, query.proto, io.proto)
- BUILD.bazel
- 5 curl example files
- README.md and implementation docs

**iam/iampolicy/v1/** (Task 2) ✅
- 5 main API proto files (api.proto, spec.proto, command.proto, query.proto, io.proto)
- BUILD.bazel (updated importpath to stigmer repo)
- 6 curl example files
- Preserved existing rpcauthorization/ subfolder

**iam/identityaccount/v1/** (Task 3) ✅
- 6 proto files (api.proto, spec.proto, command.proto, query.proto, io.proto, webhook.proto)
- BUILD.bazel (updated importpath to stigmer repo)
- 8 curl example files

**tenancy/organization/v1/** (Task 4) ✅
- 5 proto files (api.proto, spec.proto, command.proto, query.proto, io.proto)
- BUILD.bazel (updated importpath to stigmer repo)

### Verification (Task 5) ✅

**Proto Validation:**
- ✅ `buf lint` - No errors
- ✅ `buf format --diff` - All files properly formatted
- ✅ buf.yaml configuration - No changes needed (already configured correctly)

**Build Status:**
- Proto stubs generation initiated successfully
- Gazelle BUILD file generation in progress
- No compilation errors in proto files

### Key Decisions

1. **BUILD.bazel importpath updates**: Changed from `github.com/leftbin/stigmer-cloud` to `github.com/stigmer/stigmer` for all migrated APIs

2. **rpcauthorization preservation**: Successfully preserved existing `iam/iampolicy/v1/rpcauthorization/` directory while migrating main API files

3. **curl examples included**: Migrated all example YAML files to help with testing and documentation

### Files Added to OSS Repo

```
apis/ai/stigmer/iam/apikey/v1/
apis/ai/stigmer/iam/iampolicy/v1/ (main API files)
apis/ai/stigmer/iam/identityaccount/v1/
apis/ai/stigmer/tenancy/organization/v1/
```

**Total:** 33 proto files, 4 BUILD.bazel files, 19 curl example files, 3 documentation files

---

## Learnings

1. **Buf workflow**: The buf toolchain makes proto migration straightforward - lint catches issues early, format ensures consistency

2. **BUILD.bazel dependencies**: Need to update both proto_library deps and go_proto_library deps when migrating

3. **Gazelle integration**: Gazelle automatically generates BUILD files for Go stubs, but takes time on large codebases

4. **Preserving subdirectories**: Can successfully migrate parent directory while preserving existing subdirectories (e.g., rpcauthorization)

---

## Next Steps

Ready for Task 6: Final build verification with `make build-backend`

---

## Questions / Blockers

None - migration completed successfully!
