package root

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// captureStdout captures stdout during the execution of f and returns the output.
// This helper is shared across display test files.
func captureStdout(t *testing.T, f func()) string {
	t.Helper()

	oldStdout := os.Stdout
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("failed to create pipe: %v", err)
	}
	os.Stdout = w

	f()

	w.Close()
	os.Stdout = oldStdout

	var buf bytes.Buffer
	if _, err := io.Copy(&buf, r); err != nil {
		t.Fatalf("failed to read captured output: %v", err)
	}

	return buf.String()
}

// setupTestHome creates a temporary $HOME with a .stigmer/config.yaml containing
// the given content. Uses t.Setenv (auto-restores) and t.TempDir (auto-cleans).
func setupTestHome(t *testing.T, configContent string) {
	t.Helper()

	tmpHome := t.TempDir()
	configDir := filepath.Join(tmpHome, ".stigmer")
	if err := os.MkdirAll(configDir, 0755); err != nil {
		t.Fatalf("failed to create config dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(configDir, "config.yaml"), []byte(configContent), 0644); err != nil {
		t.Fatalf("failed to write config file: %v", err)
	}
	t.Setenv("HOME", tmpHome)
}
