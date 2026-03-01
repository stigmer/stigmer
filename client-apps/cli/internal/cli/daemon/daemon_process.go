package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

const (
	StigmerServerPIDFileName = "stigmer-server.pid"
	healthStateFileName      = "health-state.json"
	healthCheckInterval      = 10 * time.Second
	maxRestarts              = 5
	gracefulStopTimeout      = 5 * time.Second

	// rapidCrashWindow is the minimum uptime before a crash is considered
	// transient. A component that crashes within this window of its last
	// start is treated as a structural failure (e.g. missing dependency,
	// bad config) and is not retried.
	rapidCrashWindow = 5 * time.Second
)

// HealthState is written atomically by the daemon process and read by the
// status command. It provides a consistent snapshot of all managed components.
type HealthState struct {
	DaemonPID  int                        `json:"daemon_pid"`
	StartedAt  time.Time                  `json:"started_at"`
	Components map[string]*ComponentState `json:"components"`
}

// ComponentState tracks a single managed component's runtime state.
type ComponentState struct {
	PID          int       `json:"pid"`
	State        string    `json:"state"` // "running", "stopped", "failed"
	StartedAt    time.Time `json:"started_at"`
	RestartCount int       `json:"restart_count"`
	LastError    string    `json:"last_error,omitempty"`
}

// managedComponent is the internal representation of a child process the
// daemon is responsible for.
type managedComponent struct {
	name    string
	cmd     *exec.Cmd
	pidFile string
	state   *ComponentState

	// startFn creates and starts a new instance of this component.
	// It returns the exec.Cmd so the daemon can track the PID.
	startFn func() (*exec.Cmd, error)
}

// RunDaemonProcess is the entry point for `stigmer internal-daemon`.
// It reads resolved config from env vars, starts all child components,
// monitors their health, and handles graceful shutdown.
func RunDaemonProcess() error {
	dataDir := os.Getenv("STIGMER_DATA_DIR")
	if dataDir == "" {
		return errors.New("STIGMER_DATA_DIR is required")
	}
	logDir := os.Getenv("STIGMER_LOG_DIR")
	if logDir == "" {
		logDir = filepath.Join(dataDir, "logs")
	}
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create log directory")
	}

	grpcPort, _ := strconv.Atoi(os.Getenv("GRPC_PORT"))
	if grpcPort == 0 {
		grpcPort = DaemonPort
	}

	cliBin, err := os.Executable()
	if err != nil {
		return errors.Wrap(err, "failed to get CLI executable path")
	}

	// Write own PID
	if err := os.WriteFile(filepath.Join(dataDir, PIDFileName), []byte(strconv.Itoa(os.Getpid())), 0644); err != nil {
		return errors.Wrap(err, "failed to write daemon PID file")
	}

	startedAt := time.Now()
	hs := &HealthState{
		DaemonPID:  os.Getpid(),
		StartedAt:  startedAt,
		Components: make(map[string]*ComponentState),
	}

	components := buildComponents(cliBin, dataDir, logDir, grpcPort)

	// Start components sequentially. stigmer-server must be first because
	// workflow-runner and agent-runner communicate with it.
	for _, c := range components {
		hs.Components[c.name] = c.state
		log.Info().Str("component", c.name).Msg("Starting component")

		cmd, startErr := c.startFn()
		if startErr != nil {
			c.state.State = "failed"
			c.state.LastError = startErr.Error()
			log.Error().Err(startErr).Str("component", c.name).Msg("Failed to start component")

			// stigmer-server is critical — abort if it fails
			if c.name == "stigmer-server" {
				writeHealthState(dataDir, hs)
				return errors.Wrapf(startErr, "critical component %s failed to start", c.name)
			}
			continue
		}

		c.cmd = cmd
		c.state.PID = cmd.Process.Pid
		c.state.State = "running"
		c.state.StartedAt = time.Now()

		if err := os.WriteFile(c.pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
			log.Warn().Err(err).Str("component", c.name).Msg("Failed to write PID file")
		}
		log.Info().Str("component", c.name).Int("pid", cmd.Process.Pid).Msg("Component started")
	}

	writeHealthState(dataDir, hs)

	// Wait a moment for processes to settle, then verify they're alive
	time.Sleep(2 * time.Second)
	for _, c := range components {
		if c.cmd == nil {
			continue
		}
		if !isProcessAlive(c.cmd.Process.Pid) {
			c.state.State = "failed"
			c.state.LastError = "crashed during startup"
			log.Error().Str("component", c.name).Int("pid", c.cmd.Process.Pid).Msg("Component crashed during startup")
		}
	}
	writeHealthState(dataDir, hs)

	// Start health monitoring
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		runHealthMonitor(ctx, dataDir, components, hs)
	}()

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	sig := <-sigCh
	log.Info().Str("signal", sig.String()).Msg("Received shutdown signal")

	cancel()
	wg.Wait()

	// Graceful shutdown: stop children in reverse order
	for i := len(components) - 1; i >= 0; i-- {
		c := components[i]
		if c.cmd == nil || !isProcessAlive(c.cmd.Process.Pid) {
			continue
		}
		stopProcess(c.name, c.cmd.Process.Pid)
		_ = os.Remove(c.pidFile)
		c.state.State = "stopped"
	}

	writeHealthState(dataDir, hs)

	// Cleanup PID files
	_ = os.Remove(filepath.Join(dataDir, PIDFileName))
	_ = os.Remove(filepath.Join(dataDir, healthStateFileName))

	log.Info().Msg("Daemon shutdown complete")
	return nil
}

