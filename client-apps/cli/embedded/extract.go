package embedded

import (
	"os"
	"path/filepath"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// EnsureBinariesExtracted ensures the bin directory and version marker exist.
// The runner is now a TypeScript/Node.js process (@stigmer/runner) started
// directly by the daemon — no binaries are embedded or extracted.
// This function maintains the bin directory and version marker for
// compatibility with code that checks the data directory layout.
func EnsureBinariesExtracted(dataDir string) error {
	binDir := filepath.Join(dataDir, "bin")

	if err := os.MkdirAll(binDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create bin directory")
	}

	currentVersion := GetBuildVersion()
	if extractedVersion, err := readVersionFile(binDir); err == nil && extractedVersion == currentVersion {
		log.Debug().Msg("Bin directory already initialized, skipping")
		return nil
	}

	if err := writeVersionFile(binDir, currentVersion); err != nil {
		return errors.Wrap(err, "failed to write version file")
	}

	return nil
}

func readVersionFile(binDir string) (string, error) {
	versionFile := filepath.Join(binDir, ".version")
	data, err := os.ReadFile(versionFile)
	if err != nil {
		return "", errors.Wrap(err, "failed to read version file")
	}

	return string(data), nil
}

func writeVersionFile(binDir string, version string) error {
	versionFile := filepath.Join(binDir, ".version")
	if err := os.WriteFile(versionFile, []byte(version), 0644); err != nil {
		return errors.Wrap(err, "failed to write version file")
	}
	return nil
}
