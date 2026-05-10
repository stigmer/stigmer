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

// IsCursorRunnerAvailable reports whether the cursor-runner can be started.
//
// Cloud mode (!IsLocal): the proxy endpoint is derived from the backend
// endpoint at child-env construction time, so no CURSOR_API_KEY is needed.
// Local mode: direct Cursor API access requires an explicit CURSOR_API_KEY.
func IsCursorRunnerAvailable(backendInfo *BackendInfo) bool {
	if !cursorrunner.IsAvailable() {
		return false
	}
	if backendInfo != nil && !backendInfo.IsLocal {
		return true
	}
	return os.Getenv("CURSOR_API_KEY") != ""
}

// BootstrapCursorRunnerRuntime prepares the Node.js runtime and installs
// dependencies for the cursor-runner.
//
// Both modes use a hermetic managed Node.js runtime (downloaded to
// ~/.stigmer/runtimes/) so the cursor-runner works identically in CLI
// terminals, Desktop sidecars (where PATH lacks nvm), CI, and production.
// The modes differ only in where the application source comes from:
//
//   - Dev mode (SourceDir != ""): TypeScript source from the repo tree,
//     executed via tsx. Dependencies installed in the repo's node_modules.
//   - Embed mode (SourceFS != nil, SourceDir == ""): compiled JS extracted
//     from the binary. Dependencies installed in the managed app directory.
func BootstrapCursorRunnerRuntime(ctx context.Context) (*CursorRunnerBootstrapResult, error) {
	if cursorrunner.SourceDir() != "" {
		return bootstrapCursorRunnerDevMode(ctx)
	}
	return bootstrapCursorRunnerEmbedMode(ctx)
}

func bootstrapCursorRunnerDevMode(ctx context.Context) (*CursorRunnerBootstrapResult, error) {
	appDir := cursorrunner.SourceDir()
	if _, err := os.Stat(filepath.Join(appDir, "package.json")); err != nil {
		return nil, errors.Wrapf(err, "cursor-runner package.json not found at %s", appDir)
	}

	mgr, err := ensureManagedNodeRuntime(ctx)
	if err != nil {
		return nil, err
	}

	nodeBin := mgr.NodeBin()

	installCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	if err := nodert.EnsureDepsInstalledWith(installCtx, appDir, nodeBin, mgr.NpmBin()); err != nil {
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

// ensureManagedNodeRuntime provisions the hermetic Node.js runtime shared
// by both dev and embed modes. The managed runtime is downloaded once to
// ~/.stigmer/runtimes/cursor-runner/ and cached across CLI invocations.
func ensureManagedNodeRuntime(ctx context.Context) (*nodert.Manager, error) {
	configDir, err := cliconfig.GetConfigDir()
	if err != nil {
		return nil, errors.Wrap(err, "failed to resolve config directory")
	}

	mgr, err := nodert.NewManager(nodert.Config{
		BaseDir:    filepath.Join(configDir, "runtimes", "cursor-runner"),
		CLIVersion: embedded.GetBuildVersion(),
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to create Node.js runtime manager")
	}

	bootstrapCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	if err := mgr.EnsureReady(bootstrapCtx); err != nil {
		return nil, errors.Wrap(err, "failed to bootstrap Node.js runtime")
	}

	return mgr, nil
}

func bootstrapCursorRunnerEmbedMode(ctx context.Context) (*CursorRunnerBootstrapResult, error) {
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
		Msg("Bootstrapping Node.js runtime for cursor-runner (embed mode)")

	bootstrapCtx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()

	if err := mgr.EnsureReady(bootstrapCtx); err != nil {
		return nil, errors.Wrap(err, "failed to bootstrap Node.js runtime")
	}

	return &CursorRunnerBootstrapResult{
		NodeBin:   mgr.NodeBin(),
		AppDir:    mgr.AppDir(),
		EntryArgs: []string{filepath.Join("dist", "main.js")},
	}, nil
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