// buildComponents constructs the list of managed components in startup order.
func buildComponents(cliBin, dataDir, logDir string, grpcPort int) []*managedComponent {
	pythonBin := os.Getenv("STIGMER_AGENT_RUNNER_PYTHON_BIN")
	appDir := os.Getenv("STIGMER_AGENT_RUNNER_APP_DIR")

	return []*managedComponent{
		{
			name:    "stigmer-server",
			pidFile: filepath.Join(dataDir, StigmerServerPIDFileName),
			state:   &ComponentState{},
			startFn: func() (*exec.Cmd, error) {
				return startChildProcess(cliBin, []string{"internal-server"}, logDir, "stigmer-server", os.Environ())
			},
		},
		{
			name:    "workflow-runner",
			pidFile: filepath.Join(dataDir, WorkflowRunnerPIDFileName),
			state:   &ComponentState{},
			startFn: func() (*exec.Cmd, error) {
				env := buildWorkflowRunnerEnv(grpcPort)
				return startChildProcess(cliBin, []string{"internal-workflow-runner"}, logDir, "workflow-runner", env)
			},
		},
		{
			name:    "agent-runner",
			pidFile: filepath.Join(dataDir, AgentRunnerPIDFileName),
			state:   &ComponentState{},
			startFn: func() (*exec.Cmd, error) {
				if pythonBin == "" || appDir == "" {
					return nil, errors.New("STIGMER_AGENT_RUNNER_PYTHON_BIN and STIGMER_AGENT_RUNNER_APP_DIR are required")
				}
				mainPy := filepath.Join(appDir, "main.py")
				if _, err := os.Stat(mainPy); err != nil {
					return nil, errors.Wrapf(err, "agent-runner entry point not found at %s", mainPy)
				}
				env := buildAgentRunnerEnv(dataDir, grpcPort)
				return startChildProcessWithDir(pythonBin, []string{mainPy}, appDir, logDir, "agent-runner", env)
			},
		},
	}
}

// buildWorkflowRunnerEnv constructs the environment for workflow-runner.
// The values are inherited from the daemon's own environment (set by StartWithOptions).
func buildWorkflowRunnerEnv(grpcPort int) []string {
	env := os.Environ()
	env = append(env,
		"EXECUTION_MODE=temporal",
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", os.Getenv("TEMPORAL_SERVICE_ADDRESS")),
		"TEMPORAL_NAMESPACE=default",
		"TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner",
		"TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE=zigflow_execution",
		"TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", grpcPort),
		"STIGMER_API_KEY=dummy-local-key",
		"STIGMER_SERVICE_USE_TLS=false",
		"LOG_LEVEL=DEBUG",
		"ENV=local",
	)
	return env
}

