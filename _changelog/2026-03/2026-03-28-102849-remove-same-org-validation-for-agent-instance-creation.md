# Remove Same-Org Validation for AgentInstance Creation

**Date**: March 28, 2026

## Summary

Removed the `ValidateSameOrgBusinessRule` from the AgentInstance creation pipeline. This hardcoded check was blocking cross-org instance creation for public agents, which is the intended marketplace use case. FGA's `can_create_instance` permission on the parent Agent is now the sole authorization gate, correctly handling both public and private agents.

## Problem Statement

When a user in org `suresh` tried to create an AgentInstance from a public Agent owned by org `stigmer`, the request was rejected with: *"Cannot create instance of agent in a different organization."*

### Pain Points

- Public agents could not be "installed" (instantiated) by users in other organizations
- The marketplace / shared-agent pattern was completely broken for cross-org usage
- The validation was redundant with the FGA authorization check that already governs access correctly

## Solution

Removed the `ValidateSameOrgBusinessRule` pipeline step entirely, relying on FGA as the single source of truth for authorization. The FGA model (`agent.fga`) already defines `can_create_instance: can_execute or member from organization`, which correctly handles both cases:

- **Public agents**: Wildcard tuple `identity_account:*` grants all authenticated users `can_create_instance`
- **Private agents**: Only org members and the agent owner pass the FGA check

## Implementation Details

### stigmer-cloud (Java backend)

**File**: `AgentInstanceCreateHandler.java`
- Removed `ValidateSameOrgBusinessRule` inner class (Spring `@Component` implementing `RequestPipelineStepV2`)
- Removed the field injection and pipeline step registration
- Updated Javadoc to document cross-org instance creation and FGA-only authorization
- Renumbered pipeline steps (13 → 12 steps)

### stigmer (Proto definitions + stubs)

**File**: `command.proto` (`agentinstance/v1`)
- Updated `create` RPC comments to document public/private agent authorization model
- Removed references to contextual tuples and same-org validation
- Regenerated all stubs (Go, Java, Python, TypeScript, Dart)

### What was NOT changed

- **FGA model**: No changes needed — `agent.fga` already handles this correctly
- **OSS Go backend**: Already had no same-org check
- **WorkflowInstance**: Same-org rule left intact — workflows are a separate resource type
- **`LoadParentAgent` step**: Retained — still needed by `AuthorizeCreation`

## Benefits

- Users can now create AgentInstances from public agents owned by any organization
- Enables the marketplace / shared-agent pattern that is fundamental to the platform
- Eliminates a redundant validation that was inconsistent with the FGA authorization model
- Simplifies the pipeline by removing one step

## Impact

- **Users**: Can now "install" public agents from other organizations
- **Platform**: Unblocks the cross-org agent sharing model
- **Security**: No regression — FGA correctly blocks unauthorized access for private agents

## Related Work

- FGA model: `agent.fga` defines `can_create_instance` permission
- Agent visibility: `AgentUpdateVisibilityHandler` manages public/private toggle via FGA wildcard tuples

---

**Status**: Production Ready
