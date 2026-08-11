package harness

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// fakeRunnerDir builds a minimal runner directory (package.json + dist/main.js)
// so resolveRunnerCommand launches `node dist/main.js` with the given script
// body. UNIFIED_RUNNER_DIR points StartUnifiedRunnerStatic at it.
func fakeRunnerDir(t *testing.T, mainJS string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"fake-runner"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "dist"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "dist", "main.js"), []byte(mainJS), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestStartUnifiedRunnerStatic_BootDeathIsAnError pins the oss#307 failure
// mode: a runner process that dies during startup (e.g. Node without
// node:sqlite prints one error and exits) must surface as a start error —
// so the suite degrades to clean skips — instead of being reported
// "started", which strands every runner-dependent test in a silent timeout.
//
// Before the fix this test fails: the old premature-exit check polled
// cmd.ProcessState after a sleep, which is only populated by Wait() and so
// never observed the death.
func TestStartUnifiedRunnerStatic_BootDeathIsAnError(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
	t.Setenv("UNIFIED_RUNNER_DIR", fakeRunnerDir(t,
		`console.error("fake runner: fatal boot error (oss#307 pin)"); process.exit(1);`))

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	runner, err := StartUnifiedRunnerStatic(context.Background(), UnifiedRunnerConfig{
		StigmerServiceAddress: "127.0.0.1:1",
		TemporalAddress:       "127.0.0.1:1",
		LogDir:                t.TempDir(),
	}, "pin_boot_death", logger)

	if err == nil {
		_ = runner.Stop()
		t.Fatal("StartUnifiedRunnerStatic reported success for a runner that died at boot")
	}
	if want := "exited during startup"; !strings.Contains(err.Error(), want) {
		t.Fatalf("error %q does not mention %q", err.Error(), want)
	}
	// The error must carry the runner's own diagnostic so the operator sees
	// the actionable cause (for oss#307 that was the node:sqlite message).
	if want := "fatal boot error"; !strings.Contains(err.Error(), want) {
		t.Fatalf("error %q does not surface the runner log tail (%q)", err.Error(), want)
	}
}

// TestStartUnifiedRunnerStatic_SurvivingProcessStarts is the control: a
// process that outlives the startup window starts normally and stops cleanly.
func TestStartUnifiedRunnerStatic_SurvivingProcessStarts(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node not on PATH")
	}
	t.Setenv("UNIFIED_RUNNER_DIR", fakeRunnerDir(t,
		`setInterval(() => {}, 1000);`))

	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelError}))
	runner, err := StartUnifiedRunnerStatic(context.Background(), UnifiedRunnerConfig{
		StigmerServiceAddress: "127.0.0.1:1",
		TemporalAddress:       "127.0.0.1:1",
		LogDir:                t.TempDir(),
	}, "pin_survivor", logger)
	if err != nil {
		t.Fatalf("StartUnifiedRunnerStatic failed for a healthy process: %v", err)
	}
	if err := runner.Stop(); err != nil {
		t.Fatalf("Stop returned error: %v", err)
	}
}
