package supervisor

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

// ComponentType identifies the type of component being supervised
type ComponentType string

const (
	ComponentTypeWorkflowRunner ComponentType = "workflow-runner"
	ComponentTypeAgentRunner    ComponentType = "agent-runner"
)

// ComponentState represents the current state of a component
type ComponentState string

const (
	StateStarting   ComponentState = "starting"
	StateRunning    ComponentState = "running"
	StateUnhealthy  ComponentState = "unhealthy"
	StateRestarting ComponentState = "restarting"
	StateFailed     ComponentState = "failed"
)

// Component represents a supervised child process
type Component struct {
	Type      ComponentType
	Cmd       *exec.Cmd
	PID       int
	State     ComponentState
	StartTime time.Time
	Restarts  int
	LastError error
}

// Supervisor manages child processes (workflow-runner, agent-runner)
type Supervisor struct {
	ctx          context.Context
	cancel       context.CancelFunc
	components   map[ComponentType]*Component
	config       *Config
	healthTicker *time.Ticker
}

// Config holds configuration for the supervisor
type Config struct {
	DataDir             string
	LogDir              string
	TemporalAddr        string
	StigmerServerPort   int
	LLMProvider         string
	LLMModel            string
	LLMBaseURL          string
	LLMSecrets          map[string]string
	ExecutionMode       string
	SandboxImage        string
	SandboxAutoPull     bool
	SandboxCleanup      bool
	SandboxTTL          int
	HealthCheckInterval time.Duration
	MaxRestarts         int
}

// NewSupervisor creates a new component supervisor
func NewSupervisor(config *Config) *Supervisor {
	ctx, cancel := context.WithCancel(context.Background())
	return &Supervisor{
		ctx:        ctx,
		cancel:     cancel,
		components: make(map[ComponentType]*Component),
		config:     config,
	}
}

// Start starts all child components and begins health monitoring
func (s *Supervisor) Start() error {
	log.Info().Msg("Starting component supervisor")

	// Start workflow-runner
	if err := s.startWorkflowRunner(); err != nil {
		return errors.Wrap(err, "failed to start workflow-runner")
	}

	// Start agent-runner
	if err := s.startAgentRunner(); err != nil {
		log.Warn().Err(err).Msg("Failed to start agent-runner (continuing without it)")
		// Don't fail - agent-runner is optional if Docker isn't available
	}

	// Start health monitoring
	s.startHealthMonitoring()

	log.Info().Msg("Component supervisor started successfully")
	return nil
}

// Stop stops all child components and monitoring
func (s *Supervisor) Stop() {
	log.Info().Msg("Stopping component supervisor")

	// Stop health monitoring
	if s.healthTicker != nil {
		s.healthTicker.Stop()
	}
	s.cancel()

	// Stop all components
	for _, component := range s.components {
		s.stopComponent(component)
	}

	log.Info().Msg("Component supervisor stopped")
}

// GetComponentStatus returns the current status of all components
func (s *Supervisor) GetComponentStatus() map[ComponentType]ComponentStatus {
	status := make(map[ComponentType]ComponentStatus)
	for typ, component := range s.components {
		status[typ] = ComponentStatus{
			Type:      typ,
			State:     component.State,
			PID:       component.PID,
			StartTime: component.StartTime,
			Restarts:  component.Restarts,
			LastError: component.LastError,
		}
	}
	return status
}

// ComponentStatus holds the status information for a component
type ComponentStatus struct {
	Type      ComponentType
	State     ComponentState
	PID       int
	StartTime time.Time
	Restarts  int
	LastError error
}

// startWorkflowRunner starts the workflow-runner process
func (s *Supervisor) startWorkflowRunner() error {
	log.Info().Msg("Starting workflow-runner")

	// Find CLI binary (BusyBox pattern)
	cliBin, err := os.Executable()
	if err != nil {
		return errors.Wrap(err, "failed to get executable path")
	}

	// Prepare environment
	env := os.Environ()
	env = append(env,
		"EXECUTION_MODE=temporal",
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", s.config.TemporalAddr),
		"TEMPORAL_NAMESPACE=default",
		"TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner",
		"TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE=zigflow_execution",
		"TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", s.config.StigmerServerPort),
		"STIGMER_API_KEY=dummy-local-key",
		"STIGMER_SERVICE_USE_TLS=false",
		"LOG_LEVEL=DEBUG",
		"ENV=local",
	)

	// Create command
	cmd := exec.Command(cliBin, "internal-workflow-runner")
	cmd.Env = env

	// Setup logging
	logFile := filepath.Join(s.config.LogDir, "workflow-runner.log")
	logOutput, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create workflow-runner log file")
	}
	defer logOutput.Close()

	cmd.Stdout = logOutput
	cmd.Stderr = logOutput

	// Start process
	if err := cmd.Start(); err != nil {
		return errors.Wrap(err, "failed to start workflow-runner process")
	}

	// Register component
	component := &Component{
		Type:      ComponentTypeWorkflowRunner,
		Cmd:       cmd,
		PID:       cmd.Process.Pid,
		State:     StateStarting,
		StartTime: time.Now(),
		Restarts:  0,
	}
	s.components[ComponentTypeWorkflowRunner] = component

	// Write PID file
	pidFile := filepath.Join(s.config.DataDir, "workflow-runner.pid")
	if err := os.WriteFile(pidFile, []byte(fmt.Sprintf("%d", cmd.Process.Pid)), 0644); err != nil {
		s.stopComponent(component)
		return errors.Wrap(err, "failed to write PID file")
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Msg("Workflow-runner started")

	// Wait briefly and verify it didn't crash
	time.Sleep(2 * time.Second)
	if !s.isProcessAlive(component.PID) {
		component.State = StateFailed
		return errors.New("workflow-runner crashed immediately after startup")
	}

	component.State = StateRunning
	return nil
}

