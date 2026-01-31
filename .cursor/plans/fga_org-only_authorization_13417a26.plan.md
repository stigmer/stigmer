---
name: FGA Org-Only Authorization
overview: Simplify the FGA authorization model to org-only ownership, removing platform and identity_account scopes from all agentic resources while preserving the operator superuser pattern.
todos:
  - id: skill-fga
    content: Update skill.fga - Remove platform scope, simplify to org-only
    status: completed
  - id: mcpserver-fga
    content: Update mcp_server.fga - Remove platform and identity_account scopes
    status: completed
  - id: agent-fga
    content: Update agent.fga - Remove platform scope, simplify to org-only
    status: completed
  - id: workflow-fga
    content: Update workflow.fga - Remove platform scope, simplify to org-only
    status: completed
  - id: agent-instance-fga
    content: Update agent_instance.fga - Remove tri-scope, simplify to org-only
    status: completed
  - id: workflow-instance-fga
    content: Update workflow_instance.fga - Remove tri-scope, simplify to org-only
    status: completed
  - id: session-fga
    content: Update session.fga - Remove identity_account scope
    status: completed
  - id: workflow-execution-fga
    content: Update workflow_execution.fga - Remove identity_account scope
    status: completed
  - id: environment-fga
    content: Update environment.fga - Remove identity_account scope
    status: completed
  - id: validate-model
    content: Validate complete FGA model builds and links correctly
    status: completed
  - id: document-changes
    content: Update FGA model documentation with new patterns
    status: completed
isProject: false
---

# Phase 3.1: FGA Authorization Model Simplification

## Architectural Goal

Transform from tri-scope (platform/organization/identity_account) to **org-only** model:

```
BEFORE: resource#platform@platform:stigmer OR resource#organization@org:acme OR resource#identity_account@identity_account:alice
AFTER:  resource#organization@organization:acme (always) + resource#owner@identity_account:alice (attribution)
```

## Key Design Decisions

1. **Every resource belongs to an organization** - No platform scope, no user scope
2. **Platform operator remains superuser** - Operators can still access everything via `operator from platform`
3. **Visibility is NOT in FGA** - Public/private is an app-layer concern, not authorization
4. **Owner is for attribution, not scoping** - The `owner` relation identifies the creator, not the access scope

## Files to Modify

### Definition Resources (Priority 1 - MVP)


| File                                                                                                   | Current Scopes                           | New Model         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------- |
| [skill.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/skill.fga)           | platform, organization                   | organization only |
| [mcp_server.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/mcp_server.fga) | platform, organization, identity_account | organization only |
| [agent.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/agent.fga)           | platform, organization                   | organization only |
| [workflow.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/workflow.fga)     | platform, organization                   | organization only |


### Instance Resources (Priority 2)


| File                                                                                                                 | Current Scopes                           | New Model         |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ----------------- |
| [agent_instance.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/agent_instance.fga)       | platform, organization, identity_account | organization only |
| [workflow_instance.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/workflow_instance.fga) | platform, organization, identity_account | organization only |


### Execution Resources (Priority 3)


| File                                                                                                                   | Current Scopes                 | New Model                         |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------ | --------------------------------- |
| [session.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/session.fga)                       | organization, identity_account | organization only                 |
| [workflow_execution.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/workflow_execution.fga) | organization, identity_account | organization only                 |
| [environment.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/environment.fga)               | organization, identity_account | organization only                 |
| [agent_execution.fga](backend/services/stigmer-service/src/main/resources/fga/model/agentic/agent_execution.fga)       | session-inherited              | No change (inherits from session) |


### Foundation Resources (No Change)


