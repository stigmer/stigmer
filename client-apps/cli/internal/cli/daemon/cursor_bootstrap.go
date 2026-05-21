package daemon

import (
	"context"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/nodert"
)

// RunnerBootstrapResult holds the output of the unified runner bootstrap.
type RunnerBootstrapResult struct {
	NodeBin   string
	AppDir    string
	EntryArgs []string
}

// bootstrapRunnerRuntime prepares the Node.js runtime for the unified runner
// at backend/services/runner/. In dev mode, it discovers the runner source
// directory relative to the CLI binary and uses tsx for TypeScript execution.
func bootstrapRunnerRuntime() (*RunnerBootstrapResult, error) {
	appDir := findRunnerDir()
	if appDir == "" {
		return nil, errors.New("unified runner (backend/services/runner) not found. " +
			"Ensure the runner is available or set STIGMER_RUNNER_DIR")
	}

	if _, err := os.Stat(filepath.Join(appDir, "package.json")); err != nil {
		return nil, errors.Wrapf(err, "runner package.json not found at %s", appDir)
	}

	nodeBin, err := nodert.EnsureNodeAvailable()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if err := nodert.EnsureDepsInstalled(ctx, appDir); err != nil {
		return nil, errors.Wrap(err, "failed to install runner dependencies")
	}

	tsxArgs, err := nodert.TsxArgs(appDir, filepath.Join("src", "main.ts"))
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve tsx entry point")
	}

	log.Info().
		Str("node", nodeBin).
		Str("app_dir", appDir).
		Msg("Runner runtime bootstrapped")

	return &RunnerBootstrapResult{
		NodeBin:   nodeBin,
		AppDir:    appDir,
		EntryArgs: tsxArgs,
	}, nil
}

func findRunnerDir() string {
	if dir := os.Getenv("STIGMER_RUNNER_DIR"); dir != "" {
		return dir
	}

	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	repoRoot := filepath.Dir(filepath.Dir(filepath.Dir(filepath.Dir(exe))))
	candidate := filepath.Join(repoRoot, "backend", "services", "runner")
	if _, err := os.Stat(filepath.Join(candidate, "package.json")); err == nil {
		return candidate
	}

	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	candidate = filepath.Join(cwd, "backend", "services", "runner")
	if _, err := os.Stat(filepath.Join(candidate, "package.json")); err == nil {
		return candidate
	}

	return ""
}
