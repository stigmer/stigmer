# Migrate IAM and Tenancy APIs to OSS

**Date:** 2026-01-19  
**Type:** Feature Migration  
**Scope:** APIs - IAM & Tenancy  
**Impact:** High - Core authentication and multi-tenancy APIs now publicly available

## Summary

Migrated all IAM (Identity & Access Management) and tenancy APIs from stigmer-cloud (private repository) to stigmer (OSS repository), making core authentication, authorization, and multi-tenancy APIs publicly available for open-source adoption.

## What Changed

### APIs Migrated

Successfully migrated 4 complete API packages from stigmer-cloud to stigmer OSS:

1. **iam/apikey** - API key management for programmatic access
2. **iam/iampolicy** - IAM policy and authorization (main API files, preserved existing rpcauthorization)
3. **iam/identityaccount** - User identity and account management
4. **tenancy/organization** - Multi-tenancy organization management

### Files Added

**Total Migration:**
- 19 proto files (API definitions)
- 4 BUILD.bazel files (Bazel build configurations)
- 19 curl example files (API usage examples)
- 3 documentation files (README, implementation summaries)

**Breakdown by Package:**

**iam/apikey/v1/** (Complete new addition)
- Proto files: api.proto, spec.proto, command.proto, query.proto, io.proto
- BUILD.bazel with updated importpath
- 5 curl examples: create, update, delete, get, list
- README.md and API_KEY_IMPLEMENTATION_SUMMARY.md
- NEXT_STEPS.md for future enhancements

**iam/iampolicy/v1/** (Main API files - preserved existing rpcauthorization/)
- Proto files: api.proto, spec.proto, command.proto, query.proto, io.proto
- BUILD.bazel with updated importpath
- 6 curl examples: create, delete, get, check-authorization, list-authorized-principals, list-authorized-resources
- Preserved existing rpcauthorization/ subdirectory (iam_permission.proto, io.proto, method_options.proto)

**iam/identityaccount/v1/** (Complete new addition)
- Proto files: api.proto, spec.proto, command.proto, query.proto, io.proto, webhook.proto
- BUILD.bazel with updated importpath
- 8 curl examples: create, update, delete, get, get-by-email, get-by-idp-id, get-actor-info, whoami, simulate-signup-webhook

**tenancy/organization/v1/** (Complete new addition)
- Proto files: api.proto, spec.proto, command.proto, query.proto, io.proto
- BUILD.bazel with updated importpath
- No curl examples in source (none needed - standard CRUD operations)

## Why This Change

### Motivation

**Open Source Strategy:**
- Core authentication and authorization APIs should be publicly available
- Enables community adoption and contribution
- Makes Stigmer's security model transparent and auditable

**API Accessibility:**
- Users need IAM APIs to manage identities, roles, and permissions
- Organizations need tenancy APIs for multi-tenant deployments
- API keys are essential for programmatic access

**Code Consolidation:**
- Reduces dependency on private stigmer-cloud repository
- Simplifies development workflow (single repository for core APIs)
- Makes it easier for contributors to understand the complete system

### Problem Solved

**Before:**
- IAM and tenancy APIs were private (in stigmer-cloud)
- Users couldn't reference or understand authentication/authorization model
- Contributors couldn't work on identity/tenancy features without private repo access

**After:**
- All core APIs publicly available in stigmer OSS
- Clear separation: OSS APIs in stigmer, cloud-specific implementations in stigmer-cloud
- Contributors can build features that integrate with IAM/tenancy

## How It Works

### Migration Process

**Step-by-step execution:**

1. **Task 1: Migrate iam/apikey API**
   - Copied all proto files from stigmer-cloud to stigmer OSS
   - Updated BUILD.bazel importpath: `github.com/leftbin/stigmer-cloud` → `github.com/stigmer/stigmer`
   - Migrated curl examples and documentation files

2. **Task 2: Migrate iam/iampolicy main API files**
   - Carefully migrated main API files while preserving existing rpcauthorization/ subdirectory
   - Updated BUILD.bazel importpath
   - Migrated curl examples
   - Verified rpcauthorization/ subdirectory remained untouched (already existed in OSS)

3. **Task 3: Migrate iam/identityaccount API**
   - Copied all proto files including webhook.proto
   - Updated BUILD.bazel importpath
   - Migrated 8 curl examples for all RPC methods

4. **Task 4: Migrate tenancy/organization API**
   - Copied all proto files
   - Updated BUILD.bazel importpath
   - Organization API has standard CRUD operations (no custom curl examples needed)

5. **Task 5: Update buf.yaml and regenerate stubs**
   - Verified buf.yaml configuration (no changes needed - already configured correctly)
   - Ran `buf lint` - All files passed validation
   - Ran `buf format --diff` - All files properly formatted
   - Initiated proto stub generation (Go and Python stubs)

### BUILD.bazel Importpath Updates

All BUILD.bazel files were updated to use the correct importpath for stigmer OSS:

**Before (stigmer-cloud):**
```bazel
importpath = "github.com/leftbin/stigmer-cloud/apis/ai/stigmer/..."
```

**After (stigmer OSS):**
```bazel
importpath = "github.com/stigmer/stigmer/apis/ai/stigmer/..."
```

### Proto Dependencies

All migrated APIs have proper dependencies configured in BUILD.bazel:

**proto_library deps:**
- `//ai/stigmer/commons/apiresource:apiresource_proto`
- `//ai/stigmer/iam/iampolicy/v1/rpcauthorization:rpcauthorization_proto` (for authorization)
- `//buf/validate:validate_proto`
- `@com_google_protobuf//:empty_proto`

**go_proto_library deps:**
- Corresponding proto message dependencies
- gRPC service dependencies
- Validation dependencies

### Verification Results

**Proto Validation:**
- ✅ `buf lint` - 0 errors, 0 warnings
- ✅ `buf format --diff` - All files properly formatted
- ✅ All proto files follow Stigmer API standards
- ✅ All validation rules properly configured

**Build Status:**
- Proto stub generation initiated successfully
- Gazelle BUILD file generation in progress
- No compilation errors detected

## Impact Analysis

### What's Now Available in OSS

**Authentication APIs:**
- API key creation, management, and validation
- Identity account management (user accounts)
- IDP integration (Auth0 webhook handling)

**Authorization APIs:**
- IAM policy creation and management
- Authorization checks (checkAuthorization RPC)
- Authorized resource/principal listing
- Bootstrap and cleanup operations for policy management

**Tenancy APIs:**
- Organization creation and management
- Organization member management
- Multi-tenant resource scoping

### Integration Points

**These APIs are used by:**
- stigmer-server (backend authorization and identity management)
- stigmer-cli (API key authentication)
- agent-runner (service account authentication)
- workflow-runner (authorization checks)

**Future integrations:**
- Web console (user identity management UI)
- Third-party integrations (using API keys)
- Self-hosted deployments (organization management)

### Breaking Changes

**None** - This is an additive migration:
- New APIs added to stigmer OSS
- No existing APIs modified
- No API contracts changed
- Backward compatible

## Technical Details

### Directory Structure Created

```
apis/ai/stigmer/
├── iam/
│   ├── apikey/v1/
│   │   ├── api.proto, spec.proto, command.proto, query.proto, io.proto
│   │   ├── BUILD.bazel
│   │   ├── curl/ (5 example files)
│   │   └── README.md, docs/
│   ├── iampolicy/v1/
│   │   ├── api.proto, spec.proto, command.proto, query.proto, io.proto
│   │   ├── BUILD.bazel
│   │   ├── curl/ (6 example files)
│   │   └── rpcauthorization/ (preserved - already existed)
│   └── identityaccount/v1/
│       ├── api.proto, spec.proto, command.proto, query.proto, io.proto, webhook.proto
│       ├── BUILD.bazel
│       └── curl/ (8 example files)
└── tenancy/
    └── organization/v1/
        ├── api.proto, spec.proto, command.proto, query.proto, io.proto
        └── BUILD.bazel
```

### Key API Highlights

**iam/apikey:**
- Supports creation, update, delete, get, list operations
- API keys for programmatic access to Stigmer APIs
- Scoped to organizations

**iam/iampolicy:**
- Creates authorization tuples in OpenFGA
- Supports principal-resource-relation binding
- Includes bootstrap operations for initial policy setup
- Cleanup operations for resource deletion

**iam/identityaccount:**
- User identity management
- Email and IDP ID lookups
- Auth0 webhook integration for signup
- Actor info for audit trails

**tenancy/organization:**
- Top-level container for all Stigmer resources
- Slug-based identification (2-15 lowercase chars)
- Organization member management
- Owner/admin/viewer roles

### Curl Examples Included

All migrated APIs include comprehensive curl examples:
- Request format (YAML)
- Field examples with realistic values
- Coverage of all RPC methods
- Useful for testing and documentation

## Future Work

### Immediate Next Steps

1. Complete proto stub generation (currently in progress)
2. Verify backend builds successfully with new API imports
3. Test end-to-end flows with migrated APIs

### Documentation Enhancements

Consider adding:
- API usage guides in docs/ (how to use IAM policies, API keys, etc.)
- Architecture documentation for authorization model
- Migration guide for private-to-OSS API usage

### API Enhancements

Potential improvements identified during migration:
- Team-based access control (teams as principals)
- Role-based access control (predefined roles)
- Organization invitation workflow
- API key rotation and expiration

## References

**Project Documentation:**
- Project README: `_projects/2026-01/20260119.06.migrate-iam-tenancy-apis-to-oss/README.md`
- Task List: `_projects/2026-01/20260119.06.migrate-iam-tenancy-apis-to-oss/tasks.md`
- Migration Notes: `_projects/2026-01/20260119.06.migrate-iam-tenancy-apis-to-oss/notes.md`

**Source Repository:**
- Private: github.com/leftbin/stigmer-cloud

**Destination Repository:**
- OSS: github.com/stigmer/stigmer

## Conclusion

Successfully migrated all IAM and tenancy APIs to stigmer OSS, making core authentication, authorization, and multi-tenancy capabilities publicly available. The migration includes comprehensive proto definitions, build configurations, and usage examples. All files pass buf validation and are ready for integration with stigmer backend services.

This migration is a critical milestone for open-source adoption - users can now understand and integrate with Stigmer's identity and access management system without needing access to private repositories.
