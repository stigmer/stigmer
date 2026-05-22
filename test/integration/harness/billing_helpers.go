package harness

import (
	"context"
	"testing"
	"time"

	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
	rpcpb "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/rpc"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// AssertProxyMetered verifies that the given execution produced at least one
// usage_debit ledger entry, confirming LLM calls were routed through the
// proxy and the billing pipeline recorded per-call usage.
//
// Call this after execution reaches a terminal phase and a brief settling
// period has elapsed (billing finalization is async).
func AssertProxyMetered(t *testing.T, ctx context.Context, clients *Clients, executionID string) {
	t.Helper()

	time.Sleep(2 * time.Second)

	ledger, err := clients.BillingQuery.GetCreditLedger(ctx, &billingv1.GetCreditLedgerInput{
		OrgId: TestOrg,
		Page:  &rpcpb.PageInfo{Size: 100},
	})
	require.NoError(t, err, "get credit ledger should succeed")

	var debitCount int
	for _, entry := range ledger.GetEntries() {
		src := entry.GetSource()
		if src != nil &&
			src.GetExecutionId() == executionID &&
			entry.GetType() == billingv1.LedgerEntryType_usage_debit {
			debitCount++
		}
	}

	assert.Greater(t, debitCount, 0,
		"execution %s should have usage_debit entries (proxy metering)", executionID)
	t.Logf("proxy metering verified: %d usage_debit entries for execution %s", debitCount, executionID)
}
