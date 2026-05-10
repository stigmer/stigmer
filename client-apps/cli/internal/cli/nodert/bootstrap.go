// Package nodert provides Node.js runtime detection and dependency management
// for TypeScript services managed by the Stigmer CLI (e.g., cursor-runner).
//
// Unlike the Python agent-runner which uses pythonrt.Manager to install a
// standalone Python, this package works with the system-installed Node.js.
// A managed Node.js runtime is deferred to T09 (embedded packaging).
package nodert

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

const minNodeMajorVersion = 20

// EnsureNodeAvailable verifies that node is on PATH and meets the minimum
// version requirement. Returns the absolute path to the node binary.
func EnsureNodeAvailable() (string, error) {
	nodeBin, err := exec.LookPath("node")
	if err != nil {
		return "", errors.New(
			"Node.js is required for the Cursor harness but was not found on PATH.\n" +
				"Install Node.js >= 20: https://nodejs.org/en/download",
		)
	}

	version, err := nodeVersion(nodeBin)
	if err != nil {
		return "", errors.Wrap(err, "failed to determine Node.js version")
	}

	major, err := parseMajorVersion(version)
	if err != nil {
		return "", errors.Wrapf(err, "failed to parse Node.js version %q", version)
	}

	if major < minNodeMajorVersion {
		return "", fmt.Errorf(
			"Node.js %d found, but >= %d is required for the Cursor harness.\n"+
				"Upgrade Node.js: https://nodejs.org/en/download",
			major, minNodeMajorVersion,
		)
	}

	log.Debug().
		Str("node", nodeBin).
		Str("version", version).
		Msg("Node.js runtime verified")

	return nodeBin, nil
}

// EnsureDepsInstalled runs npm install in the given directory if
// node_modules is missing or the package-lock.json has changed since
// the last install. Uses the system node and npm from PATH.
func EnsureDepsInstalled(ctx context.Context, appDir string) error {
	return EnsureDepsInstalledWith(ctx, appDir, "node", "npm")
}

// EnsureDepsInstalledWith is like EnsureDepsInstalled but uses the specified
// node and npm binaries instead of relying on system PATH. This allows
// callers to pass managed binaries from nodert.Manager, ensuring dep
// installation works in environments where PATH does not include Node.js
// (e.g., macOS .app sidecar context).
//
// The npm binary is invoked as `node <npmBin> install` because the managed
// npm is a JS script with a shebang that resolves `node` from PATH — which
// fails in PATH-restricted environments.
func EnsureDepsInstalledWith(ctx context.Context, appDir, nodeBin, npmBin string) error {
	nodeModules := filepath.Join(appDir, "node_modules")
	marker := filepath.Join(nodeModules, ".stigmer-install-marker")
	lockFile := filepath.Join(appDir, "package-lock.json")

	needsInstall := false

	if _, err := os.Stat(nodeModules); os.IsNotExist(err) {
		needsInstall = true
	} else if isStale(marker, lockFile) {
		needsInstall = true
		log.Debug().Msg("package-lock.json changed since last install, running npm install")
	}

	if !needsInstall {
		log.Debug().Str("dir", appDir).Msg("Node.js dependencies up to date")
		return nil
	}

	log.Info().Str("dir", appDir).Msg("Installing Node.js dependencies")

	cmd := exec.CommandContext(ctx, nodeBin, npmBin, "install", "--prefer-offline")
	cmd.Dir = appDir
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return errors.Wrap(err, "npm install failed")
	}

	_ = os.WriteFile(marker, []byte("installed"), 0644)

	log.Info().Str("dir", appDir).Msg("Node.js dependencies installed")
	return nil
}

// TsxArgs returns the arguments needed to run a TypeScript file via tsx.
// The tsx binary is resolved from the app's local node_modules.
func TsxArgs(appDir, entryPoint string) ([]string, error) {
	tsxBin := filepath.Join(appDir, "node_modules", ".bin", "tsx")
	if _, err := os.Stat(tsxBin); err != nil {
		return nil, errors.Wrapf(err, "tsx not found at %s — run npm install first", tsxBin)
	}
	return []string{tsxBin, entryPoint}, nil
}

func nodeVersion(nodeBin string) (string, error) {
	out, err := exec.Command(nodeBin, "--version").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

func parseMajorVersion(version string) (int, error) {
	v := strings.TrimPrefix(version, "v")
	parts := strings.SplitN(v, ".", 2)
	if len(parts) == 0 {
		return 0, fmt.Errorf("empty version string")
	}
	return strconv.Atoi(parts[0])
}

// isStale reports whether the marker file is older than the reference file,
// or if the marker does not exist.
func isStale(marker, reference string) bool {
	markerInfo, err := os.Stat(marker)
	if err != nil {
		return true
	}
	refInfo, err := os.Stat(reference)
	if err != nil {
		return false
	}
	return refInfo.ModTime().After(markerInfo.ModTime())
}
