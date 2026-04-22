package runner

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	stigmer "github.com/stigmer/stigmer/sdk/go"
	"google.golang.org/grpc/keepalive"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
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
	if reaped := ReapStaleRunners(); len(reaped) > 0 {
		for _, name := range reaped {
			log.Debug().Str("name", name).Msg("Cleaned up stale runner state")
		}
	}

	name, err := resolveRunnerName(opts.Name)
	if err != nil {
		return errors.Wrap(err, "failed to resolve runner name")
	}

	if err := checkNameConflict(name); err != nil {
		return err
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

	// Start the bidi command stream alongside the Python process.
	// The stream sends heartbeats and handles server-initiated commands.
	streamCtx, streamCancel := context.WithCancel(context.Background())
	var streamWg sync.WaitGroup

	rsc := daemon.NewRunnerStreamClient(daemon.RunnerStreamConfig{
		RunnerID: runnerID,
		ConnectFn: func(ctx context.Context) (daemon.CommandStream, error) {
			s, err := client.Runner.Connect(ctx)
			if err != nil {
				return nil, err
			}
			return s, nil
		},
	})

	streamWg.Add(1)
	go func() {
		defer streamWg.Done()
		if err := rsc.Run(streamCtx); err != nil && streamCtx.Err() == nil {
			log.Warn().Err(err).Msg("Runner stream exited unexpectedly")
		}
	}()

	exitErr := waitForExitOrSignal(proc)

	// Cancel the stream context — triggers STOPPED heartbeat inside Run.
	streamCancel()
	streamWg.Wait()

	if err := RemoveState(name); err != nil {
		log.Warn().Err(err).Str("name", name).Msg("Failed to remove runner state")
	}

	return exitErr
}

const maxSlugLength = 63

var validSlugPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

func resolveRunnerName(flagValue string) (string, error) {
	if flagValue != "" {
		if err := validateSlug(flagValue); err != nil {
			return "", err
		}
		return flagValue, nil
	}
	hostname, err := os.Hostname()
	if err != nil {
		return "", errors.Wrap(err, "failed to get hostname for default runner name")
	}
	slug := sanitizeToSlug(hostname)
	if slug == "" {
		return "", errors.New(
			"hostname could not be converted to a valid runner name\n\n" +
				"Provide an explicit name:\n" +
				"  stigmer up --name <name>",
		)
	}
	if slug != hostname {
		climsg.Info("Using %q as runner name (sanitized from hostname %q)", slug, hostname)
	}
	return slug, nil
}

func validateSlug(s string) error {
	if len(s) > maxSlugLength {
		return fmt.Errorf(
			"runner name %q is too long (%d chars, max %d)\n\n"+
				"Use a shorter name:\n"+
				"  stigmer up --name <name>",
			s, len(s), maxSlugLength,
		)
	}
	if !validSlugPattern.MatchString(s) {
		return fmt.Errorf(
			"runner name %q is not a valid slug\n\n"+
				"Names must be lowercase alphanumeric with hyphens, and cannot\n"+
				"start or end with a hyphen. Examples: my-runner, build-01, macbook",
			s,
		)
	}
	return nil
}

// sanitizeToSlug converts an arbitrary hostname into a slug-safe string.
// Returns empty string if the hostname cannot be salvaged.
func sanitizeToSlug(hostname string) string {
	s := strings.ToLower(hostname)
	s = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			return r
		}
		return '-'
	}, s)

	// Collapse consecutive hyphens.
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	s = strings.Trim(s, "-")

	if len(s) > maxSlugLength {
		s = s[:maxSlugLength]
		s = strings.TrimRight(s, "-")
	}
	return s
}

func checkNameConflict(name string) error {
	state, err := LoadState(name)
	if err != nil {
		return nil
	}
	if !isProcessAlive(state.PID) {
		_ = RemoveState(name)
		return nil
	}

	return fmt.Errorf(
		"runner %q is already running\n"+
			"  PID:     %d\n"+
			"  Backend: %s\n"+
			"  Started: %s\n\n"+
			"To start another runner, provide a different name:\n"+
			"  stigmer up --name <name>\n\n"+
			"To see all active runners:\n"+
			"  stigmer list runners",
		name, state.PID, state.BackendEndpoint, formatRelativeTime(state.StartedAt),
	)
}

func formatRelativeTime(t time.Time) string {
	d := time.Since(t)
	switch {
	case d < time.Minute:
		return "just now"
	case d < time.Hour:
		m := int(d.Minutes())
		if m == 1 {
			return "1 minute ago"
		}
		return fmt.Sprintf("%d minutes ago", m)
	case d < 24*time.Hour:
		h := int(d.Hours())
		if h == 1 {
			return "1 hour ago"
		}
		return fmt.Sprintf("%d hours ago", h)
	default:
		days := int(d.Hours() / 24)
		if days == 1 {
			return "1 day ago"
		}
		return fmt.Sprintf("%d days ago", days)
	}
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

