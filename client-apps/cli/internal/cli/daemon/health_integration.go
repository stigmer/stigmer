package daemon

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/health"
)

// Type aliases for health types (exported for status command)
type (
	ComponentHealth = health.ComponentHealth
	ComponentState  = health.ComponentState
)

var (
	// Global health monitor instance
	healthMonitor *health.Monitor
)

// startHealthMonitoring initializes and starts health monitoring for all daemon components
func startHealthMonitoring(dataDir string) error {
	log.Info().Msg("Initializing health monitoring")

	// Create new health monitor
	healthMonitor = health.NewMonitor()

	// Register stigmer-server for monitoring
	if component, err := createStigmerServerComponent(dataDir); err == nil {
		healthMonitor.RegisterComponent(component)
		component.Start()
	} else {
		log.Warn().Err(err).Msg("Failed to create stigmer-server health component")
	}

	// Register workflow-runner for monitoring
	if component, err := createWorkflowRunnerComponent(dataDir); err == nil {
		healthMonitor.RegisterComponent(component)
		component.Start()
	} else {
		log.Warn().Err(err).Msg("Failed to create workflow-runner health component")
	}

	// Register agent-runner for monitoring
	if component, err := createAgentRunnerComponent(dataDir); err == nil {
		healthMonitor.RegisterComponent(component)
		component.Start()
	} else {
		log.Warn().Err(err).Msg("Failed to create agent-runner health component")
	}

	// Start health monitoring
	ctx := context.Background()
	healthMonitor.Start(ctx)

	log.Info().Msg("Health monitoring started successfully")

	return nil
}

// stopHealthMonitoring stops health monitoring
func stopHealthMonitoring() {
	if healthMonitor != nil {
		log.Info().Msg("Stopping health monitoring")
		healthMonitor.Stop()
		healthMonitor = nil
	}
}

// getHealthMonitor returns the active health monitor (or nil if not running)
func getHealthMonitor() *health.Monitor {
	return healthMonitor
}

// createStigmerServerComponent creates health component for stigmer-server
func createStigmerServerComponent(dataDir string) (*health.Component, error) {
	// Read PID file
	pid, err := getPID(dataDir)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read stigmer-server PID")
	}

	// Create component
	component := health.NewComponent("stigmer-server", health.ComponentTypeStigmerServer)

	// Configure startup probe
	component.StartupProbe = &health.HealthProbe{
		Type:             health.ProbeTypeStartup,
		Check:            health.StigmerServerHealthCheck(pid, fmt.Sprintf("localhost:%d", DaemonPort)),
		Interval:         1 * time.Second,
		Timeout:          5 * time.Second,
		FailureThreshold: 30, // Allow 30 seconds for startup
		SuccessThreshold: 1,
	}

	// Configure liveness probe
	component.LivenessProbe = &health.HealthProbe{
		Type:             health.ProbeTypeLiveness,
		Check:            health.StigmerServerHealthCheck(pid, fmt.Sprintf("localhost:%d", DaemonPort)),
		Interval:         10 * time.Second,
		Timeout:          3 * time.Second,
		FailureThreshold: 3, // Restart after 3 consecutive failures
		SuccessThreshold: 1,
	}

	// Configure restart function
	component.RestartFunc = func(ctx context.Context) error {
		log.Info().Msg("Restarting stigmer-server")

		// Stop existing process
		if err := stopStigmerServer(dataDir); err != nil {
			log.Warn().Err(err).Msg("Failed to stop existing stigmer-server")
		}

		// Brief pause to let process terminate
		time.Sleep(1 * time.Second)

		// Restart stigmer-server
		return restartStigmerServer(dataDir)
	}

	// Configure stop function
	component.StopFunc = func(ctx context.Context) error {
		return stopStigmerServer(dataDir)
	}

	return component, nil
}

// createWorkflowRunnerComponent creates health component for workflow-runner
func createWorkflowRunnerComponent(dataDir string) (*health.Component, error) {
	// Read PID file
	pidFile := filepath.Join(dataDir, WorkflowRunnerPIDFileName)
	pidBytes, err := os.ReadFile(pidFile)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read workflow-runner PID")
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes)))
	if err != nil {
		return nil, errors.Wrap(err, "failed to parse workflow-runner PID")
	}

	// Create component
	component := health.NewComponent("workflow-runner", health.ComponentTypeWorkflowRunner)

	startTime := time.Now() // Track start time for uptime checks

	// Configure startup probe
	component.StartupProbe = &health.HealthProbe{
		Type:             health.ProbeTypeStartup,
		Check:            health.WorkflowRunnerHealthCheck(pid, startTime, 2*time.Second),
		Interval:         1 * time.Second,
		Timeout:          5 * time.Second,
		FailureThreshold: 30,
		SuccessThreshold: 1,
	}

	// Configure liveness probe
	component.LivenessProbe = &health.HealthProbe{
		Type:             health.ProbeTypeLiveness,
		Check:            health.WorkflowRunnerHealthCheck(pid, startTime, 10*time.Second),
		Interval:         10 * time.Second,
		Timeout:          3 * time.Second,
		FailureThreshold: 3,
		SuccessThreshold: 1,
	}

	// Configure restart function
	component.RestartFunc = func(ctx context.Context) error {
		log.Info().Msg("Restarting workflow-runner")

		// Stop existing process
		stopWorkflowRunner(dataDir)

		// Brief pause
		time.Sleep(1 * time.Second)

		// Restart workflow-runner
		return restartWorkflowRunner(dataDir)
	}

	// Configure stop function
	component.StopFunc = func(ctx context.Context) error {
		stopWorkflowRunner(dataDir)
		return nil
	}

	return component, nil
}

