package daemon

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/agentrunner"
	cliconfig "github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/pythonrt"
)

// startAgentRunnerNative starts the agent-runner as a native OS process
// backed by a hermetic CPython runtime managed by pythonrt.
func startAgentRunnerNative(
	dataDir string,
	logDir string,
	llmProvider string,
	llmModel string,
	llmBaseURL string,
	temporalAddr string,
	secrets map[string]string,
	executionMode string,
	sandboxImage string,
	sandboxAutoPull bool,
	sandboxCleanup bool,
	sandboxTTL int,
) error {
	sourceFS := agentrunner.SourceFS()
	if sourceFS == nil {
		return errors.New("agent-runner Python source is not available (not embedded and not found in repo tree)")
	}

	configDir, err := cliconfig.GetConfigDir()
	if err != nil {
		return errors.Wrap(err, "failed to resolve config directory")
	}

	mgr, err := pythonrt.NewManager(pythonrt.Config{
		BaseDir:     filepath.Join(configDir, "runtimes", "agent-runner"),
		CLIVersion:  embedded.GetBuildVersion(),
		AppSourceFS: sourceFS,
	})
	if err != nil {
		return errors.Wrap(err, "failed to create Python runtime manager")
	}

	log.Info().
		Str("runtime_dir", mgr.RuntimeDir()).
		Msg("Bootstrapping Python runtime for agent-runner")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if err := mgr.EnsureReady(ctx); err != nil {
		return errors.Wrap(err, "failed to bootstrap Python runtime")
	}

	workspaceDir := filepath.Join(dataDir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create workspace directory")
	}

	artifactsDir := filepath.Join(dataDir, "artifacts")
	if err := os.MkdirAll(artifactsDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create artifacts directory")
	}

	env := buildNativeAgentRunnerEnv(
		dataDir, temporalAddr, llmProvider, llmModel, llmBaseURL,
		executionMode, sandboxImage, sandboxAutoPull, sandboxCleanup, sandboxTTL,
		secrets,
	)

	mainPy := filepath.Join(mgr.AppDir(), "main.py")
	if _, err := os.Stat(mainPy); err != nil {
		return errors.Wrapf(err, "agent-runner entry point not found at %s", mainPy)
	}

	cmd := exec.Command(mgr.PythonBin(), mainPy)
	cmd.Dir = mgr.AppDir()
	cmd.Env = env

	logFile := filepath.Join(logDir, "agent-runner.log")
	logOutput, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create agent-runner log file")
	}
	defer logOutput.Close()

	cmd.Stdout = logOutput
	cmd.Stderr = logOutput

	if err := cmd.Start(); err != nil {
		return errors.Wrap(err, "failed to start agent-runner process")
	}

	pidFile := filepath.Join(dataDir, AgentRunnerPIDFileName)
	if err := os.WriteFile(pidFile, []byte(fmt.Sprintf("%d", cmd.Process.Pid)), 0644); err != nil {
		_ = cmd.Process.Kill()
		return errors.Wrap(err, "failed to write agent-runner PID file")
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Str("python", mgr.PythonBin()).
		Str("app_dir", mgr.AppDir()).
		Msg("Agent-runner started as native process")

	time.Sleep(2 * time.Second)

	if err := cmd.Process.Signal(syscall.Signal(0)); err != nil {
		logContent, _ := os.ReadFile(logFile)
		lastLines := tailBytes(logContent, 2000)
		return errors.Errorf(
			"agent-runner crashed immediately after startup (PID %d)\nLast log output:\n%s",
			cmd.Process.Pid, lastLines,
		)
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Msg("Agent-runner native process health check passed")

	return nil
}

// buildNativeAgentRunnerEnv constructs the environment for native agent-runner.
// Unlike Docker mode, native mode uses real host paths (no mount indirection)
// and localhost addresses (no host.docker.internal resolution).
func buildNativeAgentRunnerEnv(
	dataDir string,
	temporalAddr string,
	llmProvider string,
	llmModel string,
	llmBaseURL string,
	executionMode string,
	sandboxImage string,
	sandboxAutoPull bool,
	sandboxCleanup bool,
	sandboxTTL int,
	secrets map[string]string,
) []string {
	workspaceDir := filepath.Join(dataDir, "workspace")
	artifactsDir := filepath.Join(dataDir, "artifacts")

	env := os.Environ()
	env = append(env,
		"MODE=local",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", DaemonPort),
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr),
		"TEMPORAL_NAMESPACE=default",
		"TASK_QUEUE=agent_execution_runner",
		"SANDBOX_TYPE=filesystem",

		// Native mode: use the real host path.
		// The Python agent-runner reads SANDBOX_ROOT_DIR (not WORKSPACE_ROOT).
		fmt.Sprintf("SANDBOX_ROOT_DIR=%s", workspaceDir),

		"LOG_LEVEL=DEBUG",

		fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", llmProvider),
		fmt.Sprintf("STIGMER_LLM_MODEL=%s", llmModel),
		fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
		fmt.Sprintf("OLLAMA_BASE_URL=%s", llmBaseURL),

		fmt.Sprintf("STIGMER_EXECUTION_MODE=%s", executionMode),
		fmt.Sprintf("STIGMER_SANDBOX_IMAGE=%s", sandboxImage),
		fmt.Sprintf("STIGMER_SANDBOX_AUTO_PULL=%t", sandboxAutoPull),
		fmt.Sprintf("STIGMER_SANDBOX_CLEANUP=%t", sandboxCleanup),
		fmt.Sprintf("STIGMER_SANDBOX_TTL=%d", sandboxTTL),

		fmt.Sprintf("LOCAL_ARTIFACT_PATH=%s", artifactsDir),
		fmt.Sprintf("LOCAL_ARTIFACT_SERVE_URL=http://localhost:%d", DaemonPort+1),
	)

	for key, value := range secrets {
		env = append(env, fmt.Sprintf("%s=%s", key, value))
	}

	return env
}

// probeNativeAgentRunnerViability checks whether the native agent-runner can
// be bootstrapped on the current platform. Used in "auto" mode to decide
// between native and Docker before starting the server. This is intentionally
// lightweight — it creates a Manager and checks platform support, but does not
// download anything or start a process.
func probeNativeAgentRunnerViability(_ *cliconfig.Config) bool {
	configDir, err := cliconfig.GetConfigDir()
	if err != nil {
		log.Debug().Err(err).Msg("Cannot resolve config dir for native viability check")
		return false
	}
	_, err = pythonrt.NewManager(pythonrt.Config{
		BaseDir:    filepath.Join(configDir, "runtimes", "agent-runner"),
		CLIVersion: embedded.GetBuildVersion(),
	})
	return err == nil
}

// tailBytes returns the last n bytes of b as a string. If b is shorter
// than n, it returns all of b.
func tailBytes(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	return "..." + string(b[len(b)-n:])
}
