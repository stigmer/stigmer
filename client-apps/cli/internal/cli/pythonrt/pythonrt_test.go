package pythonrt_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/pythonrt"
)

// ---------------------------------------------------------------------------
// Unit tests — fast, no network, no disk (or temp dir only)
// ---------------------------------------------------------------------------

func TestPlatformDetection(t *testing.T) {
	p := pythonrt.DetectPlatform()
	if !p.IsSupported() {
		t.Fatalf("current platform %s is not supported", p)
	}
	if p.String() == "" {
		t.Fatal("platform string is empty")
	}
}

func TestPlatformPBSTriple(t *testing.T) {
	tests := []struct {
		os, arch string
		triple   string
		wantErr  bool
	}{
		{"darwin", "arm64", "aarch64-apple-darwin", false},
		{"darwin", "amd64", "x86_64-apple-darwin", false},
		{"linux", "amd64", "x86_64-unknown-linux-gnu", false},
		{"linux", "arm64", "aarch64-unknown-linux-gnu", false},
		{"windows", "amd64", "", true},
	}
	for _, tt := range tests {
		p := pythonrt.Platform{OS: tt.os, Arch: tt.arch}
		triple, err := p.PBSTriple()
		if tt.wantErr {
			if err == nil {
				t.Errorf("PBSTriple(%s): expected error for unsupported platform", p)
			}
			continue
		}
		if err != nil {
			t.Errorf("PBSTriple(%s): unexpected error: %v", p, err)
			continue
		}
		if triple != tt.triple {
			t.Errorf("PBSTriple(%s) = %q, want %q", p, triple, tt.triple)
		}
	}
}

func TestPlatformDownloadURL(t *testing.T) {
	p := pythonrt.Platform{OS: "darwin", Arch: "arm64"}
	url, err := p.DownloadURL()
	if err != nil {
		t.Fatalf("DownloadURL: %v", err)
	}
	if !strings.Contains(url, "astral-sh/python-build-standalone") {
		t.Errorf("URL does not reference python-build-standalone: %s", url)
	}
	if !strings.Contains(url, "install_only") {
		t.Errorf("URL does not reference install_only variant: %s", url)
	}
	if !strings.Contains(url, pythonrt.PythonVersion) {
		t.Errorf("URL does not contain pinned Python version %s: %s", pythonrt.PythonVersion, url)
	}
}

func TestManifestRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")

	original := &pythonrt.Manifest{
		SchemaVersion:       1,
		CLIVersion:          "0.99.0",
		Platform:            "darwin-arm64",
		PythonVersion:       "3.11.14",
		PBSTag:              "20260211",
		DepsLockSHA256:      "abc123",
		InstalledAt:         time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC),
		BootstrapDurationMS: 5000,
	}

	if err := original.Write(path); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, err := pythonrt.ReadManifest(path)
	if err != nil {
		t.Fatalf("ReadManifest: %v", err)
	}

	if got.CLIVersion != original.CLIVersion {
		t.Errorf("CLIVersion = %q, want %q", got.CLIVersion, original.CLIVersion)
	}
	if got.Platform != original.Platform {
		t.Errorf("Platform = %q, want %q", got.Platform, original.Platform)
	}
	if got.PythonVersion != original.PythonVersion {
		t.Errorf("PythonVersion = %q, want %q", got.PythonVersion, original.PythonVersion)
	}
	if got.DepsLockSHA256 != original.DepsLockSHA256 {
		t.Errorf("DepsLockSHA256 = %q, want %q", got.DepsLockSHA256, original.DepsLockSHA256)
	}
	if got.BootstrapDurationMS != original.BootstrapDurationMS {
		t.Errorf("BootstrapDurationMS = %d, want %d", got.BootstrapDurationMS, original.BootstrapDurationMS)
	}
}