// createAgentRunnerComponent creates health component for agent-runner
func createAgentRunnerComponent(dataDir string) (*health.Component, error) {
	// Check if agent-runner is using Docker mode (most common)
	containerIDFile := filepath.Join(dataDir, AgentRunnerContainerIDFileName)
	if _, err := os.Stat(containerIDFile); err == nil {
		return createAgentRunnerDockerComponent(dataDir)
	}

	// Fallback to binary mode (if PID file exists)
	pidFile := filepath.Join(dataDir, AgentRunnerPIDFileName)
	if _, err := os.Stat(pidFile); err == nil {
		return createAgentRunnerBinaryComponent(dataDir)
	}

	return nil, errors.New("agent-runner not found (neither Docker nor binary mode)")
}

// createAgentRunnerDockerComponent creates health component for Docker-based agent-runner
func createAgentRunnerDockerComponent(dataDir string) (*health.Component, error) {
	// Create component
	component := health.NewComponent("agent-runner", health.ComponentTypeAgentRunner)

	// Configure startup probe
	component.StartupProbe = &health.HealthProbe{
		Type:             health.ProbeTypeStartup,
		Check:            health.AgentRunnerHealthCheck(AgentRunnerContainerName),
		Interval:         1 * time.Second,
		Timeout:          5 * time.Second,
		FailureThreshold: 30,
		SuccessThreshold: 1,
	}

	// Configure liveness probe
	component.LivenessProbe = &health.HealthProbe{
		Type:             health.ProbeTypeLiveness,
		Check:            health.AgentRunnerHealthCheck(AgentRunnerContainerName),
		Interval:         10 * time.Second,
		Timeout:          3 * time.Second,
		FailureThreshold: 3,
		SuccessThreshold: 1,
	}

	// Configure restart function
	component.RestartFunc = func(ctx context.Context) error {
		log.Info().Msg("Restarting agent-runner (Docker)")

		// Stop existing container
		stopAgentRunner(dataDir)

		// Brief pause
		time.Sleep(2 * time.Second)

		// Restart agent-runner
		return restartAgentRunner(dataDir)
	}

	// Configure stop function
	component.StopFunc = func(ctx context.Context) error {
		stopAgentRunner(dataDir)
		return nil
	}

	return component, nil
}

// createAgentRunnerBinaryComponent creates health component for binary-based agent-runner
func createAgentRunnerBinaryComponent(dataDir string) (*health.Component, error) {
	// Read PID file
	pidFile := filepath.Join(dataDir, AgentRunnerPIDFileName)
	pidBytes, err := os.ReadFile(pidFile)
	if err != nil {
		return nil, errors.Wrap(err, "failed to read agent-runner PID")
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(pidBytes)))
	if err != nil {
		return nil, errors.Wrap(err, "failed to parse agent-runner PID")
	}

	// Create component
	component := health.NewComponent("agent-runner", health.ComponentTypeAgentRunner)

	startTime := time.Now()

	// Configure startup probe
	component.StartupProbe = &health.HealthProbe{
		Type:             health.ProbeTypeStartup,
		Check:            health.ProcessHealthCheck(pid),
		Interval:         1 * time.Second,
		Timeout:          5 * time.Second,
		FailureThreshold: 30,
		SuccessThreshold: 1,
	}

	// Configure liveness probe
	component.LivenessProbe = &health.HealthProbe{
		Type:             health.ProbeTypeLiveness,
		Check:            health.WorkflowRunnerHealthCheck(pid, startTime, 10*time.Second),
		Interval:         10 * time.Second,
		Timeout:          3 * time.Second,
		FailureThreshold: 3,
		SuccessThreshold: 1,
	}

	// Configure restart function
	component.RestartFunc = func(ctx context.Context) error {
		log.Info().Msg("Restarting agent-runner (binary)")

		// Stop existing process
		stopAgentRunner(dataDir)

		// Brief pause
		time.Sleep(1 * time.Second)

		// Restart agent-runner
		return restartAgentRunner(dataDir)
	}

	// Configure stop function
	component.StopFunc = func(ctx context.Context) error {
		stopAgentRunner(dataDir)
		return nil
	}

	return component, nil
}

