//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
)

// This file is the run-observability companion to the blueprint/instance
// visibility suite. Workflow runs are PRIVATE-by-default personal resources
// hanging off a SHARED workflow_instance, so their privacy boundary is the
// execution's own owner — not the parent instance's visibility. Two distinct
// sharing axes exist and are proved end-to-end here through the real service +
// OpenFGA:
//
//  1. Per-execution share — the triggerer grants viewer on a single run via the
//     generic IamPolicy flow (the "Share" dialog). Requires the
//     workflow_execution FGA type to expose can_grant_access / can_view_access;
//     a regression here is exactly the "unauthorized to view resource access"
//     failure the Share panel surfaced before this was wired.
//  2. Instance-level run observability — the instance owner opts every run of an
//     instance into org-wide visibility via UpdateExecutionVisibility, which
//     writes the instance's execution_viewer tuple. Executions inherit it via
//     `execution_viewer from workflow_instance`, WITHOUT exposing the instance's
//     own private contents (the decoupling invariant).

const wfeKind = "workflow_execution"

// runExecutionForInstance triggers a run of the given workflow instance as the
// caller behind clients and returns the execution id. A noop (single set_vars)
// workflow makes the run terminal almost immediately; the authorization tuples
// (owner / organization / workflow_instance) are written at create time, so the
// access assertions do not depend on the run's phase.
func runExecutionForInstance(t *testing.T, ctx context.Context, c *harness.Clients, instanceID string) string {
	t.Helper()
	exec, err := c.ExecutionCommand.Create(ctx, &workflowexecutionv1.WorkflowExecution{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "WorkflowExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: uniqueVisibilityName("vis-wfx"),
			Org:  harness.TestOrg,
		},
		Spec: &workflowexecutionv1.WorkflowExecutionSpec{
			WorkflowInstanceId: instanceID,
			TriggerMessage:     "visibility test run",
		},
	})
	require.NoError(t, err, "create workflow execution")
	id := exec.GetMetadata().GetId()

	// Best-effort settle to a terminal phase so we never leave a runner busy.
	// The run is a noop; failure to reach terminal is not the subject under
	// test, so a timeout here is logged rather than fatal — the FGA tuples that
	// the assertions exercise already exist post-create.
	waiter := harness.NewExecutionWaiter(c.ExecutionQuery, suiteLogger)
	if _, err := waiter.WaitForPhase(ctx, id,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 60*time.Second); err != nil {
		t.Logf("execution %s did not reach COMPLETED (non-fatal for authz): %v", id, err)
	}
	return id
}

// requireExecutionRunner gates run-based tests on a live unified runner: a
// workflow_execution cannot be created without one. Combined with the FGA gate
// from requireVisibilityHarness, this keeps the suite honest rather than
// passing vacuously.
func requireExecutionRunner(t *testing.T) {
	t.Helper()
	if testHarness.UnifiedRunner == nil {
		t.Skip("workflow execution sharing requires a unified runner — skipping")
	}
}

