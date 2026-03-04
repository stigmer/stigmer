// Package bootstrap provides utilities for reading and displaying bootstrap state.
//
// The bootstrap process runs on server startup via EnsureSeedpackBootstrapped,
// which applies system resources and writes a content-hash flag file to the data
// directory. This package reads that flag file to report bootstrap status without
// going through gRPC (consistent with how server status reads PID files directly).
package bootstrap

import (
	"os"
	"path/filepath"
	"strings"
)

// Status constants for bootstrap state.
const (
	StatusCompleted = "completed"
	StatusPending   = "pending"
)

// seedpackFlagFile is the name of the file written by EnsureSeedpackBootstrapped
// after a successful seedpack apply. Its content is the seedpack content hash.
// This must stay in sync with the constant in the daemon package.
const seedpackFlagFile = ".seedpack-bootstrapped"

// BootstrapStatus represents the bootstrap state for display.
type BootstrapStatus struct {
	// Status is the overall bootstrap status ("completed" or empty if never run).
	Status string
	// SeedpackHash is the content hash of the applied seedpack (empty if not bootstrapped).
	SeedpackHash string
}

// GetBootstrapStatus reads bootstrap state from the seedpack flag file in dataDir.
//
// The flag file is written by EnsureSeedpackBootstrapped after a successful
// seedpack apply. Its presence (with a non-empty hash) means bootstrap completed.
func GetBootstrapStatus(dataDir string) *BootstrapStatus {
	flagPath := filepath.Join(dataDir, seedpackFlagFile)

	data, err := os.ReadFile(flagPath)
	if err != nil {
		return &BootstrapStatus{Status: ""}
	}

	hash := strings.TrimSpace(string(data))
	if hash == "" {
		return &BootstrapStatus{Status: ""}
	}

	return &BootstrapStatus{
		Status:       StatusCompleted,
		SeedpackHash: hash,
	}
}

// GetStatusSymbol returns a visual indicator for bootstrap status.
func GetStatusSymbol(status string) string {
	switch status {
	case StatusCompleted:
		return "✓"
	case StatusPending:
		return "○"
	case "":
		return "○"
	default:
		return "?"
	}
}

// GetStatusDisplay returns a user-friendly display string for bootstrap status.
func GetStatusDisplay(status string) string {
	switch status {
	case StatusCompleted:
		return "Completed"
	case StatusPending:
		return "Pending"
	case "":
		return "Not Started"
	default:
		return status
	}
}
