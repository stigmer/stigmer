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
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The cross-edition org-mismatch contract copy (cloud MemoryPolicy;
// cloud-only — the sandbox credential exists only there).
const memoryCaptureOrgMismatchMessage = "memory capture is scoped to the session's organization"

// TestMemory_SandboxCapture proves the Stage 3 capture write path end to
// end (stigmer/stigmer#293 Phase 2 Stage 3, DD-005 D1/D2; the capture-gate
// and provenance decisions owner-ratified 2026-08-22): the remember tool's
// session-scoped SANDBOX credential — the one credential every runner
// shape holds when the tool fires — is admitted by the capture gate as its
// human subject, and the record it creates carries honest, server-verified
// attribution.
//
// The production path is: model → remember tool → mcp-server (/memory
// roster) → this create RPC with the sandbox Bearer + the runner-threaded
// capture context on the request. The mcp-server's own in-process
// integration test (domains/memory/memory.integration.test.ts) pins the
// tool → request mapping; THIS test pins what the cloud control plane does
// with that request:
//
//   - subject derived from the credential's sub (never the request);
//   - the runner-threaded agent/execution ids stored as provenance, the
//     session_id OVERRIDDEN by the token's own claim (server-proved beats
//     runner-reported), tool_call_id force-cleared (v1);
//   - metadata.org validated against the token's org claim — a forged org
//     is a refused cross-org write, not a routing choice;
//   - the double opt-in still enforced for sandbox callers (the tool
//     attachment is convenience, never authorization);
//   - the OTHER runner credential classes (workflow/connect/embedded)
//     stay refused — only the session sandbox is session-bound;
//   - and the full loop closes: a sandbox-captured fact, once confirmed
//     by its subject, is recalled into the subject's next execution.
func TestMemory_SandboxCapture(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness == nil || testHarness.Service == nil {
		t.Skip("Java service not running")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	machineClients := harness.NewClients(grpcConn)

	// A fresh org with the memory switch ON.
	orgSlug := "sandcap-org-" + uuid.New().String()[:8]
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

	// The human subject, opted in through the self-service lane, with org
	// membership (the recalled-memories recipe).
	account := harness.CreateIdentityAccount(t, ctx, machineClients,
		"sandcap-human", "sandcap-human@test.stigmer.ai")
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
	harness.GrantOrgRole(t, ctx, machineClients, orgID, accountID,
		"sandcap-human", "member")

	// The session-scoped sandbox credential, exactly as production mints it
	// for the subject's session: sub = the human, session_id bound, org =
	// the session's org.
	const provedSessionID = "ses-proved"
	sandboxToken, err := harness.MintSandboxTokenForOrg(accountID, provedSessionID, orgID)
	require.NoError(t, err, "mint session sandbox token")
	sandboxConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), sandboxToken)
	sandboxClients := harness.NewClients(sandboxConn)

	// The capture request as the remember tool builds it: the fact, org
	// addressing, and the runner-threaded context — including values the
	// server must override (session) or clear (tool_call_id).
	captureRequest := func(content string) *memoryv1.Memory {
		return &memoryv1.Memory{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Memory",
			Metadata:   &apiresource.ApiResourceMetadata{Org: orgID},
			Spec: &memoryv1.MemorySpec{
				Content: content,
				Provenance: &memoryv1.MemoryProvenance{
					AgentId:          "agt-threaded",
					SessionId:        "ses-runner-reported",
					AgentExecutionId: "aex-threaded",
					ToolCallId:       "call-invented",
				},
			},
		}
	}

	const capturedFact = "Works primarily in Go and prefers table-driven tests."
	var captured *memoryv1.Memory

	t.Run("sandbox capture derives subject and stores verified provenance", func(t *testing.T) {
		captured, err = sandboxClients.MemoryCommand.Create(ctx, captureRequest(capturedFact))
		require.NoError(t, err, "the session sandbox must pass the capture gate as its human subject")

		assert.Equal(t, accountID, captured.GetSpec().GetSubjectIdentityAccountId(),
			"the subject is the credential's sub — the human the session belongs to")

		prov := captured.GetSpec().GetProvenance()
		require.NotNil(t, prov, "the capture path's attribution must be stored")
		assert.Equal(t, "agt-threaded", prov.GetAgentId(), "runner-threaded agent id stored")
		assert.Equal(t, "aex-threaded", prov.GetAgentExecutionId(), "runner-threaded execution id stored")
		assert.Equal(t, provedSessionID, prov.GetSessionId(),
			"the token's session claim overrides the runner-reported value — server-proved beats runner-reported")
		assert.Empty(t, prov.GetToolCallId(), "tool_call_id is force-cleared in v1")

		assert.Equal(t, memoryv1.MemoryLifecycleState_lifecycle_state_proposed,
			captured.GetStatus().GetLifecycleState(),
			"capture creates a PROPOSAL — nothing recallable until the subject confirms")
	})

	t.Run("forged org on a sandbox capture is refused", func(t *testing.T) {
		otherToken, err := harness.MintSandboxTokenForOrg(accountID, provedSessionID, "some-other-org")
		require.NoError(t, err)
		otherConn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), otherToken)

		_, err = harness.NewClients(otherConn).MemoryCommand.Create(ctx,
			captureRequest("A fact aimed at an org the session does not belong to."))
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.PermissionDenied, st.Code())
		assert.Contains(t, st.Message(), memoryCaptureOrgMismatchMessage)
	})

	t.Run("session-less runner credentials stay refused", func(t *testing.T) {
		for _, tokenType := range []string{"workflow_sandbox", "connect_sandbox", "embedded_runner"} {
			token, err := harness.MintTokenOfType(accountID, tokenType)
			require.NoError(t, err)
			conn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)

			_, err = harness.NewClients(conn).MemoryCommand.Create(ctx,
				captureRequest("A fact from a runner shape with no session."))
			require.Error(t, err, "token_type=%s must be refused", tokenType)
			st, ok := status.FromError(err)
			require.True(t, ok)
			assert.Equal(t, codes.PermissionDenied, st.Code(), "token_type=%s", tokenType)
			assert.Contains(t, st.Message(), memoryCaptureCallerMessage, "token_type=%s", tokenType)
		}
	})

	t.Run("double opt-in gates sandbox capture too", func(t *testing.T) {
		// A second subject who never opted in: the org flag alone is not
		// consent, and the tool attachment is convenience, never
		// authorization — the server refuses.
		optedOut := harness.CreateIdentityAccount(t, ctx, machineClients,
			"sandcap-opted-out", "sandcap-opted-out@test.stigmer.ai")
		optedOutID := optedOut.GetMetadata().GetId()
		harness.GrantOrgRole(t, ctx, machineClients, orgID, optedOutID,
			"sandcap-opted-out", "member")

		token, err := harness.MintSandboxTokenForOrg(optedOutID, "ses-opted-out", orgID)
		require.NoError(t, err)
		conn := harness.GRPCConnWithBearer(t, testHarness.Service.GRPCAddress(), token)

		_, err = harness.NewClients(conn).MemoryCommand.Create(ctx,
			captureRequest("A fact about a subject who never opted in."))
		require.Error(t, err)
		st, ok := status.FromError(err)
		require.True(t, ok)
		assert.Equal(t, codes.FailedPrecondition, st.Code(),
			"an opted-out subject fails the enablement re-check, not the caller gate")
	})

	t.Run("the loop closes: confirmed sandbox capture is recalled next execution", func(t *testing.T) {
		// The consent act belongs to the SUBJECT (their plain human JWT),
		// exactly as the chip/memory page perform it.
		_, err := humanClients.MemoryCommand.Confirm(ctx,
			&memoryv1.MemoryId{Value: captured.GetMetadata().GetId()})
		require.NoError(t, err, "confirm the sandbox-captured fact")

		agent := harness.CreateAgentFull(t, ctx, machineClients, "test-sandbox-capture",
			"You are a test assistant. Respond briefly.",
			nil, []harness.AgentCreateOption{harness.WithAgentOrg(orgID)})

		exec, err := humanClients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "AgentExecution",
			Metadata:   &apiresource.ApiResourceMetadata{Name: "sandcap-recall-run", Org: orgID},
			Spec: &agentexecv1.AgentExecutionSpec{
				AgentId: agent.GetMetadata().GetId(),
				Message: "hello",
			},
		})
		require.NoError(t, err, "the subject's next execution")

		stamped := exec.GetSpec().GetRecalledMemories()
		require.NotNil(t, stamped)
		assert.True(t, stamped.GetEnabled(), "double opt-in satisfied: recall enabled")
		require.Len(t, stamped.GetFacts(), 1, "exactly the one confirmed fact")
		assert.Equal(t, captured.GetMetadata().GetId(), stamped.GetFacts()[0].GetMemoryId(),
			"the recalled fact links back to the sandbox-captured record")
		assert.Equal(t, capturedFact, stamped.GetFacts()[0].GetContent(), "verbatim")
	})
}
