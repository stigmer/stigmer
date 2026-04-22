package daemon

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/agentrunner"
	cliconfig "github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/pythonrt"
)

// bootstrapRunnerRuntime prepares the Python runtime for the runner process.
// Returns the path to the Python binary and the app directory.
// This runs in the foreground CLI so the user sees bootstrap progress.
func bootstrapRunnerRuntime() (pythonBin string, appDir string, err error) {
	sourceFS := agentrunner.SourceFS()
	if sourceFS == nil {
		return "", "", errors.New("agent-runner Python source is not available (not embedded and not found in repo tree)")
	}

	configDir, err := cliconfig.GetConfigDir()
	if err != nil {
		return "", "", errors.Wrap(err, "failed to resolve config directory")
	}

	mgr, err := pythonrt.NewManager(pythonrt.Config{
		BaseDir:      filepath.Join(configDir, "runtimes", "agent-runner"),
		CLIVersion:   embedded.GetBuildVersion(),
		AppSourceFS:  sourceFS,
		PreInstallFn: buildPreInstallFn(),
	})
	if err != nil {
		return "", "", errors.Wrap(err, "failed to create Python runtime manager")
	}

	mgr.SetDeps(
		filepath.Join(mgr.AppDir(), "requirements.txt"),
		[][]string{
			{"pip", "install", "--no-deps", filepath.Join(mgr.AppDir(), "libs", "graphton")},
			{"pip", "install", "--no-deps", filepath.Join(mgr.AppDir(), "libs", "stigmer-protos")},
		},
	)

	log.Info().
		Str("runtime_dir", mgr.RuntimeDir()).
		Msg("Bootstrapping Python runtime for agent-runner")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if err := mgr.EnsureReady(ctx); err != nil {
		return "", "", errors.Wrap(err, "failed to bootstrap Python runtime")
	}

	return mgr.PythonBin(), mgr.AppDir(), nil
}

// buildPreInstallFn returns a hook that copies monorepo path dependencies
// (graphton, stigmer-protos) into the app directory before pip runs.
//
// In embed (production) builds, sync.sh already places these under libs/
// inside the embedded source, so the hook is a no-op. In dev builds, the
// source FS is only the agent-runner directory; the path deps live elsewhere
// in the repo and must be copied explicitly.
func buildPreInstallFn() func(appDir string) error {
	repoRoot := agentrunner.DevRepoRoot()
	if repoRoot == "" {
		return nil
	}
	return func(appDir string) error {
		pathDeps := []struct {
			src    string
			target string
		}{
			{
				src:    filepath.Join(repoRoot, "backend", "libs", "python", "graphton"),
				target: filepath.Join(appDir, "libs", "graphton"),
			},
			{
				src:    filepath.Join(repoRoot, "apis", "stubs", "python", "stigmer"),
				target: filepath.Join(appDir, "libs", "stigmer-protos"),
			},
		}
		for _, dep := range pathDeps {
			if _, err := os.Stat(dep.src); err != nil {
				log.Warn().Str("src", dep.src).Msg("Path dependency not found, skipping")
				continue
			}
			log.Info().Str("src", dep.src).Str("target", dep.target).Msg("Copying path dependency")
			if err := copyDir(dep.src, dep.target); err != nil {
				return errors.Wrapf(err, "failed to copy path dependency from %s", dep.src)
			}
		}
		return nil
	}
}

// copyDir recursively copies a directory tree from src to dst, skipping
// hidden directories (.venv, .git, etc.) and __pycache__.
func copyDir(src, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		if info.IsDir() && rel != "." && (rel[0] == '.' || info.Name() == "__pycache__") {
			return filepath.SkipDir
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		return copyFile(path, target)
	})
}
