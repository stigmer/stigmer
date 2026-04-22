package runner

import (
	"context"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	runnerv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/runner/v1"
	"google.golang.org/grpc/keepalive"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

const gracefulShutdownTimeout = 5 * time.Second

// StartOptions holds user-provided inputs for starting a runner.
type StartOptions struct {
	Name             string
	EndpointOverride string
	TokenOverride    string
}

// Start is the main orchestration for `stigmer up` / `stigmer up runner`.
// It resolves the backend, registers the runner, bootstraps the Python
// runtime, starts the agent-runner process in the foreground, and waits
// for it to exit or for a shutdown signal.
func Start(ctx context.Context, opts StartOptions) error {
	name, err := resolveRunnerName(opts.Name)
	if err != nil {
		return errors.Wrap(err, "failed to resolve runner name")
	}

	if IsActive(name) {
		return errors.Errorf("runner %q is already running", name)
	}

	cfg, err := config.Load()
	if err != nil {
		climsg.Warning("Failed to load config, using defaults")
		cfg = config.GetDefault()
	}

	backendInfo, err := ResolveBackendInfo(ResolveOptions{
		EndpointOverride: opts.EndpointOverride,
		TokenOverride:    opts.TokenOverride,
		Config:           cfg,
	})
	if err != nil {
		return err
	}

	climsg.Info("Connecting to backend at %s ...", backendInfo.Endpoint)

	client, err := createClient(backendInfo)
	if err != nil {
		return errors.Wrap(err, "failed to connect to backend")
	}
	defer client.Close()

	org := backendInfo.Org
	climsg.Info("Registering runner %q ...", name)

	applied, err := client.Runner.Apply(ctx, &stigmer.RunnerInput{
		Name: name,
		Slug: name,
		Org:  org,
	})
	if err != nil {
		return errors.Wrap(err, "failed to register runner with backend")
	}

	runnerID := applied.GetMetadata().GetId()
	taskQueue := applied.GetStatus().GetTaskQueue()

	log.Info().
		Str("runner_id", runnerID).
		Str("task_queue", taskQueue).
		Msg("Runner registered")

	climsg.Info("Bootstrapping Python runtime ...")

	pythonBin, appDir, err := BootstrapPythonRuntime(ctx)
	if err != nil {
		return err
	}

	dataDir, err := config.GetDataDir()
	if err != nil {
		return errors.Wrap(err, "failed to resolve data directory")
	}

	envParams := buildEnvParams(cfg, backendInfo, runnerID, taskQueue, dataDir, appDir)
	env := BuildRunnerEnv(envParams)

	climsg.Info("Starting agent runner ...")

	proc, err := startPythonProcess(pythonBin, appDir, env)
	if err != nil {
		return errors.Wrap(err, "failed to start agent-runner process")
	}

	if err := SaveState(name, &RunnerState{
		RunnerID:        runnerID,
		Slug:            name,
		Org:             org,
		BackendEndpoint: backendInfo.Endpoint,
		PID:             proc.Process.Pid,
		TaskQueue:       taskQueue,
		StartedAt:       time.Now(),
	}); err != nil {
		log.Warn().Err(err).Msg("Failed to save runner state (non-fatal)")
	}

	climsg.Success("Runner %q started (PID %d)", name, proc.Process.Pid)

	exitErr := waitForExitOrSignal(proc)

	shutdown(client, runnerID, name)

	return exitErr
}

func resolveRunnerName(flagValue string) (string, error) {
	if flagValue != "" {
		return flagValue, nil
	}
	hostname, err := os.Hostname()
	if err != nil {
		return "", errors.Wrap(err, "failed to get hostname for default runner name")
	}
	return hostname, nil
}

func createClient(info *BackendInfo) (*stigmer.Client, error) {
	opts := []stigmer.ClientOption{
		stigmer.WithBaseURL(info.Endpoint),
		stigmer.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                30 * time.Second,
			Timeout:             10 * time.Second,
			PermitWithoutStream: false,
		}),
	}

	if info.IsLocal {
		opts = append(opts, stigmer.WithInsecure())
	}
	if info.Token != "" {
		opts = append(opts, stigmer.WithToken(info.Token))
	}

	client, err := stigmer.NewClient(opts...)
	if err != nil {
		return nil, err
	}

	connectCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := client.Connect(connectCtx); err != nil {
		client.Close()
		return nil, err
	}
	return client, nil
}

