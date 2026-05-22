package daemon

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"

	"github.com/stigmer/stigmer/client-apps/cli/embedded/webconsole"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/temporal"
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

	// maxUnhealthyChecks is the number of consecutive health-check failures
	// (process alive but gRPC port not responding) before the daemon kills
	// the component and attempts a restart. At 10s per check this gives the
	// component ~30s to recover on its own.
	maxUnhealthyChecks = 3
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

	// exited is closed when cmd.Wait() returns, confirming the child
	// has truly terminated and been reaped (no zombie).
	exited chan struct{}

	// exitErr stores the result of cmd.Wait().
	exitErr error

	// unhealthyCount tracks consecutive failed gRPC health checks.
	// Reset to 0 on recovery. Used to escalate to kill-and-restart.
	unhealthyCount int
}

// hasExited reports whether the child process has terminated.
// It is safe to call concurrently and never blocks.
func (c *managedComponent) hasExited() bool {
	if c.exited == nil {
		return true
	}
	select {
	case <-c.exited:
		return true
	default:
		return false
	}
}

// waitForExit blocks until the child process terminates, then closes the
// exited channel so that hasExited returns true. Calling cmd.Wait also
// reaps the child, preventing zombie accumulation.
func (c *managedComponent) waitForExit() {
	c.exitErr = c.cmd.Wait()
	close(c.exited)
}

// killAndWait sends SIGTERM and waits for the child to exit. If it does
// not exit within gracefulStopTimeout, SIGKILL is sent as a last resort.
func (c *managedComponent) killAndWait() {
	if c.cmd == nil || c.cmd.Process == nil {
		return
	}
	log.Info().Str("component", c.name).Int("pid", c.cmd.Process.Pid).Msg("Sending SIGTERM for restart")
	_ = c.cmd.Process.Signal(syscall.SIGTERM)
	select {
	case <-c.exited:
		return
	case <-time.After(gracefulStopTimeout):
		log.Warn().Str("component", c.name).Int("pid", c.cmd.Process.Pid).Msg("Graceful stop timed out, sending SIGKILL")
		_ = c.cmd.Process.Kill()
		<-c.exited
	}
}

