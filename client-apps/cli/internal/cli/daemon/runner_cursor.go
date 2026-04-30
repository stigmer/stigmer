package daemon

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/cursorrunner"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/nodert"
)

// bootstrapCursorRunnerRuntime prepares the Node.js runtime and installs
// dependencies for the cursor-runner. Returns the node binary path and
// the cursor-runner source directory.
//
// This runs in the foreground CLI so the user sees bootstrap progress.
// Called only when CURSOR_API_KEY is available and cursor-runner source
// is found.
func bootstrapCursorRunnerRuntime() (nodeBin string, appDir string, err error) {
	appDir = cursorrunner.SourceDir()
	if appDir == "" {
		return "", "", errors.New("cursor-runner source directory not found")
	}

	if _, err := os.Stat(filepath.Join(appDir, "package.json")); err != nil {
		return "", "", errors.Wrapf(err, "cursor-runner package.json not found at %s", appDir)
	}

	nodeBin, err = nodert.EnsureNodeAvailable()
	if err != nil {
		return "", "", err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	if err := nodert.EnsureDepsInstalled(ctx, appDir); err != nil {
		return "", "", errors.Wrap(err, "failed to install cursor-runner dependencies")
	}

	log.Info().
		Str("node", nodeBin).
		Str("app_dir", appDir).
		Msg("Cursor runner runtime bootstrapped")

	return nodeBin, appDir, nil
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