// buildAgentRunnerEnv constructs the environment for native agent-runner.
// Values are inherited from the daemon's own environment (set by StartWithOptions).
func buildAgentRunnerEnv(dataDir string, grpcPort int) []string {
	workspaceDir := filepath.Join(dataDir, "workspace")
	artifactsDir := filepath.Join(dataDir, "artifacts")

	_ = os.MkdirAll(workspaceDir, 0755)
	_ = os.MkdirAll(artifactsDir, 0755)

	env := os.Environ()
	env = append(env,
		"MODE=local",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", grpcPort),
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", os.Getenv("TEMPORAL_SERVICE_ADDRESS")),
		"TEMPORAL_NAMESPACE=default",
		"TASK_QUEUE=agent_execution_runner",
		"SANDBOX_TYPE=filesystem",
		fmt.Sprintf("SANDBOX_ROOT_DIR=%s", workspaceDir),
		"LOG_LEVEL=DEBUG",
		fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", os.Getenv("STIGMER_LLM_PROVIDER")),
		fmt.Sprintf("STIGMER_LLM_MODEL=%s", os.Getenv("STIGMER_LLM_MODEL")),
		fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", os.Getenv("STIGMER_LLM_BASE_URL")),
		fmt.Sprintf("OLLAMA_BASE_URL=%s", os.Getenv("STIGMER_LLM_BASE_URL")),
		fmt.Sprintf("STIGMER_EXECUTION_MODE=%s", os.Getenv("STIGMER_EXECUTION_MODE")),
		fmt.Sprintf("STIGMER_SANDBOX_IMAGE=%s", os.Getenv("STIGMER_SANDBOX_IMAGE")),
		fmt.Sprintf("STIGMER_SANDBOX_AUTO_PULL=%s", os.Getenv("STIGMER_SANDBOX_AUTO_PULL")),
		fmt.Sprintf("STIGMER_SANDBOX_CLEANUP=%s", os.Getenv("STIGMER_SANDBOX_CLEANUP")),
		fmt.Sprintf("STIGMER_SANDBOX_TTL=%s", os.Getenv("STIGMER_SANDBOX_TTL")),
		fmt.Sprintf("LOCAL_ARTIFACT_PATH=%s", artifactsDir),
		fmt.Sprintf("LOCAL_ARTIFACT_SERVE_URL=http://localhost:%d", grpcPort+1),
	)
	return env
}

// startChildProcess starts a child process, redirecting its output to log files.
func startChildProcess(bin string, args []string, logDir, name string, env []string) (*exec.Cmd, error) {
	return startChildProcessWithDir(bin, args, "", logDir, name, env)
}

// startChildProcessWithDir starts a child process in the given working directory.
func startChildProcessWithDir(bin string, args []string, dir, logDir, name string, env []string) (*exec.Cmd, error) {
	cmd := exec.Command(bin, args...)
	cmd.Env = env
	if dir != "" {
		cmd.Dir = dir
	}

	logFile := filepath.Join(logDir, name+".log")
	out, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to open log file for %s", name)
	}

	cmd.Stdout = out
	cmd.Stderr = out

	if err := cmd.Start(); err != nil {
		out.Close()
		return nil, errors.Wrapf(err, "failed to start %s", name)
	}

	// Let the file stay open — the child process writes to it.
	// The OS will close it when the process exits.

	return cmd, nil
}