// restartComponent stops the old instance (if still running), invokes startFn,
// and wires up a new waitForExit goroutine. It returns true on success. On
// failure the component is marked "failed" and the caller should skip it in
// subsequent health checks.
func (c *managedComponent) restartComponent() bool {
	_ = os.Remove(c.pidFile)
	c.state.RestartCount++

	cmd, err := c.startFn()
	if err != nil {
		c.state.State = "failed"
		c.state.LastError = err.Error()
		log.Error().Err(err).Str("component", c.name).Msg("Failed to restart component")
		return false
	}

	c.cmd = cmd
	c.exited = make(chan struct{})
	c.exitErr = nil
	c.unhealthyCount = 0
	go c.waitForExit()

	c.state.PID = cmd.Process.Pid
	c.state.State = "running"
	c.state.StartedAt = time.Now()
	c.state.LastError = ""

	if writeErr := os.WriteFile(c.pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); writeErr != nil {
		log.Warn().Err(writeErr).Str("component", c.name).Msg("Failed to write PID file after restart")
	}

	log.Info().
		Str("component", c.name).
		Int("pid", cmd.Process.Pid).
		Int("restart_count", c.state.RestartCount).
		Msg("Component restarted")
	return true
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

	// Start managed Temporal before any components that depend on it.
	var temporalManager *temporal.Manager
	temporalManaged := os.Getenv("STIGMER_TEMPORAL_MANAGED") == "true"

	if temporalManaged {
		temporalManager = temporal.NewManager(dataDir, "", 0)

		log.Info().Msg("Starting managed Temporal...")
		temporalState := &ComponentState{}
		hs.Components["temporal"] = temporalState

		if err := temporalManager.Start(); err != nil {
			temporalState.State = "failed"
			temporalState.LastError = err.Error()
			log.Error().Err(err).Msg("Failed to start managed Temporal")
			writeHealthState(dataDir, hs)
			return errors.Wrap(err, "failed to start managed Temporal")
		}

		temporalState.PID = temporalManager.GetPID()
		temporalState.State = "running"
		temporalState.StartedAt = time.Now()
		log.Info().
			Int("pid", temporalState.PID).
			Str("address", temporalManager.GetAddress()).
			Msg("Managed Temporal started")

		temporalManager.StartSupervisor()
		writeHealthState(dataDir, hs)
	}

	serverOnly := os.Getenv("STIGMER_SERVER_ONLY") == "true"

	components := buildComponents(cliBin, dataDir, logDir, grpcPort, serverOnly)

	// Start components sequentially. stigmer-server must be first because
	// the runner communicates with it.
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
		c.exited = make(chan struct{})
		go c.waitForExit()

		c.state.PID = cmd.Process.Pid
		c.state.State = "running"
		c.state.StartedAt = time.Now()

		if err := os.WriteFile(c.pidFile, []byte(strconv.Itoa(cmd.Process.Pid)), 0644); err != nil {
			log.Warn().Err(err).Str("component", c.name).Msg("Failed to write PID file")
		}
		log.Info().Str("component", c.name).Int("pid", cmd.Process.Pid).Msg("Component started")

		// After stigmer-server starts, wait for gRPC readiness before
		// starting the runner. Without this gate the runner can start
		// polling Temporal and executing activities against a server
		// that is not yet accepting RPCs.
		if c.name == "stigmer-server" {
			endpoint := fmt.Sprintf("localhost:%d", grpcPort)
			readyCtx, readyCancel := context.WithTimeout(context.Background(), 30*time.Second)
			if readyErr := WaitForReady(readyCtx, endpoint); readyErr != nil {
				readyCancel()
				c.state.State = "failed"
				c.state.LastError = "gRPC not ready: " + readyErr.Error()
				writeHealthState(dataDir, hs)
				return errors.Wrap(readyErr, "stigmer-server gRPC did not become ready")
			}
			readyCancel()
			log.Info().Str("endpoint", endpoint).Msg("stigmer-server gRPC is ready")
		}
	}

	writeHealthState(dataDir, hs)

	// Wait a moment for processes to settle, then verify they're alive
	time.Sleep(2 * time.Second)
	for _, c := range components {
		if c.cmd == nil {
			continue
		}
		if c.hasExited() {
			c.state.State = "failed"
			c.state.LastError = "crashed during startup"
			log.Error().Str("component", c.name).Int("pid", c.state.PID).Msg("Component crashed during startup")
		}
	}

	// Start the embedded web console HTTP server if assets are available
	// and the user has not disabled it with --no-web.
	var webConsoleServer *http.Server
	noWeb := os.Getenv("STIGMER_NO_WEB") == "1"

	if noWeb {
		hs.Components["web-console"] = &ComponentState{State: "stopped"}
		log.Info().Msg("Web console disabled via --no-web")
	} else if webconsole.IsAvailable() {
		addr := fmt.Sprintf("127.0.0.1:%d", WebConsolePort)
		webConsoleServer = &http.Server{
			Addr:    addr,
			Handler: webconsole.NewSPAHandler(),
		}

		go func() {
			log.Info().
				Int("port", WebConsolePort).
				Msg("Starting embedded web console")
			if err := webConsoleServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				log.Error().Err(err).Msg("Web console HTTP server failed")
			}
		}()

		hs.Components["web-console"] = &ComponentState{
			State:     "running",
			StartedAt: time.Now(),
		}
		log.Info().
			Int("port", WebConsolePort).
			Msgf("Web console available at http://localhost:%d", WebConsolePort)
	} else {
		log.Debug().Msg("Web console not embedded in this build, skipping")
	}

	writeHealthState(dataDir, hs)

	// Start health monitoring
	ctx, cancel := context.WithCancel(context.Background())
	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		runHealthMonitor(ctx, dataDir, grpcPort, components, hs, temporalManager)
	}()

	// Wait for shutdown signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	sig := <-sigCh
	log.Info().Str("signal", sig.String()).Msg("Received shutdown signal")

	// Cancel health monitor
	cancel()
	wg.Wait()

	// Stop the web console HTTP server before stopping child processes.
	if webConsoleServer != nil {
		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
		if err := webConsoleServer.Shutdown(shutdownCtx); err != nil {
			log.Warn().Err(err).Msg("Web console HTTP server shutdown error")
		}
		shutdownCancel()
		if cs := hs.Components["web-console"]; cs != nil {
			cs.State = "stopped"
		}
		log.Info().Msg("Web console HTTP server stopped")
	}

	// Graceful shutdown: stop children in reverse order
	for i := len(components) - 1; i >= 0; i-- {
		c := components[i]
		if c.cmd == nil || c.hasExited() {
			continue
		}
		log.Info().Str("component", c.name).Int("pid", c.state.PID).Msg("Stopping component")
		c.killAndWait()
		_ = os.Remove(c.pidFile)
		c.state.State = "stopped"
	}

	// Stop managed Temporal last -- workers need it available while they drain.
	if temporalManager != nil {
		temporalManager.StopSupervisor()
		log.Info().Msg("Stopping managed Temporal...")
		if err := temporalManager.Stop(); err != nil {
			log.Warn().Err(err).Msg("Failed to stop managed Temporal cleanly")
		} else {
			log.Info().Msg("Managed Temporal stopped")
		}
		if ts := hs.Components["temporal"]; ts != nil {
			ts.State = "stopped"
		}
	}

	writeHealthState(dataDir, hs)

	// Cleanup PID files
	_ = os.Remove(filepath.Join(dataDir, PIDFileName))
	_ = os.Remove(filepath.Join(dataDir, healthStateFileName))

	log.Info().Msg("Daemon shutdown complete")
	return nil
}

