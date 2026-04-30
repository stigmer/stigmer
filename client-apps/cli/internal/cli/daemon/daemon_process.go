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
	"sync"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"

	stigmer "github.com/stigmer/stigmer/sdk/go"
	runnerv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/runner/v1"
	apiresource "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	orgv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"

	"github.com/stigmer/stigmer/client-apps/cli/embedded/webconsole"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/nodert"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/seedpackbootstrap"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/temporal"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/protobuf/types/known/emptypb"
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

	// EmbeddedRunnerName is the fixed name for the agent-runner managed by
	// the daemon when running `stigmer up server`. It appears in
	// `stigmer list runners` and is stored as ~/.stigmer/runners/embedded.json.
	EmbeddedRunnerName = "embedded"

	runnersDirName = "runners"
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

// embeddedRunnerIdentity holds the Runner resource identity obtained by
// registerEmbeddedRunner. Passed to the agent-runner process via env vars.
type embeddedRunnerIdentity struct {
	RunnerID  string
	TaskQueue string
	Org       string
}

// registerEmbeddedRunner bootstraps the seedpack (ensuring the org exists),
// discovers the organization slug, and applies a Runner resource for the
// daemon's embedded agent-runner. This must be called after stigmer-server
// is ready and before the agent-runner component is started.
func registerEmbeddedRunner(grpcPort int, dataDir string) (*embeddedRunnerIdentity, error) {
	log.Info().Msg("Registering embedded runner identity")

	_, err := seedpackbootstrap.Apply(seedpackbootstrap.Options{
		MarkerDir: dataDir,
	})
	if err != nil {
		return nil, errors.Wrap(err, "seedpack bootstrap failed")
	}

	endpoint := fmt.Sprintf("localhost:%d", grpcPort)
	conn, err := grpc.NewClient(endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		return nil, errors.Wrap(err, "failed to connect to stigmer-server")
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	orgClient := orgv1.NewOrganizationQueryControllerClient(conn)
	orgResp, err := orgClient.FindMyOrganizations(ctx, &emptypb.Empty{})
	if err != nil {
		return nil, errors.Wrap(err, "failed to query organizations")
	}
	if len(orgResp.GetEntries()) == 0 {
		return nil, errors.New("no organizations found — seedpack may not have applied correctly")
	}

	org := orgResp.GetEntries()[0].GetMetadata().GetSlug()
	log.Info().Str("org", org).Msg("Resolved organization for embedded runner")

	runnerClient := runnerv1.NewRunnerCommandControllerClient(conn)
	applied, err := runnerClient.Apply(ctx, &runnerv1.Runner{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Runner",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: EmbeddedRunnerName,
			Slug: EmbeddedRunnerName,
			Org:  org,
		},
	})
	if err != nil {
		return nil, errors.Wrap(err, "failed to apply embedded runner resource")
	}

	id := applied.GetMetadata().GetId()
	tq := applied.GetStatus().GetTaskQueue()

	log.Info().
		Str("runner_id", id).
		Str("task_queue", tq).
		Str("org", org).
		Msg("Embedded runner registered")

	return &embeddedRunnerIdentity{
		RunnerID:  id,
		TaskQueue: tq,
		Org:       org,
	}, nil
}

// embeddedRunnerState mirrors runner.RunnerState with an additional
// ManagedByDaemon field. Defined here to avoid a circular dependency
// (the runner package imports the daemon package).
type embeddedRunnerState struct {
	RunnerID        string    `json:"runner_id"`
	Slug            string    `json:"slug"`
	Org             string    `json:"org"`
	BackendEndpoint string    `json:"backend_endpoint"`
	PID             int       `json:"pid"`
	TaskQueue       string    `json:"task_queue"`
	StartedAt       time.Time `json:"started_at"`
	ManagedByDaemon bool      `json:"managed_by_daemon,omitempty"`
}

// saveEmbeddedRunnerState writes ~/.stigmer/runners/embedded.json so that
// `stigmer list runners` shows the daemon-managed runner.
func saveEmbeddedRunnerState(identity *embeddedRunnerIdentity, grpcPort, pid int) {
	configDir, err := config.GetConfigDir()
	if err != nil {
		log.Warn().Err(err).Msg("Failed to resolve config dir for embedded runner state")
		return
	}
	dir := filepath.Join(configDir, runnersDirName)
	if err := os.MkdirAll(dir, 0755); err != nil {
		log.Warn().Err(err).Msg("Failed to create runners directory for embedded runner state")
		return
	}

	state := embeddedRunnerState{
		RunnerID:        identity.RunnerID,
		Slug:            EmbeddedRunnerName,
		Org:             identity.Org,
		BackendEndpoint: fmt.Sprintf("localhost:%d", grpcPort),
		PID:             pid,
		TaskQueue:       identity.TaskQueue,
		StartedAt:       time.Now(),
		ManagedByDaemon: true,
	}

	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		log.Warn().Err(err).Msg("Failed to marshal embedded runner state")
		return
	}

	path := filepath.Join(dir, EmbeddedRunnerName+".json")
	if err := os.WriteFile(path, data, 0600); err != nil {
		log.Warn().Err(err).Msg("Failed to write embedded runner state")
		return
	}

	log.Info().Str("path", path).Msg("Saved embedded runner state")
}

