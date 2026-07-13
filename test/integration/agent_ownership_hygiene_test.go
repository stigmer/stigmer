//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	agentsharev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentshare/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// This file covers T08 — ownership + lifecycle hygiene:
//
//  1. Org-admin owner inheritance (FGA model: blueprint `owner` composes
//     `admin from organization`): an org admin manages any member's agent
//     and its shares; a revoked admin loses that on the next check; the
//     personal kinds (instances, sessions) stay admin-excluded.
//  2. Agent delete cascade: the system-managed default instance and every
//     AgentShare of the agent are deleted with it, so a recreate at the
//     same org/slug — by ANY principal — starts clean (the DD-010
//     recreate-abort and the stale-share rebind hazard are both gone).
//
// The inheritance tests require FGA and skip on the OSS backend; the
// single-principal cascade test runs against both editions (dual-edition
// contract).

// requireFGAEnforcement skips the test unless the harness runs with FGA
// enforcement — ownership inheritance is meaningless in the single-user OSS
// edition. (Distinct from fga_model_test.go's requireFGA, which returns the
// raw OpenFGA container for direct check-API probing.)
func requireFGAEnforcement(t *testing.T) {
	t.Helper()
	if testHarness == nil || !testHarness.FGAEnabled() {
		t.Skip("FGA not enabled — skipping ownership inheritance test")
	}
	require.NotNil(t, grpcConn)
}

