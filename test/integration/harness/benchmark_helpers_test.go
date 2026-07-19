package harness

import (
	"context"
	"errors"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// Unit tests for the usage-report settle loop. No runner or service process is
// started — the fetcher is scripted per poll, which is exactly the seam the
// usageReportFetcher interface exists for. These tests use aggressive poll
// intervals; the production constants are exercised only through the exported
// WaitForSettledUsageReport wrapper's compile-time wiring.

const testSettlePoll = 2 * time.Millisecond

// scriptedFetcher returns one scripted step per GetExecutionUsageReport call,
// repeating the final step once the script is exhausted.
type scriptedFetcher struct {
	steps []scriptStep
	calls int
}

type scriptStep struct {
	report *agentexecv1.GetExecutionUsageReportOutput
	err    error
}

func (f *scriptedFetcher) GetExecutionUsageReport(_ context.Context,
	_ *agentexecv1.GetExecutionUsageReportInput, _ ...grpc.CallOption,
) (*agentexecv1.GetExecutionUsageReportOutput, error) {
	i := f.calls
	if i >= len(f.steps) {
		i = len(f.steps) - 1
	}
	f.calls++
	step := f.steps[i]
	return step.report, step.err
}

func reportWith(llmCalls int32, billableMicros int64) *agentexecv1.GetExecutionUsageReportOutput {
	return &agentexecv1.GetExecutionUsageReportOutput{
		Aggregate: &agentexecv1.UsageReportAggregate{
			LlmCallCount:       llmCalls,
			BillableCostMicros: billableMicros,
		},
	}
}

func TestWaitForSettledUsageReport_SettlesOnceAggregateIsStable(t *testing.T) {
	fetcher := &scriptedFetcher{steps: []scriptStep{
		{report: reportWith(0, 0)},   // billing not landed yet
		{report: reportWith(1, 100)}, // first record arrives
		{report: reportWith(1, 100)}, // stable x1
		{report: reportWith(1, 100)}, // stable x2 -> settled
	}}

	report, err := waitForSettledUsageReport(context.Background(), fetcher, "exec-1",
		time.Second, testSettlePoll)

	require.NoError(t, err)
	assert.Equal(t, int32(1), report.GetAggregate().GetLlmCallCount())
	assert.Equal(t, int64(100), report.GetAggregate().GetBillableCostMicros())
	assert.GreaterOrEqual(t, fetcher.calls, 4,
		"settling requires the aggregate to survive %d unchanged re-reads", usageSettleStablePolls)
}

func TestWaitForSettledUsageReport_LateRecordResetsStability(t *testing.T) {
	// This is the exact race the old fixed 2s sleep lost: a second billing
	// record lands after the first read. The settle loop must include it.
	fetcher := &scriptedFetcher{steps: []scriptStep{
		{report: reportWith(1, 100)},
		{report: reportWith(1, 100)}, // stable x1...
		{report: reportWith(2, 250)}, // ...then a late record resets the count
		{report: reportWith(2, 250)},
		{report: reportWith(2, 250)},
	}}

	report, err := waitForSettledUsageReport(context.Background(), fetcher, "exec-2",
		time.Second, testSettlePoll)

	require.NoError(t, err)
	assert.Equal(t, int32(2), report.GetAggregate().GetLlmCallCount(),
		"the settled report must include the late-arriving record")
	assert.Equal(t, int64(250), report.GetAggregate().GetBillableCostMicros())
}

func TestWaitForSettledUsageReport_ToleratesTransientFetchErrors(t *testing.T) {
	fetcher := &scriptedFetcher{steps: []scriptStep{
		{err: errors.New("transient: connection refused")},
		{report: reportWith(1, 100)},
		{report: reportWith(1, 100)},
		{report: reportWith(1, 100)},
	}}

	report, err := waitForSettledUsageReport(context.Background(), fetcher, "exec-3",
		time.Second, testSettlePoll)

	require.NoError(t, err)
	assert.Equal(t, int32(1), report.GetAggregate().GetLlmCallCount())
}

func TestWaitForSettledUsageReport_TimesOutWhenBillingNeverLands(t *testing.T) {
	fetcher := &scriptedFetcher{steps: []scriptStep{
		{report: reportWith(0, 0)},
	}}

	report, err := waitForSettledUsageReport(context.Background(), fetcher, "exec-4",
		20*time.Millisecond, testSettlePoll)

	require.Error(t, err)
	assert.Nil(t, report)
	assert.Contains(t, err.Error(), "no LLM-call records",
		"the error must say billing never landed, not just 'timeout'")
	assert.Contains(t, err.Error(), "exec-4")
}

func TestWaitForSettledUsageReport_TimesOutWhileStillChanging(t *testing.T) {
	// Aggregate grows on every poll — never quiesces.
	steps := make([]scriptStep, 0, 64)
	for i := int32(1); i <= 64; i++ {
		steps = append(steps, scriptStep{report: reportWith(i, int64(i)*100)})
	}
	fetcher := &scriptedFetcher{steps: steps}

	report, err := waitForSettledUsageReport(context.Background(), fetcher, "exec-5",
		20*time.Millisecond, testSettlePoll)

	require.Error(t, err)
	assert.Nil(t, report)
	assert.Contains(t, err.Error(), "still changing")
	assert.Contains(t, err.Error(), "exec-5")
}

func TestWaitForSettledUsageReport_TimeoutReportsLastFetchError(t *testing.T) {
	fetcher := &scriptedFetcher{steps: []scriptStep{
		{err: errors.New("service unavailable")},
	}}

	_, err := waitForSettledUsageReport(context.Background(), fetcher, "exec-6",
		20*time.Millisecond, testSettlePoll)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "service unavailable",
		"the timeout error must carry the underlying fetch failure for diagnosis")
}
