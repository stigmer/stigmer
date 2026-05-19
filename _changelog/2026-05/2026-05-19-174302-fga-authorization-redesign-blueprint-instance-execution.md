# FGA Authorization Redesign: Blueprint / Instance / Execution Visibility

**Date**: May 19, 2026

## Summary

Redesigned the OpenFGA authorization model for the three-tier resource hierarchy (blueprint, instance, execution) to support configurable per-instance visibility and parent-based execution inheritance. Instances now support a visibility spectrum (private / org / public) controlled entirely by which FGA tuples are written, following the Google Zanzibar pattern. Workflow executions inherit visibility from their parent instance, enabling zero-tuple-per-execution shared observability.

## Problem Statement

The existing FGA model treated all instances (AgentInstance, WorkflowInstance) as "personal resources" with owner-only access. There was no way to express "all org members can view this workflow instance and its executions." Workflow executions were disconnected from their parent instance, meaning every execution required individual viewer grants for shared observability. Additionally, default instances for public blueprints were created with public visibility, which meant blueprint creators could theoretically see other users' execution data.

### Pain Points

- Support triage teams had no way to share execution visibility across the team without per-user, per-execution grants
- Workflow executions had no `workflow_instance` relation, so inheritance was impossible
- Default instances were publicly visible, creating a privacy concern for execution data
- The README documented "visibility is app-layer" while the model already used FGA conditional wildcards, creating confusion

## Solution

Introduced a tuple-driven visibility model where instance visibility is controlled by which FGA tuples are written on the `viewer` relation. The FGA model accepts multiple principal types (`identity_account`, `identity_account:*`, `organization#member`, `organization#viewer`) so the application layer can set the appropriate level per-instance without model changes.

## Implementation Details

**FGA Model Changes (stigmer-cloud):**
- `agent_instance.fga` and `workflow_instance.fga`: Added `organization#member` and `organization#viewer` as accepted principal types in the viewer relation, alongside existing `identity_account` and `identity_account:* with allow_public`
- `workflow_execution.fga`: Added `workflow_instance` relation and `viewer from workflow_instance` for parent-based visibility inheritance. Removed org admin from owner (execution owner is the triggerer)
- `session.fga`: Added `agent_instance` relation for audit trail. Viewer remains personal (no instance inheritance) to preserve conversation privacy

**Backend Changes (stigmer-cloud):**
- `IamPolicyCreationService`: Added `createOrgVisibilityTuple()` and `deleteOrgVisibilityTuple()` methods that write OpenFGA userset tuples using `ApiResourceRef.relation` (e.g., `organization:acme#member`)
- `CreateAuthorizationTuplesStepV2`: Extended to handle ORG visibility via `stigmer.ai/visibility-org` label as interim mechanism
- `DefaultAgentInstanceFactory`: Changed default instance visibility from `visibility_public` to `visibility_private`, added `stigmer.ai/system-managed` label
- `WorkflowCreateHandler`: Same default instance changes for workflows

**Documentation:**
- Complete rewrite of FGA model README documenting the three-tier authorization model, visibility spectrum, agent/workflow asymmetry, and default instance behavior

## Benefits

- **Zero-tuple observability**: Org-visible workflow instances automatically share execution visibility with all org members. No per-execution tuples needed
- **Privacy by default**: Default instances are private. Users of public blueprints only see their own executions
- **Composable visibility**: The same FGA model supports private, org-wide, and public visibility through tuple presence alone
- **Infrastructure ready**: The userset tuple format (`organization:acme#member`) was already supported by `OpenFgaFormatBuilder` but never used. The new methods just wire it up

## Impact

- **Workflow teams**: Can now create org-visible instances where all members see all executions (the support triage scenario)
- **Agent users**: Conversations remain private by design, even when using org-visible agent instances
- **Platform security**: Default instances no longer leak visibility to blueprint creators

## Related Work

- Built on the existing `allow_public` conditional wildcard pattern for blueprint visibility
- Teams concept deferred for future work (individual + org-wide visibility covers day-one needs)
- Proto enum extension (`visibility_org`) needed for clean integration (interim: label-based)

---

**Status**: Production Ready
**Timeline**: Single session
