//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestAgentExecution_RecalledMemories proves the recall compose contract end
// to end through the real create pipeline (stigmer/stigmer#293 Phase 2
// Stage 2, DD-006 D2/D3), exercising the REAL consent lifecycle — capture
// via the create RPC, consent via the confirm RPC — never seeded rows:
//
//   - a first-party HUMAN operator with BOTH memory_enabled flags on gets
//     their CONFIRMED memories snapshotted onto the persisted execution
//     spec, oldest-first, each fact linking back to its record by id;
//     proposed records are never injected (the consent gate);
//   - a machine caller gets a DISABLED recalled_memories even when it
//     supplies one in the request — the field is server-owned, so the
//     injection is overwritten, never persisted;
//   - the member's own flag off means a disabled snapshot even though the
//     org enabled memory (double opt-in, DD-006 D1).
//
// The test never waits for the runner: the create RPC returns the stamped
// spec synchronously, and a follow-up Get confirms persistence.
func TestAgentExecution_RecalledMemories(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness == nil || testHarness.Service == nil {
		t.Skip("Java service not running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	const factOlder = "Deploys to us-east-1."
	const factNewer = "Prefers OpenTofu over Terraform."

	// The tokenless shared connection resolves to the synthetic MACHINE
	// caller in test security mode — it seeds fixtures here and doubles as
	// the excluded caller in the injection case below.
	machineClients := harness.NewClients(grpcConn)

	// A fresh org with the memory switch ON — the org half of the double
	// opt-in, and the capture gate's fail-closed enablement check.
	orgSlug := "recall-org-" + uuid.New().String()[:8]
	org, err := machineClients.OrganizationCommand.Create(ctx, &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Name: orgSlug},
		Spec: &organizationv1.OrganizationSpec{
			Preferences: &organizationv1.OrganizationPreferences{MemoryEnabled: true},
		},
	})
	require.NoError(t, err, "create org with memory enabled")
	orgID := org.GetMetadata().GetId()
	t.Cleanup(func() {
		cleanCtx, cancelClean := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancelClean()
		if _, err := machineClients.OrganizationCommand.Delete(cleanCtx, &organizationv1.OrganizationId{Value: orgID}); err != nil {
			t.Logf("warning: failed to clean up org %s: %v", orgID, err)
		}
	})

	// The user half of the double opt-in: a real IdentityAccount opting in
	// through the self-service update RPC, and a plain Stigmer JWT — the one
	// credential shape the strict gate admits (for capture AND recall).
	account := harness.CreateIdentityAccount(t, ctx, machineClients,
		"recall-human", "recall-human@test.stigmer.ai")
	accountID := account.GetMetadata().GetId()

	humanToken, err := harness.MintStigmerToken(
		harness.StigmerJWTSigningKeyBase64, "stigmer-signing-key-1", accountID)
	require.NoError(t, err, "mint plain human JWT")
	humanConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), humanToken)
	humanClients := harness.NewClients(humanConn)

	account.Spec.Preferences = &identityaccountv1.IdentityAccountPreferences{
		MemoryEnabled: true,
	}
	_, err = humanClients.IdentityAccountCommand.Update(ctx, account)
	require.NoError(t, err, "opt the account into memory (self-service update)")

	// The human needs org membership to create memories and executions in
	// the fresh org.
	harness.GrantOrgRole(t, ctx, machineClients, orgID, accountID,
		"recall-human", "member")

	agent := harness.CreateAgentFull(t, ctx, machineClients, "test-recalled-memories",
		"You are a test assistant. Respond briefly.",
		nil, []harness.AgentCreateOption{harness.WithAgentOrg(orgID)})

	// captureMemory runs the REAL capture path: the human proposes a fact
	// (subject derived from the credential — DD-005 D2).
	captureMemory := func(t *testing.T, content string) *memoryv1.Memory {
		t.Helper()
		memory, err := humanClients.MemoryCommand.Create(ctx, &memoryv1.Memory{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Memory",
			Metadata:   &apiresource.ApiResourceMetadata{Org: org.GetMetadata().GetSlug()},
			Spec:       &memoryv1.MemorySpec{Content: content},
		})
		require.NoError(t, err, "capture memory %q as the human subject", content)
		return memory
	}

	// The consent lifecycle, front door only: two facts confirmed (in
	// creation order, pinning the oldest-first recall), one left proposed.
	memOlder := captureMemory(t, factOlder)
	_, err = humanClients.MemoryCommand.Confirm(ctx,
		&memoryv1.MemoryId{Value: memOlder.GetMetadata().GetId()})
	require.NoError(t, err, "confirm the older memory (the consent act)")

	memNewer := captureMemory(t, factNewer)
	_, err = humanClients.MemoryCommand.Confirm(ctx,
		&memoryv1.MemoryId{Value: memNewer.GetMetadata().GetId()})
	require.NoError(t, err, "confirm the newer memory")

	memProposed := captureMemory(t, "An unconfirmed proposal that must never be recalled.")
	_ = memProposed // stays proposed on purpose — the consent-gate assertion

	t.Run("human with double opt-in recalls confirmed facts, oldest-first", func(t *testing.T) {
		exec, err := humanClients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "recall-human-run", Org: orgID},
			Spec: &agentexecv1.AgentExecutionSpec{
				AgentId: agent.GetMetadata().GetId(),
				Message: "hello",
			},
		})
		require.NoError(t, err, "human execution create")

		stamped := exec.GetSpec().GetRecalledMemories()
		require.NotNil(t, stamped, "recalled_memories must be stamped for an eligible caller")
		assert.True(t, stamped.GetEnabled(), "double opt-in satisfied: recall must be enabled")
		require.Len(t, stamped.GetFacts(), 2,
			"exactly the two CONFIRMED facts — the proposed record must never be injected")
		assert.Equal(t, memOlder.GetMetadata().GetId(), stamped.GetFacts()[0].GetMemoryId(),
			"facts are oldest-first (cross-edition ordering)")
		assert.Equal(t, factOlder, stamped.GetFacts()[0].GetContent(), "fact content, verbatim")
		assert.Equal(t, memNewer.GetMetadata().GetId(), stamped.GetFacts()[1].GetMemoryId())
		assert.Equal(t, factNewer, stamped.GetFacts()[1].GetContent())

		// The snapshot is persisted, not just echoed on the create response.
		persisted, err := humanClients.AgentExecutionQuery.Get(ctx,
			&agentexecv1.AgentExecutionId{Value: exec.GetMetadata().GetId()})
		require.NoError(t, err, "read back the persisted execution")
		recalled := persisted.GetSpec().GetRecalledMemories()
		assert.True(t, recalled.GetEnabled())
		require.Len(t, recalled.GetFacts(), 2)
		assert.Equal(t, factOlder, recalled.GetFacts()[0].GetContent())
		assert.Equal(t, factNewer, recalled.GetFacts()[1].GetContent())
	})

	t.Run("machine caller gets disabled snapshot even when injecting", func(t *testing.T) {
		exec, err := machineClients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "recall-machine-run", Org: orgID},
			Spec: &agentexecv1.AgentExecutionSpec{
				AgentId: agent.GetMetadata().GetId(),
				Message: "hello",
				// The injection attempt: the field is server-owned, so this
				// must be overwritten with a disabled snapshot — persisting
				// it would let any caller forge "memories" into prompts.
				RecalledMemories: &agentexecv1.RecalledMemories{
					Enabled: true,
					Facts: []*agentexecv1.RecalledMemoryFact{
						{MemoryId: "mem-injected", Content: "injected fact"},
					},
				},
			},
		})
		require.NoError(t, err, "machine execution create")

		stamped := exec.GetSpec().GetRecalledMemories()
		assert.False(t, stamped.GetEnabled(),
			"machine caller must not receive recall (strict gating), and the injected enabled bit must not survive")
		assert.Empty(t, stamped.GetFacts(),
			"the injected facts must not survive — the field is server-owned")

		persisted, err := machineClients.AgentExecutionQuery.Get(ctx,
			&agentexecv1.AgentExecutionId{Value: exec.GetMetadata().GetId()})
		require.NoError(t, err, "read back the persisted execution")
		assert.False(t, persisted.GetSpec().GetRecalledMemories().GetEnabled())
		assert.Empty(t, persisted.GetSpec().GetRecalledMemories().GetFacts())
	})

	t.Run("member flag off disables recall even though the org enabled memory (double opt-in)", func(t *testing.T) {
		// Opt back out through the same self-service lane (full-spec
		// update — load fresh so no other preference field is wiped).
		optedOut := persistedAccountForUpdate(t, ctx, humanClients, accountID)
		optedOut.Spec.Preferences = &identityaccountv1.IdentityAccountPreferences{
			MemoryEnabled: false,
		}
		_, err := humanClients.IdentityAccountCommand.Update(ctx, optedOut)
		require.NoError(t, err, "opt the account out of memory")

		exec, err := humanClients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "recall-opted-out-run", Org: orgID},
			Spec: &agentexecv1.AgentExecutionSpec{
				AgentId: agent.GetMetadata().GetId(),
				Message: "hello",
			},
		})
		require.NoError(t, err, "opted-out execution create")

		stamped := exec.GetSpec().GetRecalledMemories()
		assert.False(t, stamped.GetEnabled(),
			"the member's own opt-out must disable recall — the org flag alone is not consent")
		assert.Empty(t, stamped.GetFacts(),
			"confirmed records exist but must not be injected for an opted-out member")
	})
}