func buildEnvParams(
	cfg *config.Config,
	info *BackendInfo,
	runnerID, taskQueue, dataDir, appDir string,
) EnvParams {
	params := EnvParams{
		BackendInfo: info,
		RunnerID:    runnerID,
		TaskQueue:   taskQueue,
		DataDir:     dataDir,
		AppDir:      appDir,
	}

	if cfg.Backend.Local != nil {
		local := cfg.Backend.Local
		params.LLMProvider = local.ResolveLLMProvider()
		params.LLMModel = local.ResolveLLMModel()
		params.LLMBaseURL = local.ResolveLLMBaseURL()
		params.LLMAPIKey = local.ResolveLLMAPIKey()
		params.ExecMode = local.ResolveExecutionMode()
		params.SandboxImage = local.ResolveSandboxImage()
		params.SandboxAutoPull = local.ResolveSandboxAutoPull()
		params.SandboxCleanup = local.ResolveSandboxCleanup()
		params.SandboxTTL = local.ResolveSandboxTTL()
	}

	return params
}

func startPythonProcess(pythonBin, appDir string, env []string) (*exec.Cmd, error) {
	mainPy := filepath.Join(appDir, "main.py")
	if _, err := os.Stat(mainPy); err != nil {
		return nil, errors.Wrapf(err, "agent-runner entry point not found at %s", mainPy)
	}

	cmd := exec.Command(pythonBin, mainPy)
	cmd.Dir = appDir
	cmd.Env = env
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return cmd, nil
}

// waitForExitOrSignal blocks until the Python process exits or a SIGINT/SIGTERM
// is received. On signal, it sends SIGTERM to the child and waits up to
// gracefulShutdownTimeout before sending SIGKILL.
func waitForExitOrSignal(cmd *exec.Cmd) error {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	exitCh := make(chan error, 1)
	go func() {
		exitCh <- cmd.Wait()
	}()

	select {
	case err := <-exitCh:
		signal.Stop(sigCh)
		if err != nil {
			climsg.Warning("Agent runner exited with error: %v", err)
			return errors.Wrap(err, "agent-runner process exited with error")
		}
		climsg.Info("Agent runner exited normally")
		return nil

	case sig := <-sigCh:
		climsg.Info("Received %s, shutting down runner ...", sig)
		return terminateChild(cmd, exitCh)
	}
}

func terminateChild(cmd *exec.Cmd, exitCh <-chan error) error {
	if cmd.Process == nil {
		return nil
	}
	_ = cmd.Process.Signal(syscall.SIGTERM)

	select {
	case <-exitCh:
		return nil
	case <-time.After(gracefulShutdownTimeout):
		log.Warn().Msg("Agent runner did not exit in time, sending SIGKILL")
		_ = cmd.Process.Kill()
		<-exitCh
		return nil
	}
}

func shutdown(client *stigmer.Client, runnerID, name string) {
	if runnerID != "" {
		sendStoppedHeartbeat(client, runnerID)
	}
	if err := RemoveState(name); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("Failed to remove runner state")
	}
}

func sendStoppedHeartbeat(client *stigmer.Client, runnerID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := client.Runner.Heartbeat(ctx, &runnerv1.RunnerHeartbeatInput{
		RunnerId: runnerID,
		Phase:    runnerv1.RunnerPhase_RUNNER_PHASE_STOPPED,
	})
	if err != nil {
		log.Warn().Err(err).Msg("Failed to send STOPPED heartbeat (non-fatal)")
	} else {
		log.Info().Msg("Sent STOPPED heartbeat to backend")
	}
}