// TestWorkflowExecutionPerExecutionSharing proves the per-run "Share" flow: the
// triggerer can view their run and enumerate its access list, a non-grantee
// cannot, and granting viewer via the generic IamPolicy flow makes exactly that
// grantee — and no one else — able to view the run. The owner's ability to call
// ListResourceAccessByPrincipal is the direct regression guard for the
// "unauthorized to view resource access" Share-panel bug: it requires
// can_view_access on workflow_execution, which only exists once the FGA type
// declares it.
func TestWorkflowExecutionPerExecutionSharing(t *testing.T) {
	requireVisibilityHarness(t)
	requireExecutionRunner(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	actors := newVisibilityActors(t, ctx)
	owner := actors.Owner()
	member := actors.Member()
	stranger := actors.Stranger()

	// A run hangs off a standalone, private instance so the only path to
	// viewing it is the per-execution grant — no instance-level inheritance.
	wf := createWorkflowBlueprint(t, ctx, owner.Clients)
	inst := createWorkflowInstanceFor(t, ctx, owner.Clients, wf.GetMetadata().GetId())
	execID := runExecutionForInstance(t, ctx, owner.Clients, inst.GetMetadata().GetId())

	// Baseline: the triggerer sees their run; teammates and outsiders do not.
	owner.RequireCanView(t, ctx, wfeKind, execID)
	member.RequireCannotView(t, ctx, wfeKind, execID)
	require.True(t, isAccessDenied(getExecution(ctx, member.Clients, execID)),
		"member Get on a private run must be denied")
	stranger.RequireCannotView(t, ctx, wfeKind, execID)

	// Regression guard: the triggerer can enumerate the run's access list. This
	// requires can_view_access on workflow_execution — its absence is exactly
	// what made the Share panel render "unauthorized to view resource access".
	access, err := owner.Clients.IamPolicyQuery.ListResourceAccessByPrincipal(ctx,
		&iampolicyv1.ListResourceAccessInput{
			Resource: &iampolicyv1.ApiResourceRef{Kind: wfeKind, Id: execID},
		})
	require.NoError(t, err, "owner must be able to view the run's resource access list")
	require.False(t, principalHasAccess(access, member.AccountID),
		"member should not appear in the access list before being granted")

	// A non-grantee must NOT be able to read the access list either.
	_, err = member.Clients.IamPolicyQuery.ListResourceAccessByPrincipal(ctx,
		&iampolicyv1.ListResourceAccessInput{
			Resource: &iampolicyv1.ApiResourceRef{Kind: wfeKind, Id: execID},
		})
	require.True(t, isAccessDenied(err),
		"member without access must be denied the run's access list")

	// Share the run with the member (the "Add people" action).
	grantViewer(t, ctx, owner.Clients, wfeKind, execID, member.AccountID)

	// The grantee can now view the run and shows up in the access list; the
	// outsider remains shut out.
	member.RequireCanView(t, ctx, wfeKind, execID)
	require.NoError(t, getExecution(ctx, member.Clients, execID), "granted member Get on the run")
	stranger.RequireCannotView(t, ctx, wfeKind, execID)

	access, err = owner.Clients.IamPolicyQuery.ListResourceAccessByPrincipal(ctx,
		&iampolicyv1.ListResourceAccessInput{
			Resource: &iampolicyv1.ApiResourceRef{Kind: wfeKind, Id: execID},
		})
	require.NoError(t, err, "owner re-reads the access list after granting")
	require.True(t, principalHasAccess(access, member.AccountID),
		"member should appear in the access list after being granted viewer")

	// Revoking restores privacy — the share is a reversible per-run grant.
	revokeViewer(t, ctx, owner.Clients, wfeKind, execID, member.AccountID)
	member.RequireCannotView(t, ctx, wfeKind, execID)
}

// TestWorkflowInstanceExecutionVisibilityToggle proves the instance-level run
// observability axis and, crucially, its decoupling from instance visibility.
// Flipping an instance's execution visibility to ORGANIZATION exposes every run
// of that instance to org members via the inherited execution_viewer relation —
// with zero per-execution writes — while the instance's own private contents
// stay hidden. Flipping back to PRIVATE revokes that observability.
func TestWorkflowInstanceExecutionVisibilityToggle(t *testing.T) {
	requireVisibilityHarness(t)
	requireExecutionRunner(t)
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	actors := newVisibilityActors(t, ctx)
	owner := actors.Owner()
	member := actors.Member()
	stranger := actors.Stranger()

	// Standalone, private instance (the create default for instances) with one
	// run already recorded.
	wf := createWorkflowBlueprint(t, ctx, owner.Clients)
	inst := createWorkflowInstanceFor(t, ctx, owner.Clients, wf.GetMetadata().GetId())
	instID := inst.GetMetadata().GetId()
	execID := runExecutionForInstance(t, ctx, owner.Clients, instID)

	// Default: run history is private to the triggerer. A teammate can neither
	// see the run nor the (private) instance.
	owner.RequireCanView(t, ctx, wfeKind, execID)
	member.RequireCannotView(t, ctx, wfeKind, execID)
	member.RequireCannotView(t, ctx, "workflow_instance", instID)
	stranger.RequireCannotView(t, ctx, wfeKind, execID)

	// Opt the instance into org-wide run observability.
	require.NoError(t, setExecutionVisibility(ctx, owner.Clients, instID,
		workflowinstancev1.WorkflowExecutionVisibility_workflow_execution_visibility_organization),
		"owner enables org run observability")

	// Every run of the instance — including the one created before the toggle —
	// is now viewable by org members; outsiders still are not.
	member.RequireCanView(t, ctx, wfeKind, execID)
	require.NoError(t, getExecution(ctx, member.Clients, execID), "member Get on org-observable run")
	stranger.RequireCannotView(t, ctx, wfeKind, execID)

	// Decoupling invariant: org run observability must NOT leak the instance's
	// own private contents. The member can see the RUN but not the INSTANCE.
	member.RequireCannotView(t, ctx, "workflow_instance", instID)

	// A run created AFTER the toggle is observable too — proving inheritance,
	// not a one-off backfill.
	laterExecID := runExecutionForInstance(t, ctx, owner.Clients, instID)
	member.RequireCanView(t, ctx, wfeKind, laterExecID)
	stranger.RequireCannotView(t, ctx, wfeKind, laterExecID)

	// Flipping back to private revokes observability for all runs.
	require.NoError(t, setExecutionVisibility(ctx, owner.Clients, instID,
		workflowinstancev1.WorkflowExecutionVisibility_workflow_execution_visibility_private),
		"owner disables org run observability")
	member.RequireCannotView(t, ctx, wfeKind, execID)
	member.RequireCannotView(t, ctx, wfeKind, laterExecID)
}

// ── Local helpers ───────────────────────────────────────────────────────────

func getExecution(ctx context.Context, c *harness.Clients, id string) error {
	_, err := c.ExecutionQuery.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: id})
	return err
}

