package harness

import (
	"context"
	"fmt"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
)

// WaitForExecutionUsageReport polls GetExecutionUsageReport until pred is
// satisfied or the timeout elapses, returning the last report it observed.
//
// The cloud Cursor proxy records per-turn billing asynchronously (it dispatches
// each turn's usage write onto a bounded executor off the Netty event loop), so
// a report read immediately after an execution completes can be missing the
// final turns. Polling for a settled predicate — rather than sleeping a fixed
// duration and hoping the writes have landed — makes usage assertions
// deterministic and removes a real source of run-to-run flakiness.
//
// The last-seen report is always returned, even on timeout, so callers can run
// their assertions against it and produce a diagnostic failure (e.g. "billing
// recorded N calls but streaming saw M turns") instead of a bare timeout.
func WaitForExecutionUsageReport(
	ctx context.Context,
	q agentexecv1.AgentExecutionQueryControllerClient,
	executionID string,
	timeout time.Duration,
	pred func(*agentexecv1.GetExecutionUsageReportOutput) bool,
) (*agentexecv1.GetExecutionUsageReportOutput, error) {
	if timeout == 0 {
		timeout = defaultTimeout
	}

	deadline := time.Now().Add(timeout)
	interval := defaultPollInterval

	var last *agentexecv1.GetExecutionUsageReportOutput
	for time.Now().Before(deadline) {
		report, err := q.GetExecutionUsageReport(ctx,
			&agentexecv1.GetExecutionUsageReportInput{ExecutionId: executionID})
		if err == nil {
			last = report
			if pred == nil || pred(report) {
				return last, nil
			}
		}

		select {
		case <-ctx.Done():
			return last, ctx.Err()
		case <-time.After(interval):
		}
		interval = nextInterval(interval)
	}

	return last, fmt.Errorf(
		"timed out after %v waiting for execution %s usage report to satisfy predicate",
		timeout, executionID)
}
