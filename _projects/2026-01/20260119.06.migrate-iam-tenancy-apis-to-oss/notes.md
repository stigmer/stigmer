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

## Learnings

(Add learnings as you progress through tasks)

---

## Questions / Blockers

(Track any questions or blockers here)
