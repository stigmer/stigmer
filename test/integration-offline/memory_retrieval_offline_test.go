//go:build integration

package offline

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	memoryv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/memory/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Lockstep pins for the runner's memory-retrieval module
// (backend/services/runner/src/shared/memory-retrieval.ts). A drift in
// either constant fails this suite loudly instead of silently changing the
// activation boundary or the audited model id.
const (
	// RETRIEVAL_K: selection activates only ABOVE this many candidates.
	retrievalActivationThreshold = 20
	// EMBEDDING_MODEL: the v1 embedder recorded on selection-active reports.
	retrievalEmbeddingModel = "text-embedding-3-small"
)

// TestOffline_MemoryRetrieval proves the Phase 3a semantic retriever
// (stigmer/stigmer#293, DD-008) end to end through a REAL runner against
// the mock proxy's deterministic embedder — the full loop from the consent
// lifecycle (capture + confirm via the front-door RPCs) through prompt
// build to the report on the persisted execution status:
//
//   - at or below the activation threshold the runner injects wholesale,
//     makes NO embeddings call, and reports selection_active=false;
//   - above the threshold it makes exactly ONE batched embeddings call
//     (query first, then every candidate), injects top-k, and reports the
//     injected subset as ids in snapshot order with the embedding model;
//   - when recall is disabled (member opt-out) nothing is injected and NO
//     report is written — absent report = wholesale, true by construction.
//
// The mock embedder's similarity decreases with input position (see
// MockLLMProxyServer.handleEmbeddings), so above-threshold selection is
// deterministic: exactly the first k snapshot facts.
func TestOffline_MemoryRetrieval(t *testing.T) {
	requireEvalPrereqs(t)

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	// One scripted chat response per execution below (the embeddings route
	// is computed, never scripted — it must not consume these entries).
	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicTextResponse("Done.", 120, 8)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse("Done.", 120, 8)),
		harness.BuildLLMEntry(2, harness.AnthropicTextResponse("Done.", 120, 8)),
	}
	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	machineClients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, machineClients)

	// A fresh org with memory ON — the org half of the double opt-in.
	orgSlug := "retrieval-org-" + uuid.New().String()[:8]
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

	// The user half: a real account opting in via self-service update, with
	// a plain human JWT — the one credential shape recall admits.
	account := harness.CreateIdentityAccount(t, ctx, machineClients,
		"retrieval-human", "retrieval-human@test.stigmer.ai")
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
	require.NoError(t, err, "opt the account into memory")

	harness.GrantOrgRole(t, ctx, machineClients, orgID, accountID,
		"retrieval-human", "member")

	agent := harness.CreateAgentFull(t, ctx, machineClients, "test-memory-retrieval",
		"You are a test assistant. Respond briefly.",
		nil, []harness.AgentCreateOption{harness.WithAgentOrg(orgID)})

	session := harness.CreateTestSessionWithOrg(t, ctx, humanClients,
		agent.GetStatus().GetDefaultInstanceId(), sessionv1.Harness_HARNESS_NATIVE,
		[]harness.SessionResourceOption{harness.WithSessionOrg(orgID)})
	sessionID := session.GetMetadata().GetId()

	_, err = mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	// captureAndConfirm runs the REAL consent lifecycle for one fact.
	captureAndConfirm := func(t *testing.T, content string) *memoryv1.Memory {
		t.Helper()
		memory, err := humanClients.MemoryCommand.Create(ctx, &memoryv1.Memory{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Memory",
			Metadata:   &apiresource.ApiResourceMetadata{Org: org.GetMetadata().GetSlug()},
			Spec:       &memoryv1.MemorySpec{Content: content},
		})
		require.NoError(t, err, "capture memory %q", content)
		_, err = humanClients.MemoryCommand.Confirm(ctx,
			&memoryv1.MemoryId{Value: memory.GetMetadata().GetId()})
		require.NoError(t, err, "confirm memory %q", content)
		return memory
	}

	runExecution := func(t *testing.T, name, message string) *agentexecv1.AgentExecution {
		t.Helper()
		exec := harness.CreateTestAgentExecutionWithOrg(t, ctx, humanClients,
			sessionID, message,
			[]harness.ExecutionResourceOption{harness.WithExecutionOrg(orgID)})
		waiter := harness.NewAgentExecutionWaiter(humanClients.AgentExecutionQuery, suiteLogger)
		result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
			agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 3*time.Minute)
		require.NoError(t, err, "%s execution should complete", name)
		return result
	}

	// Exactly the threshold count of confirmed facts: top-k degenerates to
	// wholesale AT the boundary, so this pins k itself, not just "few".
	for i := 0; i < retrievalActivationThreshold; i++ {
		captureAndConfirm(t, fmt.Sprintf("Durable fact number %02d about this user.", i))
	}

	t.Run("at the threshold: wholesale, no embeddings call, honest report", func(t *testing.T) {
		result := runExecution(t, "wholesale", "What should I deploy today?")

		snapshot := result.GetSpec().GetRecalledMemories()
		require.True(t, snapshot.GetEnabled(), "recall must be enabled for the opted-in human")
		require.Len(t, snapshot.GetFacts(), retrievalActivationThreshold,
			"the compose step stamps the full candidate set")

		report := result.GetStatus().GetRecalledMemoriesReport()
		require.NotNil(t, report, "an injecting execution always writes a report")
		assert.False(t, report.GetSelectionActive(),
			"at k candidates top-k degenerates to wholesale — selection must not activate")
		assert.Empty(t, report.GetInjectedMemoryIds(), "wholesale reports carry no ids")
		assert.Empty(t, report.GetEmbeddingModel(), "wholesale reports carry no model")

		assert.Empty(t, mockLLM.EmbeddingsRequests(),
			"at or below the threshold the runner must make NO embeddings call")
	})

	// One past the threshold: selection activates.
	captureAndConfirm(t, "The one fact past the activation threshold.")

	t.Run("above the threshold: one batched call, top-k report in snapshot order", func(t *testing.T) {
		const query = "Which region do we deploy the payments service to?"
		result := runExecution(t, "selection", query)

		snapshot := result.GetSpec().GetRecalledMemories()
		require.Len(t, snapshot.GetFacts(), retrievalActivationThreshold+1,
			"the candidate set stays wholesale on the spec — selection never rewrites the audit snapshot")

		report := result.GetStatus().GetRecalledMemoriesReport()
		require.NotNil(t, report, "selection-active executions must write a report")
		assert.True(t, report.GetSelectionActive())
		assert.Equal(t, retrievalEmbeddingModel, report.GetEmbeddingModel())
		require.Len(t, report.GetInjectedMemoryIds(), retrievalActivationThreshold,
			"exactly k facts injected")

		// The mock's similarity decreases with input position, so top-k is
		// the first k snapshot facts — and the report presents them in
		// snapshot (oldest-first) order, ids parallel to the snapshot.
		for i, id := range report.GetInjectedMemoryIds() {
			assert.Equal(t, snapshot.GetFacts()[i].GetMemoryId(), id,
				"injected id %d must be the snapshot's fact %d (snapshot-order presentation)", i, i)
		}

		embeds := mockLLM.EmbeddingsRequests()
		require.Len(t, embeds, 1, "exactly one batched embeddings call per selection-active execution")
		assert.Equal(t, retrievalEmbeddingModel, embeds[0]["model"])
		inputs, _ := embeds[0]["input"].([]any)
		require.Len(t, inputs, retrievalActivationThreshold+2,
			"one batch: the query plus every candidate fact")
		assert.Equal(t, query, inputs[0],
			"the query is the execution's message, sent first")
	})

	t.Run("opted-out member: nothing injected, NO report (absent = wholesale by construction)", func(t *testing.T) {
		optedOut, err := humanClients.IdentityAccountQuery.Get(ctx,
			&identityaccountv1.IdentityAccountId{Value: accountID})
		require.NoError(t, err, "load account for update")
		optedOut.Spec.Preferences = &identityaccountv1.IdentityAccountPreferences{
			MemoryEnabled: false,
		}
		_, err = humanClients.IdentityAccountCommand.Update(ctx, optedOut)
		require.NoError(t, err, "opt the account out of memory")

		result := runExecution(t, "opted-out", "hello again")

		assert.False(t, result.GetSpec().GetRecalledMemories().GetEnabled(),
			"the member's opt-out disables recall")
		assert.Nil(t, result.GetStatus().GetRecalledMemoriesReport(),
			"no injection, no report — pre-3a readers and this execution read identically")
		assert.Len(t, mockLLM.EmbeddingsRequests(), 1,
			"a disabled snapshot must never trigger an embeddings call")
	})
}
