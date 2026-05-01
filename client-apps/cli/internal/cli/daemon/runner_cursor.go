package daemon

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/cursorrunner"
	cliconfig "github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/nodert"
)

// CursorRunnerBootstrapResult holds the output of cursor-runner bootstrap.
// EntryArgs contains the arguments for the cursor-runner entry point:
// dev mode returns tsx args; embed mode returns ["dist/main.js"].
type CursorRunnerBootstrapResult struct {
	NodeBin   string
	AppDir    string
	EntryArgs []string
}

// bootstrapCursorRunnerRuntime prepares the Node.js runtime and installs
// dependencies for the cursor-runner. Returns bootstrap result containing
// the node binary path, app directory, and entry point args.
//
// Two modes:
//   - Dev mode (SourceDir != ""): system Node.js + tsx, source from repo tree
//   - Embed mode (SourceFS != nil, SourceDir == ""): managed Node.js + compiled JS
func bootstrapCursorRunnerRuntime() (*CursorRunnerBootstrapResult, error) {
	if cursorrunner.SourceDir() != "" {
		return bootstrapCursorRunnerDevMode()
	}
	return bootstrapCursorRunnerEmbedMode()
}

// bootstrapCursorRunnerDevMode uses system Node.js + tsx with source from
// the repository tree. This is the T05 flow, preserved for developers.
func bootstrapCursorRunnerDevMode() (*CursorRunnerBootstrapResult, error) {
	appDir := cursorrunner.SourceDir()
	if _, err := os.Stat(filepath.Join(appDir, "package.json")); err != nil {
		return nil, errors.Wrapf(err, "cursor-runner package.json not found at %s", appDir)
	}

	nodeBin, err := nodert.EnsureNodeAvailable()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if err := nodert.EnsureDepsInstalled(ctx, appDir); err != nil {
		return nil, errors.Wrap(err, "failed to install cursor-runner dependencies")
	}

	tsxArgs, err := nodert.TsxArgs(appDir, filepath.Join("src", "main.ts"))
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve tsx entry point")
	}

	log.Info().
		Str("node", nodeBin).
		Str("app_dir", appDir).
		Msg("Cursor runner runtime bootstrapped (dev mode)")

	return &CursorRunnerBootstrapResult{
		NodeBin:   nodeBin,
		AppDir:    appDir,
		EntryArgs: tsxArgs,
	}, nil
}

// bootstrapCursorRunnerEmbedMode uses a managed Node.js runtime with compiled
// JS extracted from the embedded source. Downloads Node.js on first run.
func bootstrapCursorRunnerEmbedMode() (*CursorRunnerBootstrapResult, error) {
	sourceFS := cursorrunner.SourceFS()
	if sourceFS == nil {
		return nil, errors.New("cursor-runner source is not available. " +
			"If building from source, run sync.sh and build with -tags embed_cursorrunner")
	}

	configDir, err := cliconfig.GetConfigDir()
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve config directory")
	}

	mgr, err := nodert.NewManager(nodert.Config{
		BaseDir:     filepath.Join(configDir, "runtimes", "cursor-runner"),
		CLIVersion:  embedded.GetBuildVersion(),
		AppSourceFS: sourceFS,
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to create Node.js runtime manager")
	}

	log.Info().
		Str("runtime_dir", mgr.RuntimeDir()).
		Msg("Bootstrapping Node.js runtime for cursor-runner")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if err := mgr.EnsureReady(ctx); err != nil {
		return nil, errors.Wrap(err, "failed to bootstrap Node.js runtime")
	}

	return &CursorRunnerBootstrapResult{
		NodeBin:   mgr.NodeBin(),
		AppDir:    mgr.AppDir(),
		EntryArgs: []string{filepath.Join("dist", "main.js")},
	}, nil
}

// buildCursorRunnerEnv constructs the environment for the cursor-runner
// child process in the daemon (local mode).
//
// The daemon always runs in local mode. Cloud-mode cursor-runner deployments
// are handled by Kubernetes, not the CLI daemon.
func buildCursorRunnerEnv(dataDir string, grpcPort int, runnerID, taskQueue string) []string {
	workspaceDir := filepath.Join(dataDir, "workspace")
	_ = os.MkdirAll(workspaceDir, 0755)

	env := os.Environ()
	env = append(env,
		"MODE=local",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=http://localhost:%d", grpcPort),
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", os.Getenv("TEMPORAL_SERVICE_ADDRESS")),
		"TEMPORAL_NAMESPACE=default",
		fmt.Sprintf("WORKSPACE_ROOT_DIR=%s", workspaceDir),
		"LOG_LEVEL=DEBUG",
	)

	if runnerID != "" {
		env = append(env, fmt.Sprintf("STIGMER_RUNNER_ID=%s", runnerID))
	}

	if taskQueue != "" {
		env = append(env, fmt.Sprintf("STIGMER_TASK_QUEUE=%s", taskQueue))
	} else {
		env = append(env, "TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner")
	}

	if cursorKey := os.Getenv("CURSOR_API_KEY"); cursorKey != "" {
		env = append(env, fmt.Sprintf("CURSOR_API_KEY=%s", cursorKey))
	}

	return env
}