| File                                                                                                           | Status                            |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| [platform.fga](backend/services/stigmer-service/src/main/resources/fga/model/platform.fga)                     | Keep as-is (operator definition)  |
| [organization.fga](backend/services/stigmer-service/src/main/resources/fga/model/tenancy/organization.fga)     | Keep as-is (foundation)           |
| [identity_account.fga](backend/services/stigmer-service/src/main/resources/fga/model/iam/identity_account.fga) | Keep as-is                        |
| [iam_policy.fga](backend/services/stigmer-service/src/main/resources/fga/model/iam/iam_policy.fga)             | Keep as-is (org-only)             |
| [api_key.fga](backend/services/stigmer-service/src/main/resources/fga/model/iam/api_key.fga)                   | Keep as-is (user-owned by design) |


## Target FGA Pattern (Template)

Every agentic resource will follow this simplified pattern:

```fga
type skill
  relations
    # Organization ownership (ONLY scope relation)
    define organization: [organization]
    
    # Operator superuser (from org's platform link)
    define operator: operator from organization
    
    # Owner (creator attribution, includes operators)
    define owner: [identity_account] or operator
    
    # Viewer (org members can view)
    define viewer: owner or member from organization
    
  # Permissions (simplified)
    define can_view: viewer
    define can_edit: owner
    define can_delete: owner
    define can_use: viewer
    
    # IAM management
    define can_grant_access: owner
    define can_view_access: viewer
```

**What's removed:**

- `define platform: [platform]` - No more platform scope
- `define identity_account: [identity_account]` - No more user scope
- `or platform` checks in permissions - Visibility handled in app layer

## Example Transformation: skill.fga

### Before (Current)

```fga
type skill
  relations
    define platform: [platform]           # REMOVE
    define organization: [organization]   # KEEP
    define operator: operator from platform or operator from organization  # SIMPLIFY
    define owner: [identity_account] or operator
    define viewer: owner or member from organization
    ...
```

### After (New)

```fga
type skill
  relations
    define organization: [organization]
    define operator: operator from organization
    define owner: [identity_account] or operator
    define viewer: owner or member from organization
    ...
```

## Example Transformation: mcp_server.fga (tri-scope to org-only)

### Before (Current)

```fga
type mcp_server
  relations
    define platform: [platform]                    # REMOVE
    define organization: [organization]            # KEEP
    define identity_account: [identity_account]    # REMOVE
    define operator: operator from platform or operator from organization or operator from identity_account  # SIMPLIFY
    define owner: [identity_account] or admin from organization or operator
    define viewer: owner or member from organization
    define can_view: viewer or platform            # REMOVE "or platform"
    define can_use: viewer or platform             # REMOVE "or platform"
    ...
```

### After (New)

```fga
type mcp_server
  relations
    define organization: [organization]
    define operator: operator from organization
    define owner: [identity_account] or admin from organization or operator
    define viewer: owner or member from organization
    define can_view: viewer
    define can_use: viewer
    ...
```

## Visibility Handling (App Layer)

The FGA model no longer handles public visibility. The Java service layer will:

```java
// When resolving cross-org resource access
if (!resource.getOrg().equals(callerOrg)) {
    if (resource.getVisibility() != ApiResourceVisibility.PUBLIC) {
        throw new ForbiddenException("Resource is private to its organization");
    }
    // Public resource - allow access without FGA check
}
// Same-org - proceed with FGA membership check
```

## Tuple Migration Strategy

Existing FGA tuples need migration:


| Current Tuple                                          | Migration Action                                    |
| ------------------------------------------------------ | --------------------------------------------------- |
| `skill:x#platform@platform:stigmer`                    | Delete (org tuple exists)                           |
| `skill:x#organization@organization:stigmer`            | Keep                                                |
| `mcp_server:x#identity_account@identity_account:alice` | Change to `#organization@organization:{user's-org}` |


## Verification Steps

After each file update:

1. `buf build` - Validate FGA model syntax
2. `buf lint` - Check for issues (if applicable)
3. Run FGA model tests
4. Verify operator superuser pattern still works

## Risks and Mitigations


| Risk                          | Mitigation                                      |
| ----------------------------- | ----------------------------------------------- |
| Breaking existing tuples      | Migration script before deployment              |
| Operator access broken        | Verify `operator from organization` chain works |
| Public resources inaccessible | App-layer visibility check must be added first  |


