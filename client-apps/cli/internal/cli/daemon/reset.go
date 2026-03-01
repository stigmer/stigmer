package daemon

import (
	"os"
	"path/filepath"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/temporal"
)

// ResetOptions controls the scope of a reset operation.
type ResetOptions struct {
	IncludeConfig bool // Also remove config.yaml (user must re-run setup wizard)
}

// ResetResult describes what was removed during a reset.
type ResetResult struct {
	ServicesStopped bool
	RemovedPaths    []string
}

// Reset stops all services and removes runtime state from configDir (~/.stigmer).
//
// By default, config.yaml is preserved so the user does not lose API keys or
// backend preferences. Pass IncludeConfig to remove it as well.
func Reset(configDir, dataDir string, opts ResetOptions) (*ResetResult, error) {
	result := &ResetResult{}

	if err := stopAllServices(dataDir); err != nil {
		log.Debug().Err(err).Msg("Stop returned an error (may already be stopped)")
	}
	result.ServicesStopped = true

	removers := []struct {
		name string
		fn   func(string) ([]string, error)
	}{
		{"data directory", removeDataDir},
		{"temporal state", removeTemporalState},
		{"downloaded binaries", removeDownloadedBinaries},
		{"root logs", removeRootLogs},
	}

	for _, r := range removers {
		paths, err := r.fn(configDir)
		if err != nil {
			return result, errors.Wrapf(err, "failed to remove %s", r.name)
		}
		result.RemovedPaths = append(result.RemovedPaths, paths...)
	}

	if opts.IncludeConfig {
		paths, err := removeConfigFile(configDir)
		if err != nil {
			return result, errors.Wrap(err, "failed to remove configuration")
		}
		result.RemovedPaths = append(result.RemovedPaths, paths...)
	}

	return result, nil
}

// stopAllServices attempts to stop all running services via daemon.Stop.
// Errors are intentionally non-fatal: the server may already be stopped.
func stopAllServices(dataDir string) error {
	if !IsRunning(dataDir) {
		return nil
	}
	return Stop(dataDir)
}

// removeDataDir removes the entire data directory (~/.stigmer/data).
func removeDataDir(configDir string) ([]string, error) {
	dataDir := filepath.Join(configDir, config.DefaultDataDir)
	return removeIfExists(dataDir)
}

// removeTemporalState removes Temporal data directory and state files.
func removeTemporalState(configDir string) ([]string, error) {
	targets := []string{
		filepath.Join(configDir, "temporal-data"),
		filepath.Join(configDir, temporal.TemporalPIDFileName),
		filepath.Join(configDir, temporal.TemporalLockFileName),
	}
	return removeAll(targets)
}

// removeDownloadedBinaries removes the bin directory with downloaded tools.
func removeDownloadedBinaries(configDir string) ([]string, error) {
	binDir := filepath.Join(configDir, "bin")
	return removeIfExists(binDir)
}

// removeRootLogs removes root-level log directory and LLM PID file.
func removeRootLogs(configDir string) ([]string, error) {
	targets := []string{
		filepath.Join(configDir, "logs"),
		filepath.Join(configDir, "llm.pid"),
	}
	return removeAll(targets)
}

// removeConfigFile removes config.yaml.
func removeConfigFile(configDir string) ([]string, error) {
	configFile := filepath.Join(configDir, config.ConfigFileName)
	return removeIfExists(configFile)
}

// removeIfExists removes a path and returns it if it existed.
func removeIfExists(path string) ([]string, error) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, nil
	}
	if err := os.RemoveAll(path); err != nil {
		return nil, errors.Wrapf(err, "failed to remove %s", path)
	}
	return []string{path}, nil
}

// removeAll removes multiple paths, collecting those that existed.
func removeAll(paths []string) ([]string, error) {
	var removed []string
	for _, p := range paths {
		r, err := removeIfExists(p)
		if err != nil {
			return removed, err
		}
		removed = append(removed, r...)
	}
	return removed, nil
}
