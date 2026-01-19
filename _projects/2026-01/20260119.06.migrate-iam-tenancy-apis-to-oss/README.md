# Migrate IAM and Tenancy APIs to OSS

**Project:** 20260119.06.migrate-iam-tenancy-apis-to-oss  
**Created:** 2026-01-19  
**Completed:** 2026-01-19  
**Status:** ✅ Complete

**Checkpoint:** `checkpoints/2026-01-19-migration-complete.md`  
**Changelog:** `_changelog/2026-01/2026-01-19-070040-migrate-iam-tenancy-apis-to-oss.md`

## Description

Migrate IAM and tenancy APIs from stigmer-cloud to the open source stigmer repository, making all authentication, authorization, and multi-tenancy APIs publicly available.

## Goal

Move all IAM (apikey, iampolicy, identityaccount) and tenancy (organization) proto APIs from `stigmer-cloud/apis` to `stigmer/apis`, making them publicly available in the OSS version.

## Technology Stack

- Proto/Buf
- Bazel

## Affected Components

- **Source:** `stigmer-cloud/apis/ai/stigmer/iam/` and `stigmer-cloud/apis/ai/stigmer/tenancy/`
- **Destination:** `stigmer/apis/ai/stigmer/iam/` and `stigmer/apis/ai/stigmer/tenancy/`

## APIs to Migrate

### IAM APIs

1. **iam/apikey/** - Complete new addition with:
   - api.proto, command.proto, io.proto, query.proto, spec.proto
   - BUILD.bazel
   - curl/ examples
   - README.md, implementation docs

2. **iam/iampolicy/v1/** - Main API files (OSS already has rpcauthorization subfolder):
   - api.proto, command.proto, io.proto, query.proto, spec.proto
   - BUILD.bazel
   - curl/ examples

3. **iam/identityaccount/** - Complete new addition with:
   - api.proto, command.proto, io.proto, query.proto, spec.proto, webhook.proto
   - BUILD.bazel
   - curl/ examples

### Tenancy APIs

4. **tenancy/organization/** - Complete new addition with:
   - api.proto, command.proto, io.proto, query.proto, spec.proto
   - BUILD.bazel

## Success Criteria

- [ ] All IAM and tenancy proto files successfully migrated to OSS repo
- [ ] Proto files compile successfully in OSS repo
- [ ] buf.yaml updated if needed
- [ ] BUILD.bazel files properly configured
- [ ] No build errors after migration

## Task Tracking

See `tasks.md` for detailed task breakdown and progress.

## Quick Resume

Drag `next-task.md` into any chat to resume this project instantly.
