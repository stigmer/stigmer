package runner

import (
	"context"
	"fmt"
	"io"
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

	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/cursorrunner"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/daemon"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

const gracefulShutdownTimeout = 5 * time.Second

// maxLogFileBytes caps the runner log file at 2 MiB. On each startup the
// file is truncated, so this limit bounds a single session's on-disk cost.
const maxLogFileBytes = 2 * 1024 * 1024

// StartOptions holds user-provided inputs for starting a runner.
type StartOptions struct {
	Name             string
	EndpointOverride string
	TokenOverride    string
	OrgOverride      string
	Runtime          string // "native" (default) or "docker"
	Image            string // Docker image override (only used when Runtime="docker")
}

// registeredRunner holds the result of the common registration phase that
// both native and Docker runners share.
type registeredRunner struct {
	name        string
	org         string
	runnerID    string
	taskQueue   string
	cfg         *config.Config
	backendInfo *BackendInfo
	client      *stigmer.Client
}

// Start is the main orchestration for `stigmer up` / `stigmer up runner`.
// It resolves the backend, registers the runner, and then dispatches to
// the runtime-specific path (native Python process or Docker container).
func Start(ctx context.Context, opts StartOptions) error {
	if reaped := ReapStaleRunners(); len(reaped) > 0 {
		for _, name := range reaped {
			log.Debug().Str("name", name).Msg("Cleaned up stale runner state")
		}
	}

	runtime := resolveRuntime(opts.Runtime)

	if runtime == RuntimeDocker {
		dc := NewDockerClient()
		if err := dc.IsAvailable(ctx); err != nil {
			return err
		}
	}

	name, err := resolveRunnerName(opts.Name)
	if err != nil {
		return errors.Wrap(err, "failed to resolve runner name")
	}

	if err := checkNameConflict(name); err != nil {
		return err
	}

	if config.IsStandalone() && opts.TokenOverride == "" {
		return errors.New(
			"--standalone mode requires --token or --api-key\n\n" +
				"In standalone mode the config file is not read. All credentials\n" +
				"must be passed explicitly via flags or environment variables.",
		)
	}

	cfg, err := config.Load()
	if err != nil {
		climsg.Warning("Failed to load config, using defaults")
		cfg = config.GetDefault()
	}

	backendInfo, err := ResolveBackendInfo(ResolveOptions{
		EndpointOverride: opts.EndpointOverride,
		TokenOverride:    opts.TokenOverride,
		OrgOverride:      opts.OrgOverride,
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
		Str("runtime", runtime).
		Msg("Runner registered")

	reg := &registeredRunner{
		name:        name,
		org:         org,
		runnerID:    runnerID,
		taskQueue:   taskQueue,
		cfg:         cfg,
		backendInfo: backendInfo,
		client:      client,
	}

	switch runtime {
	case RuntimeDocker:
		return startDockerRunner(ctx, reg, opts.Image)
	default:
		return startNativeRunner(ctx, reg)
	}
}

// cursorHandle provides thread-safe access to a cursor-runner process that
// may be started asynchronously after the main runner is already serving.
type cursorHandle struct {
	mu   sync.Mutex
	proc *exec.Cmd
	done chan struct{} // closed when the cursor-runner process exits
}

func newCursorHandle() *cursorHandle {
	return &cursorHandle{done: make(chan struct{})}
}

func (h *cursorHandle) set(cmd *exec.Cmd) {
	h.mu.Lock()
	h.proc = cmd
	h.mu.Unlock()
}

func (h *cursorHandle) shutdown() {
	h.mu.Lock()
	proc := h.proc
	h.mu.Unlock()

	if proc == nil || proc.Process == nil {
		return
	}

	_ = proc.Process.Signal(syscall.SIGTERM)
	select {
	case <-h.done:
	case <-time.After(gracefulShutdownTimeout):
		_ = proc.Process.Kill()
		<-h.done
	}
}

// startNativeRunner bootstraps a Python venv, starts the agent-runner as a
// local process, optionally starts the cursor-runner alongside it, and blocks
// until exit or shutdown signal.
//
// The cursor-runner bootstrap (Node.js download + npm install) runs in a
// background goroutine so it never delays the heartbeat stream.
func startNativeRunner(ctx context.Context, reg *registeredRunner) error {
	climsg.Info("Bootstrapping Python runtime ...")

	pythonBin, appDir, err := BootstrapPythonRuntime(ctx)
	if err != nil {
		return err
	}

	dataDir, err := config.GetDataDir()
	if err != nil {
		return errors.Wrap(err, "failed to resolve data directory")
	}

	envParams := buildEnvParams(reg.cfg, reg.backendInfo, reg.runnerID, reg.taskQueue, dataDir, appDir)
	env := BuildRunnerEnv(envParams)

	logFile, logFilePath, err := openRunnerLogFile(reg.name)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to open runner log file; logs will only go to stderr")
	}
	if logFile != nil {
		defer logFile.Close()
	}

	climsg.Info("Starting agent runner ...")

	proc, err := startPythonProcess(pythonBin, appDir, env, logFile)
	if err != nil {
		return errors.Wrap(err, "failed to start agent-runner process")
	}

	state := &RunnerState{
		RunnerID:        reg.runnerID,
		Slug:            reg.name,
		Org:             reg.org,
		BackendEndpoint: reg.backendInfo.Endpoint,
		PID:             proc.Process.Pid,
		TaskQueue:       reg.taskQueue,
		StartedAt:       time.Now(),
		Runtime:         RuntimeNative,
	}
	if logFilePath != "" {
		state.LogFile = logFilePath
	}

	if err := SaveState(reg.name, state); err != nil {
		log.Warn().Err(err).Msg("Failed to save runner state (non-fatal)")
	}

	climsg.Success("Runner %q started (PID %d)", reg.name, proc.Process.Pid)

	// Start the heartbeat stream immediately so the server sees this runner
	// as RUNNING without waiting for the cursor-runner bootstrap.
	streamCtx, streamCancel := context.WithCancel(context.Background())
	var streamWg sync.WaitGroup

	rsc := daemon.NewRunnerStreamClient(daemon.RunnerStreamConfig{
		RunnerID: reg.runnerID,
		ConnectFn: func(ctx context.Context) (daemon.CommandStream, error) {
			s, err := reg.client.Runner.Connect(ctx)
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

	// Bootstrap and start the cursor-runner asynchronously. The Node.js
	// download + npm install can take minutes on first run; doing it here
	// avoids blocking the heartbeat and state persistence above.
	cursor := newCursorHandle()
	if IsCursorRunnerAvailable(reg.backendInfo) {
		go func() {
			defer close(cursor.done)

			cursorProc := startCursorRunnerProcess(ctx, reg, dataDir)
			if cursorProc == nil {
				return
			}
			cursor.set(cursorProc)

			// Update the on-disk state with the cursor-runner PID.
			if existing, loadErr := LoadState(reg.name); loadErr == nil {
				existing.CursorRunnerPID = cursorProc.Process.Pid
				if saveErr := SaveState(reg.name, existing); saveErr != nil {
					log.Warn().Err(saveErr).Msg("Failed to update runner state with cursor-runner PID")
				}
			}

			climsg.Info("Cursor runner ready (PID %d)", cursorProc.Process.Pid)

			if waitErr := cursorProc.Wait(); waitErr != nil {
				log.Warn().Err(waitErr).Int("pid", cursorProc.Process.Pid).Msg("Cursor runner exited with error")
			} else {
				log.Info().Int("pid", cursorProc.Process.Pid).Msg("Cursor runner exited normally")
			}
		}()
	} else {
		close(cursor.done)
		if !cursorrunner.IsAvailable() {
			log.Debug().Msg("Cursor harness: skipped (cursor-runner source not found)")
		} else if reg.backendInfo.IsLocal {
			log.Debug().Msg("Cursor harness: skipped (CURSOR_API_KEY not set, required for local mode)")
		}
	}

	exitErr := waitForExitOrSignal(proc)

	cursor.shutdown()

	streamCancel()
	streamWg.Wait()

	if err := RemoveState(reg.name); err != nil {
		log.Warn().Err(err).Str("name", reg.name).Msg("Failed to remove runner state")
	}

	return exitErr
}

// startCursorRunnerProcess bootstraps and starts the cursor-runner TypeScript
// process. Returns the process handle, or nil if bootstrap fails (non-fatal).
func startCursorRunnerProcess(ctx context.Context, reg *registeredRunner, dataDir string) *exec.Cmd {
	climsg.Info("Bootstrapping Node.js runtime for Cursor harness ...")

	result, err := BootstrapCursorRunnerRuntime(ctx)
	if err != nil {
		climsg.Warning("Cursor harness bootstrap failed: %v (continuing without Cursor harness)", err)
		return nil
	}

	cursorEnvParams := CursorEnvParams{
		BackendInfo: reg.backendInfo,
		RunnerID:    reg.runnerID,
		TaskQueue:   reg.taskQueue,
		DataDir:     dataDir,
		AppDir:      result.AppDir,
	}
	cursorEnv := BuildCursorRunnerEnv(cursorEnvParams)

	cmd := exec.Command(result.NodeBin, result.EntryArgs...)
	cmd.Dir = result.AppDir
	cmd.Env = cursorEnv

	cursorLogFile, _, logErr := openRunnerLogFile(reg.name + "-cursor")
	if logErr != nil {
		log.Warn().Err(logErr).Msg("Failed to open cursor-runner log file")
	}
	if cursorLogFile != nil {
		capped := &cappedWriter{w: cursorLogFile, limit: maxLogFileBytes}
		cmd.Stdout = io.MultiWriter(os.Stdout, capped)
		cmd.Stderr = io.MultiWriter(os.Stderr, capped)
	} else {
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	}

	if err := cmd.Start(); err != nil {
		climsg.Warning("Failed to start cursor-runner: %v (continuing without Cursor harness)", err)
		return nil
	}

	climsg.Info("Cursor runner started (PID %d)", cmd.Process.Pid)
	return cmd
}

// startDockerRunner starts the agent-runner inside a Docker container and
// blocks until the container exits or a shutdown signal is received.
func startDockerRunner(ctx context.Context, reg *registeredRunner, imageOverride string) error {
	dc := NewDockerClient()

	image := imageOverride
	if image == "" {
		image = DefaultImage(embedded.GetBuildVersion())
	}

	climsg.Info("Starting agent runner in Docker (image: %s) ...", image)

	envMap := buildDockerEnv(reg.backendInfo, reg.runnerID, reg.taskQueue)

	containerID, err := dc.Run(ctx, ContainerRunOpts{
		Name:  reg.name,
		Image: image,
		Env:   envMap,
	})
	if err != nil {
		return errors.Wrap(err, "failed to start Docker container")
	}

	log.Info().
		Str("container_id", containerID[:12]).
		Str("image", image).
		Msg("Docker container started")

	if err := WaitUntilRunning(ctx, dc, containerID, 30*time.Second); err != nil {
		_ = dc.Remove(ctx, containerID)
		return errors.Wrap(err, "container failed to start")
	}

	logFilePath, err := LogFilePath(reg.name)
	if err != nil {
		log.Warn().Err(err).Msg("Failed to resolve runner log path")
		logFilePath = ""
	}

	state := &RunnerState{
		RunnerID:        reg.runnerID,
		Slug:            reg.name,
		Org:             reg.org,
		BackendEndpoint: reg.backendInfo.Endpoint,
		TaskQueue:       reg.taskQueue,
		StartedAt:       time.Now(),
		Runtime:         RuntimeDocker,
		ContainerID:     containerID,
	}
	if logFilePath != "" {
		state.LogFile = logFilePath
	}
	if err := SaveState(reg.name, state); err != nil {
		log.Warn().Err(err).Msg("Failed to save runner state (non-fatal)")
	}

	climsg.Success("Runner %q started (container %s)", reg.name, containerID[:12])

	streamCtx, streamCancel := context.WithCancel(context.Background())
	var streamWg sync.WaitGroup

	rsc := daemon.NewRunnerStreamClient(daemon.RunnerStreamConfig{
		RunnerID: reg.runnerID,
		ConnectFn: func(ctx context.Context) (daemon.CommandStream, error) {
			s, err := reg.client.Runner.Connect(ctx)
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

	exitErr := waitForContainerExitOrSignal(ctx, dc, containerID, reg.name)

	streamCancel()
	streamWg.Wait()

	if err := RemoveState(reg.name); err != nil {
		log.Warn().Err(err).Str("name", reg.name).Msg("Failed to remove runner state")
	}

	return exitErr
}

// waitForContainerExitOrSignal blocks until the Docker container exits or a
// SIGINT/SIGTERM is received. On signal, it stops the container gracefully.
func waitForContainerExitOrSignal(ctx context.Context, dc DockerClient, containerID, name string) error {
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	exitCh := make(chan error, 1)
	go func() {
		code, err := dc.Wait(ctx, containerID)
		if err != nil {
			exitCh <- err
			return
		}
		if code != 0 {
			exitCh <- fmt.Errorf("container exited with code %d", code)
			return
		}
		exitCh <- nil
	}()

	select {
	case err := <-exitCh:
		signal.Stop(sigCh)
		if err != nil {
			climsg.Warning("Agent runner container exited with error: %v", err)
			return errors.Wrap(err, "agent-runner container exited with error")
		}
		climsg.Info("Agent runner container exited normally")
		return nil

	case sig := <-sigCh:
		climsg.Info("Received %s, stopping container %s ...", sig, containerID[:12])
		stopCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		if err := dc.Stop(stopCtx, containerID); err != nil {
			log.Warn().Err(err).Msg("Failed to stop container gracefully")
		}
		if err := dc.Remove(stopCtx, containerID); err != nil {
			log.Warn().Err(err).Msg("Failed to remove container")
		}
		return nil
	}
}

// buildDockerEnv constructs the environment variable map for a Docker
// container. This mirrors the key variables from BuildRunnerEnv but as
// a map suitable for passing as -e flags to docker run.
func buildDockerEnv(info *BackendInfo, runnerID, taskQueue string) map[string]string {
	env := map[string]string{
		"STIGMER_BACKEND_ENDPOINT": info.Endpoint,
		"STIGMER_RUNNER_ID":        runnerID,
		"LOG_LEVEL":                "DEBUG",
	}

	if taskQueue != "" {
		env["STIGMER_TASK_QUEUE"] = taskQueue
	}

	if info.IsLocal {
		env["MODE"] = "local"
		if info.TemporalAddress != "" {
			env["TEMPORAL_SERVICE_ADDRESS"] = info.TemporalAddress
		}
		if info.TemporalNamespace != "" {
			env["TEMPORAL_NAMESPACE"] = info.TemporalNamespace
		}
	} else {
		env["MODE"] = "cloud"
		env["STIGMER_PROXY_ENDPOINT"] = grpcEndpointToHTTPS(info.Endpoint)
		env["TEMPORAL_SERVICE_ADDRESS"] = defaultCloudTemporalAddress
		env["TEMPORAL_NAMESPACE"] = "default"
		env["STIGMER_CHECKPOINTER_TYPE"] = "http"
		env["ARTIFACT_STORAGE_TYPE"] = "proxy"
		env["WORKSPACE_ROOT_DIR"] = "/workspace"
		if info.Token != "" {
			env["STIGMER_TOKEN"] = info.Token
		}
	}

	return env
}

func resolveRuntime(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == RuntimeDocker {
		return RuntimeDocker
	}
	return RuntimeNative
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
	if !isRunnerAlive(state) {
		_ = RemoveState(name)
		return nil
	}

	detail := fmt.Sprintf("PID %d", state.PID)
	if state.IsDocker() {
		detail = fmt.Sprintf("container %s", state.ContainerID[:12])
	}

	return fmt.Errorf(
		"runner %q is already running\n"+
			"  %s\n"+
			"  Backend: %s\n"+
			"  Started: %s\n\n"+
			"To start another runner, provide a different name:\n"+
			"  stigmer up --name <name>\n\n"+
			"To see all active runners:\n"+
			"  stigmer list runners",
		name, detail, state.BackendEndpoint, formatRelativeTime(state.StartedAt),
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

// openRunnerLogFile creates (or truncates) the log file for a runner.
// Returns the file handle, the absolute path, and any error. The caller
// is responsible for closing the file.
func openRunnerLogFile(name string) (*os.File, string, error) {
	logPath, err := LogFilePath(name)
	if err != nil {
		return nil, "", err
	}
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
	if err != nil {
		return nil, "", errors.Wrapf(err, "failed to open log file %s", logPath)
	}
	return f, logPath, nil
}

// cappedWriter wraps an io.Writer and stops writing once limit bytes have
// been written. This prevents unbounded log file growth for long-running
// runners without requiring a full rotation mechanism.
type cappedWriter struct {
	w       io.Writer
	limit   int64
	written int64
}

func (cw *cappedWriter) Write(p []byte) (int, error) {
	if cw.written >= cw.limit {
		return len(p), nil
	}
	remaining := cw.limit - cw.written
	toWrite := p
	if int64(len(p)) > remaining {
		toWrite = p[:remaining]
	}
	n, err := cw.w.Write(toWrite)
	cw.written += int64(n)
	if err != nil {
		return n, err
	}
	return len(p), nil
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

func startPythonProcess(pythonBin, appDir string, env []string, logFile *os.File) (*exec.Cmd, error) {
	mainPy := filepath.Join(appDir, "main.py")
	if _, err := os.Stat(mainPy); err != nil {
		return nil, errors.Wrapf(err, "agent-runner entry point not found at %s", mainPy)
	}

	cmd := exec.Command(pythonBin, mainPy)
	cmd.Dir = appDir
	cmd.Env = env

	if logFile != nil {
		capped := &cappedWriter{w: logFile, limit: maxLogFileBytes}
		cmd.Stdout = io.MultiWriter(os.Stdout, capped)
		cmd.Stderr = io.MultiWriter(os.Stderr, capped)
	} else {
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
	}

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