func TestManifestIsValid(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manifest.json")

	m := &pythonrt.Manifest{
		SchemaVersion: 1,
		CLIVersion:    "1.0.0",
		InstalledAt:   time.Now(),
	}
	if err := m.Write(path); err != nil {
		t.Fatalf("Write: %v", err)
	}

	got, _ := pythonrt.ReadManifest(path)
	if !got.IsValid("1.0.0") {
		t.Error("manifest should be valid for matching CLI version")
	}
	if got.IsValid("2.0.0") {
		t.Error("manifest should be invalid for different CLI version")
	}
}

func TestNewManagerValidation(t *testing.T) {
	_, err := pythonrt.NewManager(pythonrt.Config{})
	if err == nil {
		t.Fatal("expected error for empty Config")
	}

	_, err = pythonrt.NewManager(pythonrt.Config{BaseDir: "/tmp/test"})
	if err == nil {
		t.Fatal("expected error for missing CLIVersion")
	}

	mgr, err := pythonrt.NewManager(pythonrt.Config{
		BaseDir:    "/tmp/test",
		CLIVersion: "1.0.0",
	})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	if mgr.RuntimeDir() == "" {
		t.Error("RuntimeDir should not be empty")
	}
	if mgr.PythonBin() == "" {
		t.Error("PythonBin should not be empty")
	}
	if mgr.IsReady() {
		t.Error("IsReady should be false for a fresh manager with no runtime on disk")
	}
}

// ---------------------------------------------------------------------------
// Integration test — downloads ~50MB, creates real venv. Skip with -short.
// ---------------------------------------------------------------------------

func TestEnsureReadyIntegration(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping integration test (downloads ~50MB from GitHub)")
	}

	dir := t.TempDir()

	mgr, err := pythonrt.NewManager(pythonrt.Config{
		BaseDir:    dir,
		CLIVersion: "integration-test",
	})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	// First call: full bootstrap (download + extract + venv)
	t.Log("EnsureReady: first call (full bootstrap)...")
	if err := mgr.EnsureReady(ctx); err != nil {
		t.Fatalf("EnsureReady (first call): %v", err)
	}

	// Verify the venv Python binary exists and runs
	pythonBin := mgr.PythonBin()
	if _, err := os.Stat(pythonBin); err != nil {
		t.Fatalf("PythonBin %s not found: %v", pythonBin, err)
	}
	out, err := exec.CommandContext(ctx, pythonBin, "--version").Output()
	if err != nil {
		t.Fatalf("python --version failed: %v", err)
	}
	version := strings.TrimSpace(string(out))
	t.Logf("Python binary works: %s", version)
	if !strings.Contains(version, pythonrt.PythonVersion) {
		t.Errorf("unexpected Python version %q, expected to contain %s", version, pythonrt.PythonVersion)
	}

	// Verify manifest
	manifest, err := pythonrt.ReadManifest(filepath.Join(mgr.RuntimeDir(), "manifest.json"))
	if err != nil {
		t.Fatalf("ReadManifest: %v", err)
	}
	if manifest.PythonVersion != pythonrt.PythonVersion {
		t.Errorf("manifest PythonVersion = %q, want %q", manifest.PythonVersion, pythonrt.PythonVersion)
	}
	if manifest.BootstrapDurationMS <= 0 {
		t.Error("manifest BootstrapDurationMS should be positive")
	}
	t.Logf("Bootstrap completed in %dms", manifest.BootstrapDurationMS)

	// Second call: should be a fast no-op
	t.Log("EnsureReady: second call (should be no-op)...")
	start := time.Now()
	if err := mgr.EnsureReady(ctx); err != nil {
		t.Fatalf("EnsureReady (second call): %v", err)
	}
	elapsed := time.Since(start)
	if elapsed > 1*time.Second {
		t.Errorf("second EnsureReady took %v, expected < 1s for no-op", elapsed)
	}
	t.Logf("Second EnsureReady: %v (no-op confirmed)", elapsed)
}