// TestOrgAdminInheritance_OwnerManagesAdminsAgent reproduces DD-010's
// production incident on the fixed model: an org ADMIN authors a PRIVATE
// agent (blueprint creation is admin-gated — can_create_agent: admin), and
// the org OWNER — a different principal, exactly the suresh-vs-operator
// case — now holds full management through the `admin from organization`
// composition, exercised through the real mutation pipeline, not just the
// permission check. Plain members and strangers stay denied.
func TestOrgAdminInheritance_OwnerManagesAdminsAgent(t *testing.T) {
	requireFGAEnforcement(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	actors := harness.NewActors(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
	owner := actors.Owner()
	admin := actors.Admin()
	member := actors.Member()
	stranger := actors.Stranger()

	// The admin authors a PRIVATE agent — the strictest visibility level.
	agent := harness.CreateAgentFull(t, ctx, admin.Clients, "test-admin-inheritance",
		"You are a test agent for org-admin inheritance verification.",
		nil,
		[]harness.AgentCreateOption{func(a *agentv1.Agent) {
			a.Metadata.Visibility = apiresource.ApiResourceVisibility_visibility_private
		}})
	agentID := agent.GetMetadata().GetId()

	// Permission verdicts through the production self-check RPC: the org
	// owner (NOT the creator) inherits full management — and, deliberately,
	// visibility of the private blueprint. Plain membership conveys nothing.
	owner.RequirePermission(t, ctx, "agent", agentID, "can_view", true)
	owner.RequirePermission(t, ctx, "agent", agentID, "can_edit", true)
	owner.RequirePermission(t, ctx, "agent", agentID, "can_delete", true)
	owner.RequirePermission(t, ctx, "agent", agentID, "can_grant_access", true)
	member.RequirePermission(t, ctx, "agent", agentID, "can_view", false)
	member.RequirePermission(t, ctx, "agent", agentID, "can_edit", false)
	stranger.RequirePermission(t, ctx, "agent", agentID, "can_view", false)
	stranger.RequirePermission(t, ctx, "agent", agentID, "can_edit", false)

	// The owner performs a REAL mutation on the admin's agent: an update
	// through the standard can_edit-gated pipeline — the exact call DD-010
	// recorded as PERMISSION_DENIED in production.
	updated := agent
	updated.Spec.Description = "Updated by the org owner (T08 inheritance)"
	got, err := owner.Clients.AgentCommand.Update(ctx, updated)
	require.NoError(t, err, "org owner must be able to update an admin's agent")
	assert.Equal(t, "Updated by the org owner (T08 inheritance)", got.GetSpec().GetDescription())

	// The owner manages the agent's distribution channel too: share create is
	// gated on the referenced agent's can_edit, and the share's own owner
	// composition admits org admins afterward.
	share := shareFor(got, true)
	applied, err := owner.Clients.AgentShareCommand.Apply(ctx, share)
	require.NoError(t, err, "org owner must be able to share an admin's agent")
	owner.RequirePermission(t, ctx, "agent_share", applied.GetMetadata().GetId(), "can_edit", true)

	// Personal kinds stay excluded: the admin's default instance is not
	// editable even by the org owner (pristine-default-instance design;
	// DD-011 — instances never inherit).
	defaultInstanceID := got.GetStatus().GetDefaultInstanceId()
	require.NotEmpty(t, defaultInstanceID, "agent must carry its default instance id")
	owner.RequirePermission(t, ctx, "agent_instance", defaultInstanceID, "can_edit", false)
}

// TestOrgAdminInheritance_RevokedAdminLosesManagement proves inheritance is
// live: deleting the admin role tuple removes the inherited ownership on the
// very next check — no stamped state survives the revocation. The agent is
// authored by the org OWNER, so the revoked admin held access purely through
// the composition (the creator's direct owner tuple would otherwise mask the
// revocation).
func TestOrgAdminInheritance_RevokedAdminLosesManagement(t *testing.T) {
	requireFGAEnforcement(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	actors := harness.NewActors(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
	admin := actors.Admin()

	agent := harness.CreateAgent(t, ctx, clients, "test-admin-revocation",
		"You are a test agent for admin revocation verification.")
	agentID := agent.GetMetadata().GetId()

	admin.RequirePermission(t, ctx, "agent", agentID, "can_edit", true)

	// Revoke the admin role through the real IamPolicy pipeline, so the FGA
	// tuple the inheritance traverses is genuinely gone.
	_, err := clients.IamPolicyCommand.Delete(ctx, &iampolicyv1.IamPolicySpec{
		Principal: &iampolicyv1.ApiResourceRef{Kind: "identity_account", Id: admin.AccountID},
		Resource:  &iampolicyv1.ApiResourceRef{Kind: "organization", Id: harness.TestOrg},
		Relation:  "admin",
	})
	require.NoError(t, err, "revoking the admin role should succeed")

	admin.RequirePermission(t, ctx, "agent", agentID, "can_edit", false)
	admin.RequirePermission(t, ctx, "agent", agentID, "can_delete", false)
}

// TestAgentDeleteCascade_DefaultInstanceAndShares pins the dual-edition
// delete contract: deleting an agent removes its system-managed default
// instance and every AgentShare referencing it (including a renamed share),
// while a personal instance of the same agent survives as an inert dangling
// reference. Runs against both editions — no FGA dependency.
func TestAgentDeleteCascade_DefaultInstanceAndShares(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-delete-cascade",
		"You are a test agent for delete cascade verification.")
	agentID := agent.GetMetadata().GetId()
	defaultInstanceID := agent.GetStatus().GetDefaultInstanceId()
	require.NotEmpty(t, defaultInstanceID, "agent create must provision the default instance")

	// A personal instance of the SAME agent — must survive the cascade.
	personal, err := clients.AgentInstanceCommand.Apply(ctx, &agentinstancev1.AgentInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "my-personal-" + agent.GetMetadata().GetSlug(),
			Org:  agent.GetMetadata().GetOrg(),
		},
		Spec: &agentinstancev1.AgentInstanceSpec{
			AgentId:     agentID,
			Description: "Personal instance that must survive the cascade",
		},
	})
	require.NoError(t, err, "creating a personal instance should succeed")

	// The canonical share plus a renamed one (own slug diverged from the
	// agent's; still matched through spec.agent_ref — DD-011 D2).
	canonical := applyShare(t, ctx, clients, shareFor(agent, true))
	renamed := shareFor(agent, true)
	renamed.Metadata = &apiresource.ApiResourceMetadata{
		Name: "customer-demo-" + agent.GetMetadata().GetSlug(),
		Org:  agent.GetMetadata().GetOrg(),
	}
	renamedApplied := applyShare(t, ctx, clients, renamed)
	require.NotEqual(t, canonical.GetMetadata().GetId(), renamedApplied.GetMetadata().GetId(),
		"the renamed share must be a second AgentShare row")

	// Delete the agent.
	_, err = clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: agentID})
	require.NoError(t, err, "agent delete should succeed")

	// Default instance: gone.
	_, err = clients.AgentInstanceQuery.Get(ctx, &agentinstancev1.AgentInstanceId{Value: defaultInstanceID})
	require.Error(t, err, "the default instance must be cascade-deleted")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.NotFound, st.Code(),
		"deleted default instance should be NOT_FOUND, got %s", st.Code())

	// Both shares: gone.
	for _, shareID := range []string{canonical.GetMetadata().GetId(), renamedApplied.GetMetadata().GetId()} {
		_, err = clients.AgentShareQuery.Get(ctx, &agentsharev1.AgentShareId{Value: shareID})
		require.Error(t, err, "share %s must be cascade-deleted", shareID)
		st, ok = status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.NotFound, st.Code())
	}

	// Personal instance: survives (inert dangling reference by design).
	survived, err := clients.AgentInstanceQuery.Get(ctx,
		&agentinstancev1.AgentInstanceId{Value: personal.GetMetadata().GetId()})
	require.NoError(t, err, "a personal instance must survive the agent delete")
	assert.Equal(t, agentID, survived.GetSpec().GetAgentId())
}