func setExecutionVisibility(ctx context.Context, c *harness.Clients, instanceID string, v workflowinstancev1.WorkflowExecutionVisibility) error {
	_, err := c.InstanceCommand.UpdateExecutionVisibility(ctx, &workflowinstancev1.UpdateExecutionVisibilityInput{
		ResourceId:          instanceID,
		ExecutionVisibility: v,
	})
	return err
}

func grantViewer(t *testing.T, ctx context.Context, c *harness.Clients, kind, id, principalID string) {
	t.Helper()
	_, err := c.IamPolicyCommand.Create(ctx, &iampolicyv1.IamPolicySpec{
		Principal: &iampolicyv1.ApiResourceRef{Kind: "identity_account", Id: principalID},
		Resource:  &iampolicyv1.ApiResourceRef{Kind: kind, Id: id},
		Relation:  "viewer",
	})
	require.NoError(t, err, "grant viewer on %s:%s to %s", kind, id, principalID)
}

func revokeViewer(t *testing.T, ctx context.Context, c *harness.Clients, kind, id, principalID string) {
	t.Helper()
	_, err := c.IamPolicyCommand.Delete(ctx, &iampolicyv1.IamPolicySpec{
		Principal: &iampolicyv1.ApiResourceRef{Kind: "identity_account", Id: principalID},
		Resource:  &iampolicyv1.ApiResourceRef{Kind: kind, Id: id},
		Relation:  "viewer",
	})
	require.NoError(t, err, "revoke viewer on %s:%s from %s", kind, id, principalID)
}

// principalHasAccess reports whether the access list contains an entry for the
// given principal id.
func principalHasAccess(list *iampolicyv1.ResourceAccessByPrincipalList, principalID string) bool {
	for _, entry := range list.GetEntries() {
		if entry.GetPrincipal().GetId() == principalID {
			return true
		}
	}
	return false
}