// startAgentRunner starts the agent-runner in Docker
func (s *Supervisor) startAgentRunner() error {
	log.Info().Msg("Starting agent-runner")

	// Check Docker availability
	if !s.isDockerAvailable() {
		return errors.New("Docker is not available")
	}

	// Ensure Docker image
	if err := s.ensureDockerImage(); err != nil {
		return errors.Wrap(err, "failed to ensure Docker image")
	}

	// Prepare workspace
	workspaceDir := filepath.Join(s.config.DataDir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create workspace directory")
	}

	// Resolve host addresses for Docker
	hostAddr := s.resolveDockerHostAddress(s.config.TemporalAddr)
	backendAddr := s.resolveDockerHostAddress(fmt.Sprintf("localhost:%d", s.config.StigmerServerPort))
	llmBaseURL := s.resolveDockerHostAddress(s.config.LLMBaseURL)

	// Build docker run arguments
	args := []string{
		"run",
		"-d",
		"--name", "stigmer-agent-runner",
		"--restart", "unless-stopped",
	}

	// Use host networking on Linux
	if runtime.GOOS == "linux" {
		args = append(args, "--network", "host")
	}

	args = append(args,
		"-e", "MODE=local",
		"-e", fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=%s", backendAddr),
		"-e", fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", hostAddr),
		"-e", "TEMPORAL_NAMESPACE=default",
		"-e", "TASK_QUEUE=agent_execution_runner",
		"-e", "SANDBOX_TYPE=filesystem",
		"-e", "WORKSPACE_ROOT=/workspace",
		"-e", "LOG_LEVEL=DEBUG",
		"-e", fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", s.config.LLMProvider),
		"-e", fmt.Sprintf("STIGMER_LLM_MODEL=%s", s.config.LLMModel),
		"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
		"-e", fmt.Sprintf("OLLAMA_BASE_URL=%s", llmBaseURL), // LangChain standard variable
	)

	// Add LLM secrets
	for key, value := range s.config.LLMSecrets {
		args = append(args, "-e", fmt.Sprintf("%s=%s", key, value))
	}

	// Add volumes
	args = append(args,
		"-v", fmt.Sprintf("%s:/workspace", workspaceDir),
		"-v", fmt.Sprintf("%s:/logs", s.config.LogDir),
	)

	// Use embedded or external image
	imageName := "ghcr.io/stigmer/agent-runner:latest"
	args = append(args, imageName)

	// Run docker command
	cmd := exec.Command("docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return errors.Wrapf(err, "failed to start agent-runner container: %s", string(output))
	}

	containerID := strings.TrimSpace(string(output))

	// Register component
	component := &Component{
		Type:      ComponentTypeAgentRunner,
		Cmd:       nil, // Docker container, not a process
		PID:       0,   // No PID for Docker
		State:     StateRunning,
		StartTime: time.Now(),
		Restarts:  0,
	}
	s.components[ComponentTypeAgentRunner] = component

	// Write container ID file
	containerIDFile := filepath.Join(s.config.DataDir, "agent-runner.containerid")
	if err := os.WriteFile(containerIDFile, []byte(containerID), 0644); err != nil {
		log.Warn().Err(err).Msg("Failed to write container ID file")
	}

	log.Info().
		Str("container_id", containerID[:12]).
		Msg("Agent-runner started")

	return nil
}

// startHealthMonitoring starts periodic health checks
func (s *Supervisor) startHealthMonitoring() {
	interval := s.config.HealthCheckInterval
	if interval == 0 {
		interval = 10 * time.Second
	}

	s.healthTicker = time.NewTicker(interval)

	go func() {
		for {
			select {
			case <-s.ctx.Done():
				return
			case <-s.healthTicker.C:
				s.checkAllComponents()
			}
		}
	}()

	log.Info().
		Dur("interval", interval).
		Msg("Health monitoring started")
}

// checkAllComponents performs health checks on all components
func (s *Supervisor) checkAllComponents() {
	for _, component := range s.components {
		if component.State == StateFailed {
			continue // Don't check failed components
		}

		healthy := s.checkComponentHealth(component)
		if !healthy {
			log.Warn().
				Str("component", string(component.Type)).
				Msg("Component unhealthy, attempting restart")

			component.State = StateUnhealthy
			s.restartComponent(component)
		}
	}
}

