# Migrate IAM API Key API to OSS

**Date:** 2026-01-19  
**Type:** Migration  
**Scope:** APIs (iam/apikey)  
**Commit:** Pending

## Summary

Migrated the complete `iam/apikey` API from the private stigmer-cloud repository to the public stigmer OSS repository. This is the first step in making all authentication, authorization, and multi-tenancy APIs publicly available.

## What Changed

### API Migration

**Source:** `stigmer-cloud/apis/ai/stigmer/iam/apikey/`  
**Destination:** `stigmer/apis/ai/stigmer/iam/apikey/`

**Files migrated:**
- **Proto definitions** (v1/):
  - `api.proto` - API resource definition and RPCs
  - `command.proto` - Command messages for operations
  - `io.proto` - Input/output messages
  - `query.proto` - Query messages for search/list
  - `spec.proto` - API key specification and configuration
- **Build configuration:**
  - `BUILD.bazel` - Bazel build rules
- **Documentation:**
  - `README.md` - API usage and examples
  - `API_KEY_IMPLEMENTATION_SUMMARY.md` - Implementation details
  - `NEXT_STEPS.md` - Future enhancements
- **Examples (v1/curl/):**
  - `create-api-key.yaml`
  - `delete-api-key.yaml`
  - `get-api-key.yaml`
  - `list-api-keys.yaml`
  - `update-api-key.yaml`

## Why This Matters

**Open Source Strategy:**
- Makes API key management APIs publicly available
- Allows external developers to understand and integrate with Stigmer's IAM system
- First step in broader IAM/tenancy API migration to OSS

**API Completeness:**
- Users can now see how API key authentication works in Stigmer
- Proto definitions are available for generating client stubs
- Documentation and examples help with adoption

## Technical Details

### Directory Structure Created

```
stigmer/apis/ai/stigmer/iam/
├── apikey/
│   ├── v1/
│   │   ├── api.proto
│   │   ├── command.proto
│   │   ├── io.proto
│   │   ├── query.proto
│   │   ├── spec.proto
│   │   ├── BUILD.bazel
│   │   ├── README.md
│   │   └── curl/
│   │       ├── create-api-key.yaml
│   │       ├── delete-api-key.yaml
│   │       ├── get-api-key.yaml
│   │       ├── list-api-key.yaml
│   │       └── update-api-key.yaml
│   ├── API_KEY_IMPLEMENTATION_SUMMARY.md
│   └── NEXT_STEPS.md
└── iampolicy/ (existing)
    └── v1/
        └── rpcauthorization/ (preserved)
```

### Migration Method

Used direct directory copy to preserve:
- File structure
- Permissions
- Documentation formatting
- Example files

Command executed:
```bash
cp -r /path/to/stigmer-cloud/apis/ai/stigmer/iam/apikey \
     /path/to/stigmer/apis/ai/stigmer/iam/
```

## What's Next

This is Task 1 of 6 in the IAM/tenancy migration project:

- ✅ Task 1: Migrate iam/apikey API (complete)
- ⏳ Task 2: Migrate iam/iampolicy main API files
- ⏳ Task 3: Migrate iam/identityaccount API
- ⏳ Task 4: Migrate tenancy/organization API
- ⏳ Task 5: Update buf.yaml and regenerate stubs
- ⏳ Task 6: Verify build succeeds in OSS repo

**Next:** Migrate `iam/iampolicy` main API files while preserving the existing `rpcauthorization/` subdirectory.

## References

- **Project:** `_projects/2026-01/20260119.06.migrate-iam-tenancy-apis-to-oss/`
- **Source repo:** github.com/leftbin/stigmer-cloud (private)
- **Destination repo:** github.com/stigmer/stigmer (public)

## Notes

- The existing `iampolicy/v1/rpcauthorization/` directory in the OSS repo was preserved and not modified
- All documentation and examples were migrated intact
- No proto modifications were made during migration
- Build configuration will be tested in Task 6 after all APIs are migrated