// findSiblingBinary looks for a binary in the same directory as the CLI executable,
// falling back to PATH lookup. This supports both development (binaries in the
// workspace) and release (binaries shipped alongside the CLI).
func findSiblingBinary(cliBin, name string) (string, error) {
	sibling := filepath.Join(filepath.Dir(cliBin), name)
	if _, err := os.Stat(sibling); err == nil {
		return sibling, nil
	}
	path, err := exec.LookPath(name)
	if err != nil {
		return "", fmt.Errorf("%s not found next to %s or in PATH", name, cliBin)
	}
	return path, nil
}

// buildComponents constructs the list of managed components in startup order.
// When serverOnly is true, only the control plane (stigmer-server) is included;
// the unified runner is omitted.
func buildComponents(cliBin, dataDir, logDir string, grpcPort int, serverOnly bool) []*managedComponent {
	components := []*managedComponent{
		{
			name:    "stigmer-server",
			pidFile: filepath.Join(dataDir, StigmerServerPIDFileName),
			state:   &ComponentState{},
			startFn: func() (*exec.Cmd, error) {
				bin, err := findSiblingBinary(cliBin, "stigmer-server")
				if err != nil {
					return nil, err
				}
				return startChildProcess(bin, nil, logDir, "stigmer-server", os.Environ())
			},
		},
	}

	if serverOnly {
		return components
	}

	// Unified runner: single Node.js process handling all activity types
	// (native, cursor, workflow tasks, MCP).
	runnerNodeBin := os.Getenv("STIGMER_RUNNER_NODE_BIN")
	runnerAppDir := os.Getenv("STIGMER_RUNNER_APP_DIR")
	runnerEntryArgsRaw := os.Getenv("STIGMER_RUNNER_ENTRY_ARGS")

	if runnerNodeBin != "" && runnerAppDir != "" && runnerEntryArgsRaw != "" {
		entryArgs := strings.Split(runnerEntryArgsRaw, ",")

		absoluteEntryArgs := make([]string, len(entryArgs))
		for i, arg := range entryArgs {
			if !filepath.IsAbs(arg) {
				absoluteEntryArgs[i] = filepath.Join(runnerAppDir, arg)
			} else {
				absoluteEntryArgs[i] = arg
			}
		}

		components = append(components, &managedComponent{
			name:    "runner",
			pidFile: filepath.Join(dataDir, RunnerPIDFileName),
			state:   &ComponentState{},
			startFn: func() (*exec.Cmd, error) {
				env := buildUnifiedRunnerEnv(dataDir, grpcPort)
				workspaceDir := filepath.Join(dataDir, "workspace")
				return startChildProcessWithDir(runnerNodeBin, absoluteEntryArgs, workspaceDir, logDir, "runner", env)
			},
		})
		log.Info().Msg("Unified runner registered")
	} else {
		log.Warn().Msg("Runner not registered (STIGMER_RUNNER_NODE_BIN, STIGMER_RUNNER_APP_DIR, or STIGMER_RUNNER_ENTRY_ARGS not set)")
	}

	return components
}

// buildUnifiedRunnerEnv constructs the environment for the unified runner process.
// The unified runner handles all activity types (native, cursor, workflow tasks, MCP)
// in a single Node.js process polling the agent_execution_runner queue.
func buildUnifiedRunnerEnv(dataDir string, grpcPort int) []string {
	workspaceDir := filepath.Join(dataDir, "workspace")
	_ = os.MkdirAll(workspaceDir, 0755)

	env := os.Environ()
	env = append(env,
		"MODE=local",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=http://localhost:%d", grpcPort),
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", os.Getenv("TEMPORAL_SERVICE_ADDRESS")),
		"TEMPORAL_NAMESPACE=default",
		fmt.Sprintf("WORKSPACE_ROOT_DIR=%s", workspaceDir),
		"TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner",
		"LOG_LEVEL=DEBUG",
	)

	if cursorKey := os.Getenv("CURSOR_API_KEY"); cursorKey != "" {
		env = append(env, fmt.Sprintf("CURSOR_API_KEY=%s", cursorKey))
	}

	if routing := os.Getenv("STIGMER_ACTIVITY_ROUTING"); routing != "" {
		env = append(env, fmt.Sprintf("STIGMER_ACTIVITY_ROUTING=%s", routing))
	}

	return env
}

