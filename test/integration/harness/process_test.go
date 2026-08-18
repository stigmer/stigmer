package harness

import (
	"log/slog"
	"os"
	"os/exec"
	"testing"
	"time"
)

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
}

// startSleeper spawns a long sleep with the harness's own Wait-goroutine
// convention (buffered channel, single Wait) so killAndVerify sees exactly
// the shape JavaService/UnifiedRunnerStatic hand it.
func startSleeper(t *testing.T) (*exec.Cmd, <-chan error) {
	t.Helper()
	cmd := exec.Command("sleep", "60")
	if err := cmd.Start(); err != nil {
		t.Fatalf("start sleeper: %v", err)
	}
	exitCh := make(chan error, 1)
	go func() { exitCh <- cmd.Wait() }()
	return cmd, exitCh
}

func TestKillAndVerify_KillsAndReapsLiveProcess(t *testing.T) {
	cmd, exitCh := startSleeper(t)

	start := time.Now()
	if err := killAndVerify(testLogger(), "sleeper", cmd, exitCh, processReapTimeout); err != nil {
		t.Fatalf("expected clean kill, got: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("kill-and-reap of a killable process should be fast, took %v", elapsed)
	}
	if cmd.ProcessState == nil {
		t.Fatal("process was not reaped (ProcessState nil after killAndVerify)")
	}
}

func TestKillAndVerify_AlreadyDeadProcessIsNotAnError(t *testing.T) {
	cmd, exitCh := startSleeper(t)
	if err := cmd.Process.Kill(); err != nil {
		t.Fatalf("pre-kill: %v", err)
	}
	// Let the Wait goroutine reap it so Kill() inside killAndVerify sees
	// ErrProcessDone — the already-dead path Stop() must treat as success.
	// The reap result stays buffered in exitCh (nobody consumed it), which
	// is exactly the state a Stop after an early crash encounters.
	deadline := time.After(5 * time.Second)
	for cmd.ProcessState == nil {
		select {
		case <-deadline:
			t.Fatal("sleeper was never reaped")
		case <-time.After(10 * time.Millisecond):
		}
	}

	if err := killAndVerify(testLogger(), "sleeper", cmd, exitCh, processReapTimeout); err != nil {
		t.Fatalf("already-dead process must not be an error, got: %v", err)
	}
}

func TestKillAndVerify_NilProcessIsNoop(t *testing.T) {
	if err := killAndVerify(testLogger(), "ghost", nil, nil, processReapTimeout); err != nil {
		t.Fatalf("nil cmd must be a no-op, got: %v", err)
	}
	if err := killAndVerify(testLogger(), "ghost", &exec.Cmd{}, nil, processReapTimeout); err != nil {
		t.Fatalf("unstarted cmd must be a no-op, got: %v", err)
	}
}
