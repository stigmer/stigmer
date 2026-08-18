package harness

import (
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"time"
)

// processReapTimeout bounds how long a Stop waits for a SIGKILLed child's
// Wait goroutine to reap it. A JVM that is still unreaped this long after
// SIGKILL is either genuinely alive (the oss#801 orphan class) or the host
// is in far deeper trouble than the harness.
const processReapTimeout = 10 * time.Second

// killAndVerify force-kills a harness child process and VERIFIES it died,
// instead of the fire-and-forget Process.Kill() that let orphaned service
// JVMs leak invisibly (oss#801: ~1GB each, dead-JDBC retry spam, cross-run
// log pollution). It drains the caller's EXISTING Wait goroutine via exitCh —
// never call cmd.Wait() twice — and only probes process liveness when the
// reap deadline passes, so a normally-reaped pid is never re-probed (a reaped
// pid may be reused by an unrelated process).
//
// Callers still own their log-file lifecycle; this helper owns only the
// kill-reap-verify sequence, mirroring the bounded-wait shape
// UnifiedRunnerManager.Stop already uses.
func killAndVerify(logger *slog.Logger, name string, cmd *exec.Cmd, exitCh <-chan error, reapTimeout time.Duration) error {
	if cmd == nil || cmd.Process == nil {
		return nil
	}

	killErr := cmd.Process.Kill()
	if errors.Is(killErr, os.ErrProcessDone) {
		// Already dead (and reaped by the Wait goroutine) — not an error.
		killErr = nil
	}
	if killErr != nil {
		logger.Error("failed to signal "+name, "pid", cmd.Process.Pid, "error", killErr)
	}

	select {
	case <-exitCh:
		return killErr // reaped — the process is certainly gone
	case <-time.After(reapTimeout):
	}

	// The deadline passed without a reap. Re-check the channel once: the
	// process may have died right at the deadline with the reap still in
	// flight (a dead-but-unreaped zombie would answer the liveness probe
	// below, so disambiguate first).
	select {
	case <-exitCh:
		return killErr
	default:
	}

	// Signal 0 = existence probe. Safe from pid reuse here: our own Wait has
	// not reaped, so the kernel still holds the pid for this child. Windows
	// has no signal-0 semantics; there the timeout warning below is the
	// only signal, which is still infinitely more than the old silence.
	if runtime.GOOS != "windows" {
		if err := cmd.Process.Signal(syscall.Signal(0)); err == nil {
			logger.Error(name+" survived SIGKILL — leaked process",
				"pid", cmd.Process.Pid, "issue", "stigmer/stigmer#801")
			return fmt.Errorf("%s pid %d survived SIGKILL — leaked process (stigmer/stigmer#801)",
				name, cmd.Process.Pid)
		}
	}

	logger.Warn(name+" was killed but not reaped within the deadline",
		"pid", cmd.Process.Pid, "timeout", reapTimeout)
	return killErr
}

// warnStaleServiceJVMs logs any stigmer-service fat-jar JVMs alive BEFORE this
// harness boots its own — the detection arm for orphans no teardown can
// prevent (a `go test` hard timeout SIGKILLs the test binary with no chance
// to clean up; oss#801). WARN, never kill: a concurrent harness in another
// process legitimately owns a service JVM, and guessing wrong would kill a
// live run. Best-effort by design — pgrep exit 1 means no matches, and any
// other failure (missing pgrep, exotic platform) must not fail a boot.
func warnStaleServiceJVMs(logger *slog.Logger) {
	if runtime.GOOS == "windows" {
		return
	}
	out, err := exec.Command("pgrep", "-f", "stigmer_service_fatjar").Output()
	if err != nil {
		return
	}
	pids := strings.Fields(strings.TrimSpace(string(out)))
	if len(pids) == 0 {
		return
	}
	logger.Warn("pre-existing stigmer-service JVMs detected — orphans leaked by an earlier run (stigmer/stigmer#801) or a concurrent harness",
		"pids", strings.Join(pids, ","))
}
