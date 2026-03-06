package bootstrap

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetBootstrapStatus_FlagFilePresent(t *testing.T) {
	dir := t.TempDir()
	hash := "sha256:abc123def456"
	if err := os.WriteFile(filepath.Join(dir, seedpackFlagFile), []byte(hash), 0644); err != nil {
		t.Fatal(err)
	}

	status := GetBootstrapStatus(dir)
	if status.Status != StatusCompleted {
		t.Errorf("Status = %q, want %q", status.Status, StatusCompleted)
	}
	if status.SeedpackHash != hash {
		t.Errorf("SeedpackHash = %q, want %q", status.SeedpackHash, hash)
	}
}

func TestGetBootstrapStatus_FlagFileWithWhitespace(t *testing.T) {
	dir := t.TempDir()
	hash := "sha256:abc123def456"
	if err := os.WriteFile(filepath.Join(dir, seedpackFlagFile), []byte(hash+"\n"), 0644); err != nil {
		t.Fatal(err)
	}

	status := GetBootstrapStatus(dir)
	if status.Status != StatusCompleted {
		t.Errorf("Status = %q, want %q", status.Status, StatusCompleted)
	}
	if status.SeedpackHash != hash {
		t.Errorf("SeedpackHash = %q, want %q", status.SeedpackHash, hash)
	}
}

func TestGetBootstrapStatus_NoFlagFile(t *testing.T) {
	dir := t.TempDir()

	status := GetBootstrapStatus(dir)
	if status.Status != "" {
		t.Errorf("Status = %q, want empty", status.Status)
	}
	if status.SeedpackHash != "" {
		t.Errorf("SeedpackHash = %q, want empty", status.SeedpackHash)
	}
}

func TestGetBootstrapStatus_EmptyFlagFile(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, seedpackFlagFile), []byte(""), 0644); err != nil {
		t.Fatal(err)
	}

	status := GetBootstrapStatus(dir)
	if status.Status != "" {
		t.Errorf("Status = %q, want empty", status.Status)
	}
}

func TestGetStatusSymbol(t *testing.T) {
	tests := []struct {
		status string
		want   string
	}{
		{StatusCompleted, "✓"},
		{StatusPending, "○"},
		{"", "○"},
		{"unknown", "?"},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			got := GetStatusSymbol(tt.status)
			if got != tt.want {
				t.Errorf("GetStatusSymbol(%q) = %q, want %q", tt.status, got, tt.want)
			}
		})
	}
}

func TestGetStatusDisplay(t *testing.T) {
	tests := []struct {
		status string
		want   string
	}{
		{StatusCompleted, "Completed"},
		{StatusPending, "Pending"},
		{"", "Not Started"},
		{"custom", "custom"},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			got := GetStatusDisplay(tt.status)
			if got != tt.want {
				t.Errorf("GetStatusDisplay(%q) = %q, want %q", tt.status, got, tt.want)
			}
		})
	}
}
