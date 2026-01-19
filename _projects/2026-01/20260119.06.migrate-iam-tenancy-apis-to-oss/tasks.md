# Tasks

## Task 1: Migrate iam/apikey API
**Status:** ⏸️ TODO

**Description:** Copy the complete iam/apikey directory from stigmer-cloud to stigmer OSS, including all proto files, BUILD.bazel, curl examples, and documentation.

**Files to migrate:**
- v1/api.proto
- v1/command.proto
- v1/io.proto
- v1/query.proto
- v1/spec.proto
- v1/BUILD.bazel
- v1/README.md
- v1/curl/*.yaml
- API_KEY_IMPLEMENTATION_SUMMARY.md
- NEXT_STEPS.md

---

## Task 2: Migrate iam/iampolicy main API files
**Status:** ⏸️ TODO

**Description:** Migrate the main iampolicy API files to stigmer OSS, preserving the existing rpcauthorization subfolder that's already present.

**Files to migrate:**
- v1/api.proto
- v1/command.proto
- v1/io.proto
- v1/query.proto
- v1/spec.proto
- v1/BUILD.bazel
- v1/curl/*.yaml

**Note:** The rpcauthorization subfolder already exists in OSS and should be preserved.

---

## Task 3: Migrate iam/identityaccount API
**Status:** ⏸️ TODO

**Description:** Copy the complete iam/identityaccount directory from stigmer-cloud to stigmer OSS, including all proto files, BUILD.bazel, and curl examples.

**Files to migrate:**
- v1/api.proto
- v1/command.proto
- v1/io.proto
- v1/query.proto
- v1/spec.proto
- v1/webhook.proto
- v1/BUILD.bazel
- v1/curl/*.yaml

---

## Task 4: Migrate tenancy/organization API
**Status:** ⏸️ TODO

**Description:** Copy the complete tenancy/organization directory from stigmer-cloud to stigmer OSS, creating the tenancy package for the first time in OSS.

**Files to migrate:**
- organization/v1/api.proto
- organization/v1/command.proto
- organization/v1/io.proto
- organization/v1/query.proto
- organization/v1/spec.proto
- organization/v1/BUILD.bazel

---

## Task 5: Update buf.yaml and regenerate stubs
**Status:** ⏸️ TODO

**Description:** Check if buf.yaml needs any updates for the new packages and regenerate proto stubs.

**Actions:**
- Review buf.yaml for any necessary changes
- Run `make protos` to regenerate stubs
- Verify no buf lint errors

---

## Task 6: Verify build succeeds in OSS repo
**Status:** ⏸️ TODO

**Description:** Ensure all migrated proto files compile successfully in the OSS repository.

**Actions:**
- Run bazel build on the new packages
- Verify no compilation errors
- Check that all dependencies resolve correctly
