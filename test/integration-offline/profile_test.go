//go:build integration

package offline

import (
	"context"
	"os"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
)

// TestProfile_RunnerManagerStartStopCost measures the wall-clock cost of one
// UnifiedRunnerManager lifecycle — process start (through the IPC `ready`
// handshake) plus graceful Stop — repeated over N cycles.
//
// Why this exists: the offline suite starts a fresh runner manager per test
// (startOfflineRunner). The cost of that startup+teardown, multiplied by the
// test count, is the exact ceiling a single shared runner-manager could ever
// reclaim. This test isolates that one number so the shared-runner refactor can
// be judged on data rather than the handoff's unmeasured "~2s x 44" estimate.
//
// It is skipped by default so it never taxes the normal suite. Enable it with
// STIGMER_PROFILE_RUNNER=1 (cycle count overridable via STIGMER_PROFILE_RUNNER_CYCLES,
// default 5). Results are emitted as parseable PROFILE_RUNNER lines.
func TestProfile_RunnerManagerStartStopCost(t *testing.T) {
	if os.Getenv("STIGMER_PROFILE_RUNNER") == "" {
		t.Skip("runner start/stop profiling disabled — set STIGMER_PROFILE_RUNNER=1 to measure")
	}
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, testHarness.Temporal, "temporal must be running")

	cycles := profileCycles(t)

	// One mock proxy serves every cycle: we never run an execution, so its entry
	// queue stays untouched. Reusing it keeps the measurement focused on the
	// runner process lifecycle, not httptest server churn.
	mockLLM := harness.NewMockLLMProxyServerFromEntries(nil)
	t.Cleanup(mockLLM.Close)

	startDurations := make([]time.Duration, 0, cycles)
	stopDurations := make([]time.Duration, 0, cycles)

	for i := 0; i < cycles; i++ {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)

		startedAt := time.Now()
		mgr, err := harness.StartUnifiedRunnerManager(ctx, harness.UnifiedRunnerConfig{
			StigmerServiceAddress: testHarness.Service.GRPCAddress(),
			TemporalAddress:       testHarness.Temporal.Address(),
			LogDir:                testHarness.LogDir(),
			ProxyEndpoint:         mockLLM.URL(),
			LocalArtifactDir:      t.TempDir(),
		}, suiteLogger)
		if err != nil {
			cancel()
			if strings.Contains(err.Error(), "not found") {
				t.Skipf("unified runner not available: %v", err)
			}
			t.Fatalf("cycle %d: start runner manager: %v", i, err)
		}
		startDur := time.Since(startedAt)

		stoppedAt := time.Now()
		require.NoError(t, mgr.Stop(), "cycle %d: stop runner manager", i)
		stopDur := time.Since(stoppedAt)

		cancel()

		startDurations = append(startDurations, startDur)
		stopDurations = append(stopDurations, stopDur)
		t.Logf("PROFILE_RUNNER cycle=%d start_ms=%d stop_ms=%d",
			i, startDur.Milliseconds(), stopDur.Milliseconds())
	}

	startStats := summarize(startDurations)
	stopStats := summarize(stopDurations)
	cycleMean := startStats.mean + stopStats.mean

	t.Logf("PROFILE_RUNNER summary cycles=%d", cycles)
	t.Logf("PROFILE_RUNNER start  mean_ms=%d p50_ms=%d p90_ms=%d",
		startStats.mean.Milliseconds(), startStats.p50.Milliseconds(), startStats.p90.Milliseconds())
	t.Logf("PROFILE_RUNNER stop   mean_ms=%d p50_ms=%d p90_ms=%d",
		stopStats.mean.Milliseconds(), stopStats.p50.Milliseconds(), stopStats.p90.Milliseconds())
	t.Logf("PROFILE_RUNNER cycle  mean_ms=%d (start+stop per test)", cycleMean.Milliseconds())
}

// profileCycles reads the cycle count from STIGMER_PROFILE_RUNNER_CYCLES,
// defaulting to 5 — enough samples for a stable p50/p90 without bloating the run.
func profileCycles(t *testing.T) int {
	t.Helper()
	const defaultCycles = 5
	raw := os.Getenv("STIGMER_PROFILE_RUNNER_CYCLES")
	if raw == "" {
		return defaultCycles
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		t.Fatalf("invalid STIGMER_PROFILE_RUNNER_CYCLES %q: want a positive integer", raw)
	}
	return n
}

type durationStats struct {
	mean time.Duration
	p50  time.Duration
	p90  time.Duration
}

// summarize computes mean and nearest-rank p50/p90 over the samples. The input
// is copied before sorting so the caller's slice order is preserved.
func summarize(samples []time.Duration) durationStats {
	if len(samples) == 0 {
		return durationStats{}
	}

	sorted := make([]time.Duration, len(samples))
	copy(sorted, samples)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })

	var total time.Duration
	for _, d := range sorted {
		total += d
	}

	return durationStats{
		mean: total / time.Duration(len(sorted)),
		p50:  percentile(sorted, 50),
		p90:  percentile(sorted, 90),
	}
}

// percentile returns the nearest-rank percentile of an already-sorted slice.
func percentile(sorted []time.Duration, p int) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	rank := (p*len(sorted) + 99) / 100 // ceil(p/100 * n)
	if rank < 1 {
		rank = 1
	}
	if rank > len(sorted) {
		rank = len(sorted)
	}
	return sorted[rank-1]
}
