package embedded

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/pkg/errors"
)

// Version information
// This will be set at build time via ldflags: -X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=x.y.z
var buildVersion = "dev"

// GetBuildVersion returns the current build version
func GetBuildVersion() string {
	if buildVersion == "" {
		return "dev"
	}
	return buildVersion
}

// needsExtraction checks if binaries need to be extracted
// Returns true if:
// - bin directory doesn't exist (first run)
// - .version file missing
// - version mismatch between extracted binaries and current CLI
// - development mode (version == "dev") - always re-extract to ensure latest changes
func needsExtraction(binDir string) (bool, error) {
	currentVersion := GetBuildVersion()
	
	// CRITICAL: In development mode, always re-extract binaries
	// This ensures developers get the latest embedded binaries after rebuilding
	// Production releases with proper version numbers use the efficient version-based check
	if currentVersion == "dev" {
		return true, nil
	}
	
	// Check if bin directory exists
	if _, err := os.Stat(binDir); os.IsNotExist(err) {
		return true, nil // First run
	}
	
	// Check version file
	extractedVersion, err := readVersionFile(binDir)
	if err != nil {
		// Version file missing or unreadable - need to re-extract
		return true, nil
	}
	
	if extractedVersion != currentVersion {
		// Version mismatch - need to re-extract
		return true, nil
	}
	
	// Check that agent-runner binary exists (only embedded binary - BusyBox pattern)
	agentRunnerBinary := filepath.Join(binDir, "agent-runner")
	if _, err := os.Stat(agentRunnerBinary); os.IsNotExist(err) {
		// Binary missing - need to re-extract
		return true, nil
	}
	
	// All checks passed - no extraction needed
	return false, nil
}

// readVersionFile reads the version from the .version file
func readVersionFile(binDir string) (string, error) {
	versionFile := filepath.Join(binDir, ".version")
	data, err := os.ReadFile(versionFile)
	if err != nil {
		return "", errors.Wrap(err, "failed to read version file")
	}
	
	return strings.TrimSpace(string(data)), nil
}

// writeVersionFile writes the current version to the .version file
func writeVersionFile(binDir string, version string) error {
	versionFile := filepath.Join(binDir, ".version")
	if err := os.WriteFile(versionFile, []byte(version+"\n"), 0644); err != nil {
		return errors.Wrap(err, "failed to write version file")
	}
	return nil
}
