//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
	rpcpb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/rpc"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAgentExecution_Billing_CreditDebit(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			balanceBefore, err := clients.BillingQuery.GetCreditBalance(ctx, &billingv1.GetCreditBalanceInput{
				OrgId: "test-org",
			})
			require.NoError(t, err, "get credit balance before should succeed")
			t.Logf("balance before: available=%d, reserved=%d, total=%d",
				balanceBefore.GetAvailableMicros(),
				balanceBefore.GetReservedMicros(),
				balanceBefore.GetTotalMicros())

			agent := harness.CreateAgent(t, ctx, clients, "test-billing-debit-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), "Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err = waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			// Allow a brief settling period for async billing finalization
			time.Sleep(2 * time.Second)

			balanceAfter, err := clients.BillingQuery.GetCreditBalance(ctx, &billingv1.GetCreditBalanceInput{
				OrgId: "test-org",
			})
			require.NoError(t, err, "get credit balance after should succeed")
			t.Logf("balance after: available=%d, reserved=%d, total=%d",
				balanceAfter.GetAvailableMicros(),
				balanceAfter.GetReservedMicros(),
				balanceAfter.GetTotalMicros())

			// With proxy enabled, per-call usage_debit entries consume credits.
			// Total balance must strictly decrease by the actual LLM cost.
			assert.Less(t, balanceAfter.GetTotalMicros(), balanceBefore.GetTotalMicros(),
				"total balance should decrease after proxied execution (usage_debit entries consume credits)")
		})
	}
}

func TestAgentExecution_Billing_LedgerAuditTrail(t *testing.T) {
	require.NotNil(t, grpcConn)

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-billing-ledger-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(), "Reply with exactly: hello")
			executionID := exec.GetMetadata().GetId()

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			_, err := waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution should complete")

			time.Sleep(2 * time.Second)

			ledger, err := clients.BillingQuery.GetCreditLedger(ctx, &billingv1.GetCreditLedgerInput{
				OrgId: "test-org",
				Page:  &rpcpb.PageInfo{Size: 100},
			})
			require.NoError(t, err, "get credit ledger should succeed")
			require.NotEmpty(t, ledger.GetEntries(), "ledger should have entries")

			var hasReservationHold, hasReservationRelease bool
			var usageDebitCount int
			for _, entry := range ledger.GetEntries() {
				src := entry.GetSource()
				if src == nil || src.GetExecutionId() != executionID {
					continue
				}

				switch entry.GetType() {
				case billingv1.LedgerEntryType_reservation_hold:
					hasReservationHold = true
					assert.Less(t, entry.GetAmountMicros(), int64(0),
						"reservation_hold should have negative amount")
					assert.NotEmpty(t, entry.GetEntryId())
					assert.NotNil(t, entry.GetCreatedAt())
					t.Logf("found reservation_hold: amount=%d, entry=%s",
						entry.GetAmountMicros(), entry.GetEntryId())

				case billingv1.LedgerEntryType_reservation_release:
					hasReservationRelease = true
					assert.GreaterOrEqual(t, entry.GetAmountMicros(), int64(0),
						"reservation_release should have non-negative amount")
					t.Logf("found reservation_release: amount=%d, entry=%s",
						entry.GetAmountMicros(), entry.GetEntryId())

				case billingv1.LedgerEntryType_usage_debit:
					usageDebitCount++
					t.Logf("found usage_debit: amount=%d, seq=%d, entry=%s",
						entry.GetAmountMicros(), src.GetLlmCallSequence(), entry.GetEntryId())
				}
			}

			assert.True(t, hasReservationHold, "ledger should contain a reservation_hold entry for this execution")
			assert.True(t, hasReservationRelease, "ledger should contain a reservation_release entry for this execution")
			assert.Greater(t, usageDebitCount, 0,
				"ledger should contain at least one usage_debit entry (proxy metering)")
		})
	}
}

func TestAgentExecution_Billing_NoCreditsBlocked(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	// Provision an org with zero credits: create billing account but don't add any.
	noCreditsOrg := "test-org-no-credits"

	// Seed FGA tuples so the test identity has ownership of this org,
	// otherwise the billing RPC is denied by the authorization layer.
	if testHarness.OpenFGA != nil {
		err := testHarness.OpenFGA.WriteTuples(ctx, []harness.RelationshipTuple{
			{User: "identity_account:test-identity-account-id", Relation: "owner", Object: "organization:" + noCreditsOrg},
		})
		require.NoError(t, err, "seed FGA tuples for no-credits org")
	}

	_, err := clients.BillingCommand.GetOrCreateBillingAccount(ctx, &billingv1.GetOrCreateBillingAccountInput{
		OrgId: noCreditsOrg,
	})
	require.NoError(t, err, "create billing account for zero-credits org should succeed")

	// Pick the first available harness
	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			testCtx, testCancel := context.WithTimeout(context.Background(), 3*time.Minute)
			defer testCancel()

			agent := harness.CreateAgent(t, testCtx, clients, "test-no-credits-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, testCtx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, testCtx, clients,
				session.GetMetadata().GetId(), "Reply with exactly: hello")

			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
			result, err := waiter.WaitForTerminal(testCtx, exec.GetMetadata().GetId(), 2*time.Minute)
			require.NoError(t, err, "execution should reach a terminal phase")

			// Execution should fail due to billing denial (insufficient credits)
			phase := result.GetStatus().GetPhase()
			assert.True(t,
				phase == agentexecv1.ExecutionPhase_EXECUTION_FAILED ||
					phase == agentexecv1.ExecutionPhase_EXECUTION_TERMINATED,
				"execution with zero credits should fail or terminate, got %s", phase.String())

			t.Logf("zero-credits test: phase=%s, id=%s", phase.String(), exec.GetMetadata().GetId())
		})
		break
	}
}
