---
name: IDP proto cleanup
overview: "Fix the IdentityProvider proto definitions: correct the create RPC authorization to use a dedicated `can_create_idp` permission (matching the FGA pattern), simplify status to use `ApiResourceAuditStatus` directly (matching IdentityAccount pattern), and add the corresponding FGA permission to the organization model."
todos:
  - id: add-enum-value
    content: Add `can_create_idp = 24` to `ApiResourceIamPermission` enum in `iam_permission.proto`
    status: completed
  - id: update-command-permission
    content: Change `create` RPC permission from `can_edit` to `can_create_idp` in `command.proto`
    status: completed
  - id: delete-status-proto
    content: Delete `status.proto` (IdentityProviderStatus wrapper no longer needed)
    status: completed
  - id: update-api-proto
    content: Update `api.proto` to use `ApiResourceAuditStatus` directly (remove status.proto import, add commons status import, change field type)
    status: completed
  - id: update-fga-model
    content: "Add `can_create_idp: admin` to organization FGA model in stigmer-cloud"
    status: completed
isProject: false
---

# IdentityProvider Proto Cleanup

## Scope

Four files changed in `stigmer`, one file changed in `stigmer-cloud`. All changes are in proto/FGA definitions only -- generated stubs will be regenerated separately.

---

## Change 1: Add `can_create_idp` to the IAM permission enum

**File:** [apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/iam_permission.proto](apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/iam_permission.proto)

Add a new enum value `can_create_idp = 24` in the "Resource-specific creation permissions" section (next available number after `can_create_project = 23`):

```protobuf
  can_create_idp = 24; // Permission to create identity providers in an organization
```

**Naming note:** This is the first abbreviation in the `can_create_`* family (all others use full resource names like `can_create_agent`, `can_create_workflow`). You explicitly chose the short form to avoid the verbose `can_create_identity_provider`. This is a deliberate trade-off: brevity vs strict naming consistency. If you later feel this creates confusion, renaming is trivial since we're pre-production.

---

## Change 2: Update `create` RPC authorization in command.proto

**File:** [apis/ai/stigmer/iam/identityprovider/v1/command.proto](apis/ai/stigmer/iam/identityprovider/v1/command.proto)

Change the `create` RPC's permission from `can_edit` to `can_create_idp`:

```protobuf
  rpc create(IdentityProvider) returns (IdentityProvider) {
    option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).resource_kind = organization;
    option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).permission = can_create_idp;
    option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).field_path = "metadata.org";
    option (ai.stigmer.iam.iampolicy.v1.rpcauthorization.config).error_msg = "unauthorized to create identity provider in this organization";
  }
```

This aligns with the established pattern where every other resource's `create` RPC checks `can_create_<resource>` on the parent organization (e.g., `can_create_agent`, `can_create_session`, `can_create_project`).

---

## Change 3: Eliminate `IdentityProviderStatus` wrapper, use `ApiResourceAuditStatus` directly

This is a two-part change following the [IdentityAccount pattern](apis/ai/stigmer/iam/identityaccount/v1/api.proto) where status-only-audit resources use `ApiResourceAuditStatus` directly instead of a wrapper message.

### 3a. Delete status.proto

**File:** [apis/ai/stigmer/iam/identityprovider/v1/status.proto](apis/ai/stigmer/iam/identityprovider/v1/status.proto)

Delete this file entirely. The `IdentityProviderStatus` message currently contains only `reserved 1` and `audit = 99` -- it's a pure pass-through wrapper with no domain-specific status fields. No reserved field needed since we're in dev.

### 3b. Update api.proto to use `ApiResourceAuditStatus` directly

**File:** [apis/ai/stigmer/iam/identityprovider/v1/api.proto](apis/ai/stigmer/iam/identityprovider/v1/api.proto)

- Remove the import of `ai/stigmer/iam/identityprovider/v1/status.proto`
- Add import of `ai/stigmer/commons/apiresource/status.proto`
- Change field 5 from `IdentityProviderStatus status = 5` to `ai.stigmer.commons.apiresource.ApiResourceAuditStatus status = 5`
- Update the field comment to match the IdentityAccount style

The result mirrors exactly what IdentityAccount does:

```protobuf
import "ai/stigmer/commons/apiresource/status.proto";
// ...
  ai.stigmer.commons.apiresource.ApiResourceAuditStatus status = 5;
```

---

## Change 4: Add `can_create_idp` to the organization FGA model

**File (stigmer-cloud):** [backend/services/stigmer-service/src/main/resources/fga/model/tenancy/organization.fga](backend/services/stigmer-service/src/main/resources/fga/model/tenancy/organization.fga)

Add `can_create_idp: admin` to the "RESOURCE CREATION PERMISSIONS" section, following the existing pattern:

```
    # Permission to create identity providers within this organization
    # Admins and owners can create org-scoped identity providers
    define can_create_idp: admin
```

Without this, the authorization check in `command.proto`'s `create` RPC would always deny -- the proto permission and FGA permission names must match exactly.

---

## What is NOT changing (and why)

- `**apply` RPC:** Has no authorization annotations. This is a platform-wide pattern across all command controllers -- `apply` is unannotated everywhere. Not in scope.
- **Generated stubs:** Will need regeneration after proto changes, but that's a separate step (buf generate or equivalent).
- **Backend handler code in stigmer-cloud:** Grep shows no hand-written Java/Kotlin code directly referencing `IdentityProviderStatus`. The handler code uses the generated proto classes, which will be updated on stub regeneration.

