# 🚀 Resume: Migrate IAM and Tenancy APIs to OSS

**Project:** 20260119.06.migrate-iam-tenancy-apis-to-oss  
**Last Updated:** 2026-01-19  
**Current Status:** Ready to start

## Context

Migrating IAM and tenancy APIs from stigmer-cloud (private) to stigmer (OSS) repository to make all authentication, authorization, and multi-tenancy APIs publicly available.

## What We're Doing

Moving these API packages from `stigmer-cloud/apis` to `stigmer/apis`:

1. **iam/apikey** - API key management (complete new addition)
2. **iam/iampolicy** - IAM policy & authorization (main API files, preserving existing rpcauthorization)
3. **iam/identityaccount** - Identity/account management (complete new addition)
4. **tenancy/organization** - Multi-tenancy organization management (complete new addition)

## Next Task

**Task 2: Migrate iam/iampolicy main API files**

Copy the main iam/iampolicy API files from stigmer-cloud to stigmer OSS (preserving existing rpcauthorization):

**Source:** `/Users/suresh/scm/github.com/leftbin/stigmer-cloud/apis/ai/stigmer/iam/iampolicy/v1/`  
**Destination:** `/Users/suresh/scm/github.com/stigmer/stigmer/apis/ai/stigmer/iam/iampolicy/v1/`

**Files to migrate:**
- v1/api.proto, command.proto, io.proto, query.proto, spec.proto, policy.proto
- v1/BUILD.bazel
- v1/README.md
- v1/curl/*.yaml (example files if present)

**Note:** The existing `rpcauthorization/` directory should remain untouched.

## Quick Links

- **Project README:** `_projects/2026-01/20260119.06.migrate-iam-tenancy-apis-to-oss/README.md`
- **Full Task List:** `_projects/2026-01/20260119.06.migrate-iam-tenancy-apis-to-oss/tasks.md`
- **Notes:** `_projects/2026-01/20260119.06.migrate-iam-tenancy-apis-to-oss/notes.md`

## Progress

- [x] Task 1: Migrate iam/apikey API ✅
- [ ] Task 2: Migrate iam/iampolicy main API files
- [ ] Task 3: Migrate iam/identityaccount API
- [ ] Task 4: Migrate tenancy/organization API
- [ ] Task 5: Update buf.yaml and regenerate stubs
- [ ] Task 6: Verify build succeeds in OSS repo

---

**To resume:** Just drag this file into chat and say "let's continue"
