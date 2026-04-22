package runner

import (
	"context"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/agentrunner"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/pythonrt"
)

const bootstrapTimeout = 10 * time.Minute

// BootstrapPythonRuntime ensures the Python agent-runner runtime is ready,
// downloading the standalone Python interpreter and installing dependencies
// as needed. Returns the venv Python binary and the extracted app directory.
//
// This reuses the same pythonrt.Manager that the daemon's bootstrap uses —
// both are callers of the shared runtime manager, not duplicated logic.
func BootstrapPythonRuntime(ctx context.Context) (pythonBin, appDir string, err error) {
	sourceFS := agentrunner.SourceFS()
	if sourceFS == nil {
		return "", "", errors.New("agent-runner Python source is not available (not embedded and not found in repo tree)")
	}

	configDir, err := config.GetConfigDir()
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
		Msg("Bootstrapping Python runtime for standalone runner")

	bootstrapCtx, cancel := context.WithTimeout(ctx, bootstrapTimeout)
	defer cancel()

	if err := mgr.EnsureReady(bootstrapCtx); err != nil {
		return "", "", errors.Wrap(err, "failed to bootstrap Python runtime")
	}

	return mgr.PythonBin(), mgr.AppDir(), nil
}

// buildPreInstallFn returns a hook that copies monorepo path dependencies into
// the app directory before pip runs. In production (embed) builds this returns
// nil because sync.sh already places deps under libs/. In dev builds the
// source FS points only at the agent-runner directory, so graphton and
// stigmer-protos must be copied from the repo tree.
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
			log.Info().Str("src", dep.src).Str("target", dep.target).Msg("Copying path dependency")
			if err := copyDirFiltered(dep.src, dep.target); err != nil {
				return errors.Wrapf(err, "failed to copy path dependency from %s", dep.src)
			}
		}
		return nil
	}
}