// runHealthMonitor periodically checks component health and restarts crashed ones.
func runHealthMonitor(ctx context.Context, dataDir string, components []*managedComponent, hs *HealthState) {
	ticker := time.NewTicker(healthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			for _, c := range components {
				if c.cmd == nil || c.state.State == "failed" {
					continue
				}

				if isProcessAlive(c.cmd.Process.Pid) {
					continue
				}

				log.Warn().Str("component", c.name).Int("pid", c.cmd.Process.Pid).Msg("Component is not alive, attempting restart")

				// If the component crashed almost immediately after starting,
				// it's likely a structural problem that restarts won't fix.
				if !c.state.StartedAt.IsZero() && time.Since(c.state.StartedAt) < rapidCrashWindow {
					c.state.State = "failed"
					c.state.LastError = "crashed immediately after start (likely a configuration or dependency error)"
					log.Error().
						Str("component", c.name).
						Dur("uptime", time.Since(c.state.StartedAt)).
						Msg("Component crashed too quickly, marking as failed without retry")
					continue
				}

				if c.state.RestartCount >= maxRestarts {
					c.state.State = "failed"
					c.state.LastError = fmt.Sprintf("exceeded max restarts (%d)", maxRestarts)
					log.Error().Str("component", c.name).Int("restarts", c.state.RestartCount).Msg("Component exceeded max restarts, marking as failed")
					continue
				}

				_ = os.Remove(c.pidFile)
				c.state.RestartCount++

				cmd, startErr := c.startFn()
				if startErr != nil {
					c.state.State = "failed"
					c.state.LastError = startErr.Error()
					log.Error().Err(startErr).Str("component", c.name).Msg("Failed to restart component")
					continue
				}

				c.cmd = cmd
				c.state.PID = cmd.Process.Pid
				c.state.State = "running"
				c.state.StartedAt = time.Now()

				if err := os.WriteFile(c.pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
					log.Warn().Err(err).Str("component", c.name).Msg("Failed to write PID file after restart")
				}

				log.Info().Str("component", c.name).Int("pid", cmd.Process.Pid).Int("restart_count", c.state.RestartCount).Msg("Component restarted")
			}

			writeHealthState(dataDir, hs)
		}
	}
}

// stopProcess sends SIGTERM to a process and waits for it to exit.
// Falls back to SIGKILL after the graceful timeout.
func stopProcess(name string, pid int) {
	process, err := os.FindProcess(pid)
	if err != nil {
		return
	}

	log.Info().Str("component", name).Int("pid", pid).Msg("Sending SIGTERM")
	_ = process.Signal(syscall.SIGTERM)

	deadline := time.After(gracefulStopTimeout)
	tick := time.NewTicker(200 * time.Millisecond)
	defer tick.Stop()

	for {
		select {
		case <-deadline:
			log.Warn().Str("component", name).Int("pid", pid).Msg("Graceful stop timed out, sending SIGKILL")
			_ = process.Kill()
			return
		case <-tick.C:
			if !isProcessAlive(pid) {
				log.Info().Str("component", name).Int("pid", pid).Msg("Component stopped")
				return
			}
		}
	}
}

// writeHealthState atomically writes the health state file.
func writeHealthState(dataDir string, hs *HealthState) {
	data, err := json.MarshalIndent(hs, "", "  ")
	if err != nil {
		log.Warn().Err(err).Msg("Failed to marshal health state")
		return
	}

	tmpFile := filepath.Join(dataDir, healthStateFileName+".tmp")
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		log.Warn().Err(err).Msg("Failed to write health state temp file")
		return
	}

	if err := os.Rename(tmpFile, filepath.Join(dataDir, healthStateFileName)); err != nil {
		log.Warn().Err(err).Msg("Failed to rename health state file")
		_ = os.Remove(tmpFile)
	}
}

// LoadHealthState reads the daemon's health state file.
// Returns nil if the file doesn't exist or can't be read.
func LoadHealthState(dataDir string) *HealthState {
	data, err := os.ReadFile(filepath.Join(dataDir, healthStateFileName))
	if err != nil {
		return nil
	}
	var hs HealthState
	if err := json.Unmarshal(data, &hs); err != nil {
		return nil
	}
	return &hs
}