// removeEmbeddedRunnerState deletes ~/.stigmer/runners/embedded.json during
// daemon shutdown so the runner no longer appears in `stigmer list runners`.
func removeEmbeddedRunnerState() {
	configDir, err := config.GetConfigDir()
	if err != nil {
		return
	}
	path := filepath.Join(configDir, runnersDirName, EmbeddedRunnerName+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		log.Warn().Err(err).Msg("Failed to remove embedded runner state")
	}
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

	// embeddedIdentity is populated by registerEmbeddedRunner after
	// stigmer-server becomes ready. The agent-runner closure in
	// buildComponents dereferences this pointer at start time to pick
	// up the runner ID and task queue.
	var embeddedIdentity *embeddedRunnerIdentity
	components := buildComponents(cliBin, dataDir, logDir, grpcPort, serverOnly, &embeddedIdentity)

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
		// starting workflow-runner and agent-runner. Without this gate the
		// workers can start polling Temporal and executing activities
		// against a server that is not yet accepting RPCs.
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

			// Register the embedded runner between server readiness and
			// runner start. Seedpack bootstrap runs first (idempotent) to
			// ensure the organization exists, then Runner.Apply creates or
			// reactivates the runner resource.
			if !serverOnly {
				identity, regErr := registerEmbeddedRunner(grpcPort, dataDir)
				if regErr != nil {
					writeHealthState(dataDir, hs)
					return errors.Wrap(regErr, "failed to register embedded runner")
				}
				embeddedIdentity = identity
			}
		}
	}

	// Persist the embedded runner state so `stigmer list runners` includes it.
	if embeddedIdentity != nil {
		agentRunnerPID := 0
		for _, c := range components {
			if c.name == "agent-runner" && c.cmd != nil && c.cmd.Process != nil {
				agentRunnerPID = c.cmd.Process.Pid
				break
			}
		}
		if agentRunnerPID > 0 {
			saveEmbeddedRunnerState(embeddedIdentity, grpcPort, agentRunnerPID)
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

	// Start the runner command stream if the embedded runner is registered.
	// The stream sends heartbeats and handles server-initiated commands
	// (e.g., ListDirectory for workspace browsing).
	var streamClient *stigmer.Client
	var streamCancel context.CancelFunc
	var streamWg sync.WaitGroup

	if embeddedIdentity != nil {
		endpoint := fmt.Sprintf("localhost:%d", grpcPort)
		sdkClient, sdkErr := stigmer.NewClient(
			stigmer.WithBaseURL(endpoint),
			stigmer.WithInsecure(),
			stigmer.WithKeepaliveParams(keepalive.ClientParameters{
				Time:                30 * time.Second,
				Timeout:             10 * time.Second,
				PermitWithoutStream: true,
			}),
		)
		if sdkErr != nil {
			log.Warn().Err(sdkErr).Msg("Failed to create SDK client for runner stream (non-fatal)")
		} else {
			streamClient = sdkClient

			var streamCtx context.Context
			streamCtx, streamCancel = context.WithCancel(context.Background())

			rsc := NewRunnerStreamClient(RunnerStreamConfig{
				RunnerID: embeddedIdentity.RunnerID,
				ConnectFn: func(ctx context.Context) (CommandStream, error) {
					s, err := sdkClient.Runner.Connect(ctx)
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

			log.Info().
				Str("runner_id", embeddedIdentity.RunnerID).
				Msg("Runner command stream started")
		}
	}

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

	// Cancel runner stream first — sends STOPPED heartbeat before children stop.
	if streamCancel != nil {
		streamCancel()
		streamWg.Wait()
		log.Info().Msg("Runner command stream stopped")
	}
	if streamClient != nil {
		streamClient.Close()
	}

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

	// Remove embedded runner state after the agent-runner has been stopped.
	if embeddedIdentity != nil {
		removeEmbeddedRunnerState()
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
// workflow-runner and agent-runner are omitted.
//
// embeddedIdentity is a pointer populated by registerEmbeddedRunner between
// stigmer-server readiness and agent-runner start. The agent-runner closure
// dereferences it at call time (not at buildComponents time).
func buildComponents(cliBin, dataDir, logDir string, grpcPort int, serverOnly bool, embeddedIdentity **embeddedRunnerIdentity) []*managedComponent {
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

	pythonBin := os.Getenv("STIGMER_AGENT_RUNNER_PYTHON_BIN")
	appDir := os.Getenv("STIGMER_AGENT_RUNNER_APP_DIR")

	components = append(components,
		&managedComponent{
			name:    "workflow-runner",
			pidFile: filepath.Join(dataDir, WorkflowRunnerPIDFileName),
			state:   &ComponentState{},
			startFn: func() (*exec.Cmd, error) {
				bin, err := findSiblingBinary(cliBin, "stigmer-workflow-runner")
				if err != nil {
					return nil, err
				}
				env := buildWorkflowRunnerEnv(grpcPort)
				return startChildProcess(bin, nil, logDir, "workflow-runner", env)
			},
		},
		&managedComponent{
			name:    "agent-runner",
			pidFile: filepath.Join(dataDir, RunnerPIDFileName),
			state:   &ComponentState{},
			startFn: func() (*exec.Cmd, error) {
				if pythonBin == "" || appDir == "" {
					return nil, errors.New("STIGMER_AGENT_RUNNER_PYTHON_BIN and STIGMER_AGENT_RUNNER_APP_DIR are required")
				}
				mainPy := filepath.Join(appDir, "main.py")
				if _, err := os.Stat(mainPy); err != nil {
					return nil, errors.Wrapf(err, "agent-runner entry point not found at %s", mainPy)
				}
				var runnerID, taskQueue string
				if embeddedIdentity != nil && *embeddedIdentity != nil {
					runnerID = (*embeddedIdentity).RunnerID
					taskQueue = (*embeddedIdentity).TaskQueue
				}
				env := buildRunnerEnv(dataDir, grpcPort, runnerID, taskQueue, appDir)
				return startChildProcessWithDir(pythonBin, []string{mainPy}, appDir, logDir, "agent-runner", env)
			},
		},
	)

	// cursor-runner is optional. It starts only when the daemon receives
	// STIGMER_CURSOR_RUNNER_NODE_BIN and STIGMER_CURSOR_RUNNER_APP_DIR
	// (set by StartWithOptions when CURSOR_API_KEY is available and
	// Node.js bootstrap succeeds).
	cursorNodeBin := os.Getenv("STIGMER_CURSOR_RUNNER_NODE_BIN")
	cursorAppDir := os.Getenv("STIGMER_CURSOR_RUNNER_APP_DIR")

	if cursorNodeBin != "" && cursorAppDir != "" {
		components = append(components, &managedComponent{
			name:    "cursor-runner",
			pidFile: filepath.Join(dataDir, CursorRunnerPIDFileName),
			state:   &ComponentState{},
			startFn: func() (*exec.Cmd, error) {
				tsxArgs, err := nodert.TsxArgs(cursorAppDir, filepath.Join("src", "main.ts"))
				if err != nil {
					return nil, err
				}

				var runnerID, taskQueue string
				if embeddedIdentity != nil && *embeddedIdentity != nil {
					runnerID = (*embeddedIdentity).RunnerID
					taskQueue = (*embeddedIdentity).TaskQueue
				}
				env := buildCursorRunnerEnv(dataDir, grpcPort, runnerID, taskQueue)
				return startChildProcessWithDir(cursorNodeBin, tsxArgs, cursorAppDir, logDir, "cursor-runner", env)
			},
		})
		log.Info().Msg("Cursor harness: enabled (cursor-runner component registered)")
	} else {
		log.Debug().Msg("Cursor harness: not registered (env vars not set)")
	}

	return components
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

// buildRunnerEnv constructs the environment for the native runner process.
// Values are inherited from the daemon's own environment (set by StartWithOptions).
//
// When runnerID is non-empty, STIGMER_RUNNER_ID is set (enabling heartbeats).
// When taskQueue is non-empty, STIGMER_TASK_QUEUE is set (per-runner queue);
// otherwise the legacy TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE is used.
func buildRunnerEnv(dataDir string, grpcPort int, runnerID, taskQueue, appDir string) []string {
	workspaceDir := filepath.Join(dataDir, "workspace")
	artifactsDir := filepath.Join(dataDir, "artifacts")

	_ = os.MkdirAll(workspaceDir, 0755)
	_ = os.MkdirAll(artifactsDir, 0755)

	env := os.Environ()

	if appDir != "" {
		env = append(env, fmt.Sprintf("PYTHONPATH=%s", filepath.Join(appDir, "src")))
	}

	env = append(env,
		"MODE=local",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", grpcPort),
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", os.Getenv("TEMPORAL_SERVICE_ADDRESS")),
		"TEMPORAL_NAMESPACE=default",
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
		"LANGGRAPH_DEFAULT_RECURSION_LIMIT=10000000",
	)

	if runnerID != "" {
		env = append(env, fmt.Sprintf("STIGMER_RUNNER_ID=%s", runnerID))
	}

	if taskQueue != "" {
		env = append(env, fmt.Sprintf("STIGMER_TASK_QUEUE=%s", taskQueue))
	} else {
		env = append(env, "TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner")
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