// TestAgentDeleteCascade_CrossPrincipalRecreate reproduces the exact DD-010
// production incident end to end, on the fixed code: principal A creates an
// agent, deletes it (cascade), and principal B recreates the SAME org/slug —
// which used to abort mid-pipeline on the orphaned default instance's
// can_edit check and now succeeds cleanly with a fresh default instance.
func TestAgentDeleteCascade_CrossPrincipalRecreate(t *testing.T) {
	requireFGAEnforcement(t)

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	actors := harness.NewActors(t, ctx, grpcConn, testHarness.Service.GRPCAddress())
	admin := actors.Admin()

	// Principal A (the org owner) creates and deletes the agent.
	original := harness.CreateAgent(t, ctx, clients, "test-cross-principal-recreate",
		"You are a test agent for cross-principal recreate verification.")
	name := original.GetMetadata().GetName()
	slug := original.GetMetadata().GetSlug()
	require.NotEmpty(t, original.GetStatus().GetDefaultInstanceId())

	_, err := clients.AgentCommand.Delete(ctx, &agentv1.AgentId{Value: original.GetMetadata().GetId()})
	require.NoError(t, err, "delete by the creator should succeed")

	// Principal B (the org admin, a DIFFERENT identity) recreates the same
	// org/slug. Pre-T08 this aborted: the create pipeline's apply routed to
	// UPDATE on the orphaned `<slug>-default` instance and failed can_edit,
	// leaving a half-created agent with no default_instance_id.
	recreated, err := admin.Clients.AgentCommand.Apply(ctx, &agentv1.Agent{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  harness.TestOrg,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Recreated by a different principal after delete",
			Instructions: "You are a test agent for cross-principal recreate verification.",
		},
	})
	require.NoError(t, err,
		"a different principal must be able to recreate a deleted agent at the same slug")
	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = admin.Clients.AgentCommand.Delete(cleanCtx,
			&agentv1.AgentId{Value: recreated.GetMetadata().GetId()})
	})

	assert.Equal(t, slug, recreated.GetMetadata().GetSlug(), "recreate must land on the same slug")
	assert.NotEqual(t, original.GetMetadata().GetId(), recreated.GetMetadata().GetId(),
		"recreate must mint a fresh agent id")
	require.NotEmpty(t, recreated.GetStatus().GetDefaultInstanceId(),
		"the recreated agent must have a fresh, fully-linked default instance")
	assert.NotEqual(t, original.GetStatus().GetDefaultInstanceId(),
		recreated.GetStatus().GetDefaultInstanceId(),
		"the default instance must be fresh, not a recovered orphan")
}
