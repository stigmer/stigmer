package harness

import (
	"context"
	"testing"
	"time"
)

const testDeadlineSafetyBuffer = 30 * time.Second

// TestContext creates a context bounded by the shorter of perTestTimeout and the
// Go test binary's global deadline (set via -timeout). A 30-second safety buffer
// is reserved before the global deadline to allow cleanup and gotestsum
// bookkeeping. If insufficient time remains, the test is skipped rather than
// allowing Go to panic the entire binary.
func TestContext(t *testing.T, perTestTimeout time.Duration) (context.Context, context.CancelFunc) {
	t.Helper()

	if deadline, ok := t.Deadline(); ok {
		remaining := time.Until(deadline) - testDeadlineSafetyBuffer
		if remaining <= 0 {
			t.Skipf("insufficient time before global test deadline (%v remaining, need %v buffer)",
				time.Until(deadline), testDeadlineSafetyBuffer)
		}
		if remaining < perTestTimeout {
			t.Logf("clamping test timeout from %v to %v (global deadline approaching)",
				perTestTimeout, remaining.Truncate(time.Second))
			perTestTimeout = remaining
		}
	}

	return context.WithTimeout(context.Background(), perTestTimeout)
}