// checkComponentHealth checks if a component is healthy
func (s *Supervisor) checkComponentHealth(component *Component) bool {
	switch component.Type {
	case ComponentTypeWorkflowRunner:
		return s.isProcessAlive(component.PID)
	case ComponentTypeAgentRunner:
		return s.isDockerContainerRunning("stigmer-agent-runner")
	default:
		return false
	}
}

// restartComponent restarts a failed component
func (s *Supervisor) restartComponent(component *Component) {
	if component.Restarts >= s.config.MaxRestarts {
		component.State = StateFailed
		log.Error().
			Str("component", string(component.Type)).
			Int("restarts", component.Restarts).
			Msg("Component exceeded max restarts, giving up")
		return
	}

	component.State = StateRestarting
	component.Restarts++

	log.Info().
		Str("component", string(component.Type)).
		Int("restart_count", component.Restarts).
		Msg("Restarting component")

	// Stop existing instance
	s.stopComponent(component)

	// Wait before restart
	time.Sleep(5 * time.Second)

	// Restart based on type
	var err error
	switch component.Type {
	case ComponentTypeWorkflowRunner:
		err = s.startWorkflowRunner()
	case ComponentTypeAgentRunner:
		err = s.startAgentRunner()
	}

	if err != nil {
		component.LastError = err
		component.State = StateFailed
		log.Error().
			Err(err).
			Str("component", string(component.Type)).
			Msg("Failed to restart component")
	}
}

// stopComponent stops a component
func (s *Supervisor) stopComponent(component *Component) {
	switch component.Type {
	case ComponentTypeWorkflowRunner:
		if component.PID > 0 {
			process, err := os.FindProcess(component.PID)
			if err == nil {
				_ = process.Signal(os.Interrupt)
				time.Sleep(2 * time.Second)
				_ = process.Kill()
			}
		}
	case ComponentTypeAgentRunner:
		cmd := exec.Command("docker", "stop", "stigmer-agent-runner")
		_ = cmd.Run()
		cmd = exec.Command("docker", "rm", "stigmer-agent-runner")
		_ = cmd.Run()
	}
}

// isProcessAlive checks if a process is running (not zombie/defunct)
func (s *Supervisor) isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}

	// Note: os.FindProcess() always succeeds on Unix, even for zombies!
	// We need to actually check the process state.

	// First, check if we can signal it (quick check)
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if err := process.Signal(syscall.Signal(0)); err != nil {
		return false // Process doesn't exist
	}

	// Signal succeeded, but could be a zombie. Check actual state.
	// Use ps to verify it's not in zombie/defunct state
	cmd := exec.Command("ps", "-p", fmt.Sprintf("%d", pid), "-o", "stat=")
	output, err := cmd.Output()
	if err != nil {
		// ps failed - process likely doesn't exist
		return false
	}

	stat := strings.TrimSpace(string(output))
	if stat == "" {
		return false // No output = process gone
	}

	// Check if process is zombie (Z or <defunct>)
	// STAT codes: Z = zombie, T = stopped, R = running, S = sleeping
	if strings.HasPrefix(stat, "Z") || strings.Contains(stat, "<defunct>") {
		log.Warn().
			Int("pid", pid).
			Str("stat", stat).
			Msg("Process is zombie/defunct - marking as dead")
		return false
	}

	return true
}

// isDockerAvailable checks if Docker is available
func (s *Supervisor) isDockerAvailable() bool {
	cmd := exec.Command("docker", "version")
	err := cmd.Run()
	return err == nil
}

// isDockerContainerRunning checks if a Docker container is running
func (s *Supervisor) isDockerContainerRunning(name string) bool {
	cmd := exec.Command("docker", "inspect", "-f", "{{.State.Running}}", name)
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(output)) == "true"
}

// ensureDockerImage ensures the agent-runner image is available
func (s *Supervisor) ensureDockerImage() error {
	// For now, just check if image exists
	cmd := exec.Command("docker", "images", "-q", "ghcr.io/stigmer/agent-runner:latest")
	output, err := cmd.Output()
	if err != nil {
		return err
	}
	if len(output) == 0 {
		log.Info().Msg("Agent-runner image not found locally, pulling...")
		cmd = exec.Command("docker", "pull", "ghcr.io/stigmer/agent-runner:latest")
		if err := cmd.Run(); err != nil {
			return errors.Wrap(err, "failed to pull agent-runner image")
		}
	}
	return nil
}

// resolveDockerHostAddress resolves localhost to host.docker.internal for Docker containers
func (s *Supervisor) resolveDockerHostAddress(addr string) string {
	if runtime.GOOS == "linux" {
		return addr // Linux can use localhost with --network host
	}
	// macOS/Windows: Replace localhost with host.docker.internal
	return strings.ReplaceAll(addr, "localhost", "host.docker.internal")
}
