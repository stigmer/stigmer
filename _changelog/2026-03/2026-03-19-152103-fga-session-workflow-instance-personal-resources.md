# FGA: Make Sessions and Workflow Instances Personal Resources

**Date**: March 19, 2026

## Summary

Extended the personal-resource authorization pattern to session and workflow instance FGA models, removing implicit admin access. This completes the consistent application of the pattern that was first introduced for environment and agent instance resources.

## Problem Statement

After completing the environment and agent instance personal-resource FGA changes (commit `5fd98510`), two additional resource types -- session and workflow instance -- still had `admin from organization` in their `owner` relation. This meant org admins could implicitly access private conversations and workflow configurations created by other users.

### Pain Points

- Org admins had implicit ownership of all user sessions (private conversations)
- Org admins had implicit ownership of all workflow instances (containing secrets and credentials)
- Inconsistency: environment and agent instance were personal resources, but session and workflow instance were not

## Solution

Applied the same owner-relation change to `session.fga` and `workflow_instance.fga`:

```
# Before
define owner: [identity_account] or admin from organization or operator

# After
define owner: [identity_account] or operator
```

## Implementation Details

Two FGA model files updated in stigmer-cloud:

- **`session.fga`**: Removed `admin from organization` from owner. Updated header and ownership comments to reflect "Personal Resource" authorization model. Sessions are private conversations that admins have no business accessing.
- **`workflow_instance.fga`**: Same change. Workflow instances contain encrypted secrets and configuration -- admin access was inappropriate.

Both files now follow the exact pattern established by `environment.fga` and `agent_instance.fga`.

## Benefits

- **Privacy**: User conversations (sessions) are now truly private -- only the creator, operators, and explicitly granted users can view them
- **Security**: Workflow instance secrets are no longer implicitly accessible to org admins
- **Consistency**: All four personal resource types (environment, agent instance, session, workflow instance) now share the same authorization model

## Impact

- **Users**: Sessions and workflow instances created by users are no longer visible to org admins by default
- **Admins**: Org admins lose implicit access to sessions and workflow instances; they must be explicitly granted viewer access
- **Operators**: Platform operators retain access via the operator relation (unchanged)
- **FGA model**: Four resource types now consistently use the personal-resource pattern

## Related Work

- [FGA Personal Resources Auth Model](2026-03-19-134605-fga-personal-resources-auth-model.md) -- initial personal-resource changes for environment and agent instance
- [Creator Tuple and GetSecretValue RPC](2026-03-19-141116-creator-tuple-and-get-secret-value-rpc.md) -- creator relation and secret retrieval
- Parent project: `20260319.02.agent-picker-personal-env`
- Sub-project: `20260319.03.sp.env-auth-and-secret-redaction`

---

**Status**: Production Ready
**Commit**: `ee8ea772` (stigmer-cloud)
