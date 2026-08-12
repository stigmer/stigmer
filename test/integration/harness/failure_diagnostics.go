package harness

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// maxLogSnapshotBytes caps how much of each service/runner log is copied into a
// diagnostic bundle. The tail is what matters near a failure, and the shared
// service log can grow to many megabytes across a suite run.
const maxLogSnapshotBytes = 512 * 1024

// CaptureWorkflowExecutionDiagnostics writes a diagnostic bundle for a workflow
// execution that failed to reach an expected state, so the next occurrence of a
// flaky workflow test is self-explanatory instead of just a bare timeout.
//
// The bundle, written to {OutputDir}/diagnostics/{label}, contains:
//   - orchestrator-history.json — the orchestrator Temporal event history
//   - child-history.json        — the TS child workflow history (if it exists)
//   - <log>.tail.log            — the tail of each service/runner log
//
// It is best-effort: every step logs and continues on error so a diagnostic
// failure never masks the original test failure. It uses its own short-lived
// context (not the test's, which is typically already at its deadline when a
// WaitForPhase times out).
//
// Call it from the failure path before the failing assertion, e.g.:
//
//	result, err := waiter.WaitForPhase(ctx, id, COMPLETED, 2*time.Minute)
//	if err != nil {
//	    testHarness.CaptureWorkflowExecutionDiagnostics(t, t.Name(), id)
//	}
//	require.NoError(t, err)
func (h *TestHarness) CaptureWorkflowExecutionDiagnostics(t *testing.T, label, executionID string) {
	t.Helper()

	bundleDir := filepath.Join(h.OutputDir(), "diagnostics", sanitizeLabel(label))
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Logf("diagnostics: could not create bundle dir %s: %v", bundleDir, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	h.exportWorkflowHistories(t, ctx, bundleDir, executionID)
	h.snapshotServiceLogs(t, bundleDir)

	t.Logf("diagnostics: wrote failure bundle for execution %s to %s", executionID, bundleDir)
}

// exportWorkflowHistories writes the orchestrator and child workflow histories
// into the bundle. The child history is optional — for some failure modes the
// child workflow never starts — so its absence is logged, not treated as fatal.
func (h *TestHarness) exportWorkflowHistories(t *testing.T, ctx context.Context, bundleDir, executionID string) {
	t.Helper()
	if h.Temporal == nil {
		t.Logf("diagnostics: Temporal unavailable — skipping history export")
		return
	}

	tc, err := h.Temporal.Client()
	if err != nil {
		t.Logf("diagnostics: could not connect to Temporal for history export: %v", err)
		return
	}
	defer tc.Close()

	exporter := NewHistoryExporter(tc, bundleDir)

	orchID := OrchestratorWorkflowID(executionID)
	if err := exporter.Export(ctx, orchID, "", "orchestrator-history.json"); err != nil {
		t.Logf("diagnostics: orchestrator history export failed for %s: %v", orchID, err)
	}

	childID := ChildWorkflowID(executionID)
	if err := exporter.Export(ctx, childID, "", "child-history.json"); err != nil {
		t.Logf("diagnostics: child history export skipped for %s: %v", childID, err)
	}
}

// snapshotServiceLogs copies the tail of each known service/runner log into the
// bundle, capturing the state at the moment of failure.
func (h *TestHarness) snapshotServiceLogs(t *testing.T, bundleDir string) {
	t.Helper()
	for _, src := range h.LogPaths() {
		dst := filepath.Join(bundleDir, filepath.Base(src)+".tail.log")
		if err := copyFileTail(src, dst, maxLogSnapshotBytes); err != nil {
			t.Logf("diagnostics: could not snapshot log %s: %v", src, err)
		}
	}
}

// sanitizeLabel makes a label safe to use as a file or directory name. Go
// subtest names contain "/" and spaces (nested or awkward directories), and
// Temporal task queues contain ":" — which actions/upload-artifact rejects
// outright (NTFS-invalid), so one colon-named log used to fail a whole
// suite's artifact upload. The remaining characters cover the rest of the
// upload-artifact deny list.
func sanitizeLabel(label string) string {
	replacer := strings.NewReplacer(
		"/", "_", " ", "_", ":", "_",
		"\"", "_", "<", "_", ">", "_", "|", "_", "*", "_", "?", "_",
		"\r", "_", "\n", "_",
	)
	return replacer.Replace(label)
}

// copyFileTail copies at most maxBytes from the end of src into dst. When src is
// larger than maxBytes, a marker line records how many bytes were elided.
func copyFileTail(src, dst string, maxBytes int64) error {
	in, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("open source: %w", err)
	}
	defer in.Close()

	info, err := in.Stat()
	if err != nil {
		return fmt.Errorf("stat source: %w", err)
	}

	out, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("create dest: %w", err)
	}
	defer out.Close()

	if info.Size() > maxBytes {
		if _, err := in.Seek(-maxBytes, io.SeekEnd); err != nil {
			return fmt.Errorf("seek to tail: %w", err)
		}
		fmt.Fprintf(out, "... [%d earlier bytes elided] ...\n", info.Size()-maxBytes)
	}

	if _, err := io.Copy(out, in); err != nil {
		return fmt.Errorf("copy tail: %w", err)
	}
	return nil
}
