package runner

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/cursorrunner"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/nodert"
)

// IsCursorRunnerAvailable reports whether the cursor-runner can be started.
// Requires cursor-runner source AND either:
// - CURSOR_API_KEY (direct mode, local/OSS)
// - STIGMER_PROXY_ENDPOINT (proxy mode, cloud — no CURSOR_API_KEY needed)
func IsCursorRunnerAvailable() bool {
	if !cursorrunner.IsAvailable() {
		return false
	}
	return os.Getenv("CURSOR_API_KEY") != "" || os.Getenv("STIGMER_PROXY_ENDPOINT") != ""
}

// BootstrapCursorRunnerRuntime prepares the Node.js runtime and installs
// dependencies for the cursor-runner. Shared bootstrap logic with the
// daemon path via the nodert package.
func BootstrapCursorRunnerRuntime(ctx context.Context) (nodeBin string, appDir string, err error) {
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

	installCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	if err := nodert.EnsureDepsInstalled(installCtx, appDir); err != nil {
		return "", "", errors.Wrap(err, "failed to install cursor-runner dependencies")
	}

	log.Info().
		Str("node", nodeBin).
		Str("app_dir", appDir).
		Msg("Cursor runner runtime bootstrapped")

	return nodeBin, appDir, nil
}

// CursorEnvParams holds the values needed to construct the cursor-runner's
// environment. Mirrors EnvParams for the Python agent-runner.
type CursorEnvParams struct {
	BackendInfo *BackendInfo
	RunnerID    string
	TaskQueue   string
	DataDir     string
	AppDir      string
}

// BuildCursorRunnerEnv constructs the environment variable slice for the
// cursor-runner TypeScript process. Supports both local and cloud modes.
func BuildCursorRunnerEnv(params CursorEnvParams) []string {
	workspaceDir := filepath.Join(params.DataDir, "workspace")
	_ = os.MkdirAll(workspaceDir, 0755)

	env := os.Environ()
	env = append(env,
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=%s", normalizeEndpoint(params.BackendInfo.Endpoint)),
		fmt.Sprintf("STIGMER_RUNNER_ID=%s", params.RunnerID),
		fmt.Sprintf("WORKSPACE_ROOT_DIR=%s", workspaceDir),
		"LOG_LEVEL=DEBUG",
	)

	if params.TaskQueue != "" {
		env = append(env, fmt.Sprintf("STIGMER_TASK_QUEUE=%s", params.TaskQueue))
	} else {
		env = append(env, "TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner")
	}

	if params.BackendInfo.IsLocal {
		env = append(env, "MODE=local")
		env = appendCursorLocalEnv(env, params)
	} else {
		env = append(env, "MODE=cloud")
		env = appendCursorCloudEnv(env, params)
	}

	return env
}

func appendCursorLocalEnv(env []string, params CursorEnvParams) []string {
	env = append(env,
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", params.BackendInfo.TemporalAddress),
		fmt.Sprintf("TEMPORAL_NAMESPACE=%s", params.BackendInfo.TemporalNamespace),
	)
	return env
}

func appendCursorCloudEnv(env []string, params CursorEnvParams) []string {
	if params.BackendInfo.Token != "" {
		env = append(env, fmt.Sprintf("STIGMER_TOKEN=%s", params.BackendInfo.Token))
	}

	// Enable proxy mode: the cursor-runner's fetch interceptor rewrites
	// outbound Cursor SDK requests to route through Stigmer's proxy.
	// The proxy injects the real CURSOR_API_KEY — the runner only needs
	// STIGMER_TOKEN.
	proxyEndpoint := grpcEndpointToHTTPS(params.BackendInfo.Endpoint)
	env = append(env, fmt.Sprintf("STIGMER_PROXY_ENDPOINT=%s", proxyEndpoint))

	env = append(env,
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", defaultCloudTemporalAddress),
		"TEMPORAL_NAMESPACE=default",
	)

	return env
}

// normalizeEndpoint ensures the endpoint has an HTTP(S) scheme.
// The cursor-runner uses Connect-ES (HTTP transport) and needs the scheme.
func normalizeEndpoint(endpoint string) string {
	if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
		return endpoint
	}
	if strings.HasSuffix(endpoint, ":443") {
		return "https://" + strings.TrimSuffix(endpoint, ":443")
	}
	return "http://" + endpoint
}