// startChildProcess starts a child process, redirecting its output to log files.
func startChildProcess(bin string, args []string, logDir, name string, env []string) (*exec.Cmd, error) {
	return startChildProcessWithDir(bin, args, "", logDir, name, env)
}

// startChildProcessWithDir starts a child process in the given working directory.
// Each child is placed in its own process group (Setpgid) so that signals
// delivered to the daemon's original group do not inadvertently reach children.
func startChildProcessWithDir(bin string, args []string, dir, logDir, name string, env []string) (*exec.Cmd, error) {
	cmd := exec.Command(bin, args...)
	cmd.Env = env
	setProcGroup(cmd)
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

	return cmd, nil
}

// runHealthMonitor periodically checks component health and restarts crashed ones.
// temporalMgr may be nil when Temporal is external (unmanaged).
func runHealthMonitor(ctx context.Context, dataDir string, grpcPort int, components []*managedComponent, hs *HealthState, temporalMgr *temporal.Manager) {
	ticker := time.NewTicker(healthCheckInterval)
	defer ticker.Stop()

	grpcAddr := fmt.Sprintf("localhost:%d", grpcPort)

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Sync Temporal state from the supervisor (which handles restarts
			// independently via Manager.IsRunning / Manager.Start).
			if temporalMgr != nil {
				if ts := hs.Components["temporal"]; ts != nil {
					if temporalMgr.IsRunning() {
						ts.State = "running"
						ts.PID = temporalMgr.GetPID()
						ts.LastError = ""
					} else {
						ts.State = "unhealthy"
					}
				}
			}

			for _, c := range components {
				if c.cmd == nil || c.state.State == "failed" {
					continue
				}

				if c.hasExited() {
					// Process is confirmed dead and reaped.
					log.Warn().Str("component", c.name).Int("pid", c.state.PID).Msg("Component exited, attempting restart")
					tryRestart(c)
					continue
				}

				// Process is alive. For stigmer-server, probe the gRPC port.
				if c.name == "stigmer-server" {
					conn, dialErr := net.DialTimeout("tcp", grpcAddr, 500*time.Millisecond)
					if dialErr != nil {
						c.unhealthyCount++
						log.Warn().
							Str("component", c.name).
							Str("addr", grpcAddr).
							Int("consecutive_failures", c.unhealthyCount).
							Msg("gRPC port not responding")

						if c.unhealthyCount >= maxUnhealthyChecks {
							log.Error().
								Str("component", c.name).
								Int("consecutive_failures", c.unhealthyCount).
								Msg("Unhealthy threshold exceeded, killing component for restart")
							c.killAndWait()
							tryRestart(c)
						} else {
							c.state.State = "unhealthy"
							c.state.LastError = "gRPC port not responding"
						}
						continue
					}
					conn.Close()
					if c.unhealthyCount > 0 || c.state.State == "unhealthy" {
						c.unhealthyCount = 0
						c.state.State = "running"
						c.state.LastError = ""
						log.Info().Str("component", c.name).Msg("Component recovered — gRPC port responding again")
					}
					continue
				}
			}

			writeHealthState(dataDir, hs)
		}
	}
}

// tryRestart applies restart-eligibility checks (rapid crash, max restarts)
// and calls restartComponent if the component is eligible.
func tryRestart(c *managedComponent) {
	if !c.state.StartedAt.IsZero() && time.Since(c.state.StartedAt) < rapidCrashWindow {
		c.state.State = "failed"
		c.state.LastError = "crashed immediately after start (likely a configuration or dependency error)"
		log.Error().
			Str("component", c.name).
			Dur("uptime", time.Since(c.state.StartedAt)).
			Msg("Component crashed too quickly, marking as failed without retry")
		return
	}

	if c.state.RestartCount >= maxRestarts {
		c.state.State = "failed"
		c.state.LastError = fmt.Sprintf("exceeded max restarts (%d)", maxRestarts)
		log.Error().
			Str("component", c.name).
			Int("restarts", c.state.RestartCount).
			Msg("Component exceeded max restarts, marking as failed")
		return
	}

	c.restartComponent()
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