// stopStigmerServer stops the stigmer-server process
func stopStigmerServer(dataDir string) error {
	pid, err := getPID(dataDir)
	if err != nil {
		return errors.Wrap(err, "failed to read PID")
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return errors.Wrap(err, "failed to find process")
	}

	// Try graceful shutdown first (SIGTERM)
	if err := process.Signal(os.Interrupt); err != nil {
		return errors.Wrap(err, "failed to send SIGTERM")
	}

	// Wait up to 10 seconds for graceful shutdown
	for i := 0; i < 10; i++ {
		time.Sleep(1 * time.Second)
		if err := process.Signal(os.Signal(nil)); err != nil {
			// Process has exited
			return nil
		}
	}

	// Force kill if still running
	return process.Kill()
}

// restartStigmerServer restarts the stigmer-server process
func restartStigmerServer(dataDir string) error {
	// Load startup configuration
	config, err := loadStartupConfig(dataDir)
	if err != nil {
		return errors.Wrap(err, "failed to load startup configuration")
	}

	// Find CLI binary
	cliBin, err := os.Executable()
	if err != nil {
		return errors.Wrap(err, "failed to get CLI executable path")
	}

	log.Debug().Str("binary", cliBin).Msg("Restarting stigmer-server via CLI")

	// Start stigmer-server process with saved configuration
	cmd := exec.Command(cliBin, "internal-server")
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("STIGMER_DATA_DIR=%s", config.DataDir),
		fmt.Sprintf("GRPC_PORT=%d", DaemonPort),
	)

	// Redirect output to log file
	// Consolidate stdout and stderr to single .log file for clarity
	logFile := filepath.Join(config.LogDir, "stigmer-server.log")

	logOutput, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create log file")
	}
	defer logOutput.Close()

	// Redirect both stdout and stderr to the same log file
	cmd.Stdout = logOutput
	cmd.Stderr = logOutput

	// Start process
	if err := cmd.Start(); err != nil {
		return errors.Wrap(err, "failed to start stigmer-server process")
	}

	// Write PID file
	pidFile := filepath.Join(dataDir, PIDFileName)
	pidContent := fmt.Sprintf("%d", cmd.Process.Pid)
	if err := os.WriteFile(pidFile, []byte(pidContent), 0644); err != nil {
		// Kill the process if we can't write PID file
		_ = cmd.Process.Kill()
		return errors.Wrap(err, "failed to write PID file")
	}

	// Update startup config with new PID
	config.StigmerServerPID = cmd.Process.Pid
	if err := saveStartupConfig(config); err != nil {
		log.Warn().Err(err).Msg("Failed to update startup config with new PID")
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Msg("Stigmer-server restarted successfully")

	return nil
}

// restartWorkflowRunner restarts the workflow-runner process
func restartWorkflowRunner(dataDir string) error {
	// Load startup configuration
	config, err := loadStartupConfig(dataDir)
	if err != nil {
		return errors.Wrap(err, "failed to load startup configuration")
	}

	// Call existing startWorkflowRunner function
	if err := startWorkflowRunner(config.DataDir, config.LogDir, config.TemporalAddr); err != nil {
		return errors.Wrap(err, "failed to restart workflow-runner")
	}

	log.Info().Msg("Workflow-runner restarted successfully")

	return nil
}

// restartAgentRunner restarts the agent-runner
func restartAgentRunner(dataDir string) error {
	// Load startup configuration
	config, err := loadStartupConfig(dataDir)
	if err != nil {
		return errors.Wrap(err, "failed to load startup configuration")
	}

	// Gather required secrets (needed for agent-runner)
	secrets, err := GatherRequiredSecrets(config.LLMProvider)
	if err != nil {
		return errors.Wrap(err, "failed to gather required secrets")
	}

	// Call existing startAgentRunner function
	if err := startAgentRunner(
		config.DataDir,
		config.LogDir,
		config.LLMProvider,
		config.LLMModel,
		config.LLMBaseURL,
		config.TemporalAddr,
		secrets,
		config.ExecutionMode,
		config.SandboxImage,
		config.SandboxAutoPull,
		config.SandboxCleanup,
		config.SandboxTTL,
	); err != nil {
		return errors.Wrap(err, "failed to restart agent-runner")
	}

	log.Info().Msg("Agent-runner restarted successfully")

	return nil
}

// GetHealthSummary returns health status for all components (exported for status command)
func GetHealthSummary() map[string]health.ComponentHealth {
	if healthMonitor == nil {
		return make(map[string]health.ComponentHealth)
	}
	return healthMonitor.GetHealthSummary()
}
