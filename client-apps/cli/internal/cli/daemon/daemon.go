package daemon

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/temporal"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	// DaemonPort is the port the daemon listens on
	// Using 7234 (Temporal + 1) to indicate relationship with Temporal (7233)
	DaemonPort = 7234

	// PIDFileName is the name of the PID file for stigmer-server
	PIDFileName = "daemon.pid"
	
	// WorkflowRunnerPIDFileName is the name of the PID file for workflow-runner
	WorkflowRunnerPIDFileName = "workflow-runner.pid"
	
	// AgentRunnerPIDFileName is the name of the PID file for agent-runner (binary mode)
	AgentRunnerPIDFileName = "agent-runner.pid"
	
	// AgentRunnerContainerIDFileName is the name of the file storing Docker container ID
	AgentRunnerContainerIDFileName = "agent-runner-container.id"
	
	// AgentRunnerContainerName is the name of the Docker container
	AgentRunnerContainerName = "stigmer-agent-runner"
	
	// AgentRunnerDockerImage is the Docker image name and tag
	AgentRunnerDockerImage = "stigmer-agent-runner:local"
)

// StartOptions provides options for starting the daemon
type StartOptions struct {
	Progress *cliprint.ProgressDisplay // Optional progress display for UI
}

// dockerAvailable checks if Docker is installed and running
func dockerAvailable() bool {
	// Check if docker command exists
	if _, err := exec.LookPath("docker"); err != nil {
		return false
	}
	
	// Check if Docker daemon is running
	cmd := exec.Command("docker", "info")
	if err := cmd.Run(); err != nil {
		return false
	}
	
	return true
}

// ensureDockerImage ensures the agent-runner Docker image is available
func ensureDockerImage(dataDir string) error {
	// Check if image exists
	cmd := exec.Command("docker", "images", "-q", AgentRunnerDockerImage)
	output, err := cmd.Output()
	if err != nil {
		return errors.Wrap(err, "failed to check for Docker image")
	}
	
	// Image exists
	if len(strings.TrimSpace(string(output))) > 0 {
		log.Debug().Str("image", AgentRunnerDockerImage).Msg("Docker image already exists")
		return nil
	}
	
	// Image doesn't exist - try to build it
	log.Info().Str("image", AgentRunnerDockerImage).Msg("Building Docker image...")
	
	// Find repository root (go up from data dir to find backend/services/agent-runner)
	// For now, assume we're in development and can build from source
	// In production, this would pull from a registry
	return errors.New("Docker image not found. Please build it first:\n" +
		"  cd backend/services/agent-runner\n" +
		"  docker build -f Dockerfile -t stigmer-agent-runner:local ../../..")
}

// Start starts the stigmer daemon in the background.
//
// Lifecycle Management:
// - Cleans up any orphaned processes from previous runs (kills zombies)
// - Starts fresh processes with new PIDs
// - Returns error if server is already running (caller should stop first)
//
// The daemon runs stigmer-server on localhost:7234 and manages:
// - gRPC API server (stigmer-server)
// - BadgerDB database
// - Temporal server (if managed)
// - Workflow runner (subprocess)
// - Agent runner (subprocess)
//
// Note: This function is called by both 'stigmer server start' and automatic
// daemon startup (EnsureRunning). The cleanup ensures idempotent behavior.
func Start(dataDir string) error {
	return StartWithOptions(dataDir, StartOptions{})
}

// StartWithOptions starts the daemon with custom options
func StartWithOptions(dataDir string, opts StartOptions) error {
	log.Debug().Str("data_dir", dataDir).Msg("Starting daemon")

	// CRITICAL: Clean up any orphaned processes from previous runs
	// This prevents zombie processes when the daemon crashes or is killed -9
	cleanupOrphanedProcesses(dataDir)

	// Check if already running
	if IsRunning(dataDir) {
		return errors.New("daemon is already running")
	}

	// Ensure data directory exists
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInitializing, "Setting up data directory")
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create data directory")
	}

	// Extract embedded binaries if needed
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInitializing, "Extracting binaries")
	}
	if err := embedded.EnsureBinariesExtracted(dataDir); err != nil {
		return errors.Wrap(err, "failed to extract embedded binaries")
	}

	// Rotate logs before starting new session
	if err := rotateLogsIfNeeded(dataDir); err != nil {
		log.Warn().Err(err).Msg("Failed to rotate logs, continuing anyway")
		// Don't fail daemon startup if log rotation fails
	}

	// Load configuration
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInitializing, "Loading configuration")
	}
	cfg, err := config.Load()
	if err != nil {
		log.Warn().Err(err).Msg("Failed to load config, using defaults")
		cfg = config.GetDefault()
	}

	// Resolve LLM configuration
	llmProvider := cfg.Backend.Local.ResolveLLMProvider()
	llmModel := cfg.Backend.Local.ResolveLLMModel()
	llmBaseURL := cfg.Backend.Local.ResolveLLMBaseURL()

	log.Debug().
		Str("llm_provider", llmProvider).
		Str("llm_model", llmModel).
		Str("llm_base_url", llmBaseURL).
		Msg("Resolved LLM configuration")

	// Show LLM provider message
	if opts.Progress != nil {
		if llmProvider == "ollama" {
			cliprint.PrintSuccess("Using Ollama (no API key required)")
		} else {
			cliprint.PrintInfo("Using %s with model %s", llmProvider, llmModel)
		}
	}

	// Gather provider-specific secrets
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInitializing, "Gathering credentials")
	}
	secrets, err := GatherRequiredSecrets(llmProvider)
	if err != nil {
		return errors.Wrap(err, "failed to gather required secrets")
	}

	// Resolve Temporal configuration
	temporalAddr, isManaged := cfg.Backend.Local.ResolveTemporalAddress()
	
	log.Debug().
		Str("temporal_address", temporalAddr).
		Bool("temporal_managed", isManaged).
		Msg("Resolved Temporal configuration")

	// Start managed Temporal if configured
	var temporalManager *temporal.Manager
	if isManaged {
		if opts.Progress != nil {
			opts.Progress.SetPhase(cliprint.PhaseInstalling, "Setting up Temporal")
		}
		log.Info().Msg("Starting managed Temporal server...")
		
		temporalManager = temporal.NewManager(
			dataDir,
			cfg.Backend.Local.ResolveTemporalVersion(),
			cfg.Backend.Local.ResolveTemporalPort(),
		)
		
		if err := temporalManager.EnsureInstalled(); err != nil {
			return errors.Wrap(err, "failed to ensure Temporal installation")
		}
		
		if opts.Progress != nil {
			opts.Progress.SetPhase(cliprint.PhaseDeploying, "Starting Temporal server")
		}
		if err := temporalManager.Start(); err != nil {
			return errors.Wrap(err, "failed to start Temporal")
		}
		
		temporalAddr = temporalManager.GetAddress()
		log.Info().Str("address", temporalAddr).Msg("Temporal started successfully")
	} else {
		log.Info().Str("address", temporalAddr).Msg("Using external Temporal")
	}

	// Find CLI binary (BusyBox pattern - CLI contains server code)
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseDeploying, "Starting Stigmer server")
	}
	cliBin, err := os.Executable()
	if err != nil {
		return errors.Wrap(err, "failed to get CLI executable path")
	}

	log.Debug().Str("binary", cliBin).Msg("Starting stigmer-server via CLI")

	// Start daemon process (spawn CLI with hidden internal-server command)
	cmd := exec.Command(cliBin, "internal-server")
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
		fmt.Sprintf("GRPC_PORT=%d", DaemonPort),
	)

	// Redirect output to log files
	logDir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create log directory")
	}

	stdoutLog := filepath.Join(logDir, "stigmer-server.log")
	stderrLog := filepath.Join(logDir, "stigmer-server.err")

	stdout, err := os.OpenFile(stdoutLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create stdout log file")
	}
	defer stdout.Close()

	stderr, err := os.OpenFile(stderrLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create stderr log file")
	}
	defer stderr.Close()

	cmd.Stdout = stdout
	cmd.Stderr = stderr

	// Start process detached
	if err := cmd.Start(); err != nil {
		return errors.Wrap(err, "failed to start daemon process")
	}

	// Write PID file
	pidFile := filepath.Join(dataDir, PIDFileName)
	pidContent := fmt.Sprintf("%d", cmd.Process.Pid)
	if err := os.WriteFile(pidFile, []byte(pidContent), 0644); err != nil {
		// Kill the process if we can't write PID file
		_ = cmd.Process.Kill()
		return errors.Wrap(err, "failed to write PID file")
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Int("port", DaemonPort).
		Str("data_dir", dataDir).
		Msg("Daemon started successfully")

	// Start workflow-runner subprocess (Temporal worker mode)
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseDeploying, "Starting workflow runner")
	}
	if err := startWorkflowRunner(dataDir, logDir, temporalAddr); err != nil {
		log.Error().Err(err).Msg("Failed to start workflow-runner, continuing without it")
		// Don't fail the entire daemon startup if workflow-runner fails
		// Workflows won't execute but the server is still useful
	}

	// Start agent-runner subprocess with LLM config and injected secrets
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseDeploying, "Starting agent runner")
	}
	if err := startAgentRunner(dataDir, logDir, llmProvider, llmModel, llmBaseURL, temporalAddr, secrets); err != nil {
		log.Error().Err(err).Msg("Failed to start agent-runner, continuing without it")
		// Don't fail the entire daemon startup if agent-runner fails
		// The server is still useful without the agent-runner
	}

	return nil
}

// startWorkflowRunner starts the workflow-runner subprocess in Temporal worker mode
func startWorkflowRunner(
	dataDir string,
	logDir string,
	temporalAddr string,
) error {
	// Find CLI binary (BusyBox pattern - CLI contains workflow-runner code)
	cliBin, err := os.Executable()
	if err != nil {
		return errors.Wrap(err, "failed to get CLI executable path")
	}

	log.Debug().Str("binary", cliBin).Msg("Starting workflow-runner via CLI")

	// Prepare environment for Temporal worker mode
	env := os.Environ()
	env = append(env,
		// Execution mode: temporal worker only (no gRPC server)
		"EXECUTION_MODE=temporal",
		
		// Temporal configuration
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr),
		"TEMPORAL_NAMESPACE=default",
		// CRITICAL: Must use TEMPORAL_ prefix to match workflow-runner config expectations
		"TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner",
		"TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE=zigflow_execution",
		"TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner",
		
		// Stigmer backend configuration (for callbacks)
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", DaemonPort),
		"STIGMER_API_KEY=dummy-local-key",
		"STIGMER_SERVICE_USE_TLS=false",
		
		"LOG_LEVEL=DEBUG",
		"ENV=local",
	)

	log.Info().
		Str("temporal_address", temporalAddr).
		Msg("Starting workflow-runner with configuration")

	// Start workflow-runner process (spawn CLI with hidden internal-workflow-runner command)
	cmd := exec.Command(cliBin, "internal-workflow-runner")
	cmd.Env = env

	// Redirect output to separate log files
	stdoutLog := filepath.Join(logDir, "workflow-runner.log")
	stderrLog := filepath.Join(logDir, "workflow-runner.err")

	stdout, err := os.OpenFile(stdoutLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create workflow-runner stdout log file")
	}
	defer stdout.Close()

	stderr, err := os.OpenFile(stderrLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create workflow-runner stderr log file")
	}
	defer stderr.Close()

	cmd.Stdout = stdout
	cmd.Stderr = stderr

	// Start process
	if err := cmd.Start(); err != nil {
		return errors.Wrap(err, "failed to start workflow-runner process")
	}

	// Write PID file
	pidFile := filepath.Join(dataDir, WorkflowRunnerPIDFileName)
	pidContent := fmt.Sprintf("%d", cmd.Process.Pid)
	if err := os.WriteFile(pidFile, []byte(pidContent), 0644); err != nil {
		// Kill the process if we can't write PID file
		_ = cmd.Process.Kill()
		return errors.Wrap(err, "failed to write workflow-runner PID file")
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Str("binary", cliBin).
		Msg("Workflow-runner started successfully")

	return nil
}

// startAgentRunner starts the agent-runner in Docker container
func startAgentRunner(
	dataDir string,
	logDir string,
	llmProvider string,
	llmModel string,
	llmBaseURL string,
	temporalAddr string,
	secrets map[string]string,
) error {
	// Check if Docker is available
	if !dockerAvailable() {
		log.Warn().Msg("Docker is not available, skipping agent-runner startup")
		return errors.New(`Docker is not running. Agent-runner requires Docker.

Please start Docker Desktop or install Docker:
  - macOS:  brew install --cask docker
  - Linux:  curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh
  - Windows: Download from https://www.docker.com/products/docker-desktop

After installing Docker, restart Stigmer server.`)
	}
	
	// Ensure Docker image exists
	if err := ensureDockerImage(dataDir); err != nil {
		return errors.Wrap(err, "failed to ensure Docker image")
	}
	
	// Prepare workspace directory
	workspaceDir := filepath.Join(dataDir, "workspace")
	if err := os.MkdirAll(workspaceDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create workspace directory")
	}
	
	// Build docker run arguments
	args := []string{
		"run",
		"-d", // Detached mode
		"--name", AgentRunnerContainerName,
		"--network", "host", // Use host networking for localhost access
		"--restart", "unless-stopped",
		
		// Environment variables
		"-e", "MODE=local",
		"-e", fmt.Sprintf("STIGMER_BACKEND_URL=http://localhost:%d", DaemonPort),
		"-e", fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr),
		"-e", "TEMPORAL_NAMESPACE=default",
		"-e", "TASK_QUEUE=agent_execution_runner",
		"-e", "SANDBOX_TYPE=filesystem",
		"-e", "WORKSPACE_ROOT=/workspace",
		"-e", "LOG_LEVEL=DEBUG",
		
		// LLM configuration
		"-e", fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", llmProvider),
		"-e", fmt.Sprintf("STIGMER_LLM_MODEL=%s", llmModel),
		"-e", fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
		
		// Volume mount for workspace
		"-v", fmt.Sprintf("%s:/workspace", workspaceDir),
		
		// Log driver for better log access
		"--log-driver", "json-file",
		"--log-opt", "max-size=10m",
		"--log-opt", "max-file=3",
	}
	
	// Inject provider-specific secrets
	for key, value := range secrets {
		args = append(args, "-e", fmt.Sprintf("%s=%s", key, value))
	}
	
	// Add image name
	args = append(args, AgentRunnerDockerImage)
	
	log.Info().
		Str("llm_provider", llmProvider).
		Str("llm_model", llmModel).
		Str("temporal_address", temporalAddr).
		Str("image", AgentRunnerDockerImage).
		Msg("Starting agent-runner Docker container")
	
	// Remove any existing container with the same name
	_ = exec.Command("docker", "rm", "-f", AgentRunnerContainerName).Run()
	
	// Start container
	cmd := exec.Command("docker", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return errors.Wrapf(err, "failed to start agent-runner container: %s", string(output))
	}
	
	containerID := strings.TrimSpace(string(output))
	
	// Store container ID for management
	containerIDFile := filepath.Join(dataDir, AgentRunnerContainerIDFileName)
	if err := os.WriteFile(containerIDFile, []byte(containerID), 0644); err != nil {
		// Try to stop the container if we can't write the ID file
		_ = exec.Command("docker", "stop", containerID).Run()
		_ = exec.Command("docker", "rm", containerID).Run()
		return errors.Wrap(err, "failed to write container ID file")
	}
	
	log.Info().
		Str("container_id", containerID[:12]).
		Str("container_name", AgentRunnerContainerName).
		Msg("Agent-runner container started successfully")
	
	return nil
}

// isProcessAlive checks if a process with given PID is actually running.
//
// On macOS, os.FindProcess() always succeeds even if the process doesn't exist,
// so we need to send signal 0 (null signal) to actually verify the process is alive.
func isProcessAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	
	// Send signal 0 (null signal) to check if process exists
	// This doesn't actually send a signal, just checks if we CAN send one
	err = process.Signal(syscall.Signal(0))
	return err == nil
}

// cleanupOrphanedProcesses kills any orphaned processes and containers from previous daemon runs.
//
// This is critical for preventing zombie processes when:
// - Daemon crashes
// - User kills daemon with kill -9
// - System restarts without proper shutdown
//
// Without this cleanup, restarting the daemon would leave old processes running,
// causing port conflicts, resource leaks, and general chaos.
func cleanupOrphanedProcesses(dataDir string) {
	log.Debug().Msg("Checking for orphaned processes and containers from previous runs")
	
	// Check each PID file and kill if process is running
	pidFiles := map[string]string{
		"stigmer-server":   filepath.Join(dataDir, PIDFileName),
		"workflow-runner":  filepath.Join(dataDir, WorkflowRunnerPIDFileName),
	}
	
	orphansFound := false
	
	for name, pidFile := range pidFiles {
		data, err := os.ReadFile(pidFile)
		if err != nil {
			continue // No PID file
		}
		
		pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err != nil {
			log.Warn().
				Str("component", name).
				Str("pid_file", pidFile).
				Msg("Invalid PID file, removing")
			_ = os.Remove(pidFile)
			continue
		}
		
		// Check if process is actually running
		if isProcessAlive(pid) {
			orphansFound = true
			log.Warn().
				Str("component", name).
				Int("pid", pid).
				Msg("Found orphaned process from previous run, killing")
			
			process, _ := os.FindProcess(pid)
			
			// Try graceful kill first
			_ = process.Signal(syscall.SIGTERM)
			time.Sleep(500 * time.Millisecond)
			
			// Force kill if still alive
			if isProcessAlive(pid) {
				log.Warn().Str("component", name).Int("pid", pid).Msg("Process didn't stop gracefully, force killing")
				_ = process.Kill()
				time.Sleep(500 * time.Millisecond)
			}
		}
		
		// Clean up PID file
		_ = os.Remove(pidFile)
	}
	
	// Check for orphaned agent-runner Docker container
	cmd := exec.Command("docker", "ps", "-aq", "-f", fmt.Sprintf("name=^%s$", AgentRunnerContainerName))
	output, err := cmd.Output()
	if err == nil && len(output) > 0 {
		containerID := strings.TrimSpace(string(output))
		orphansFound = true
		log.Warn().
			Str("container_id", containerID[:12]).
			Str("container_name", AgentRunnerContainerName).
			Msg("Found orphaned agent-runner container from previous run, removing")
		
		// Stop and remove container
		_ = exec.Command("docker", "stop", containerID).Run()
		_ = exec.Command("docker", "rm", containerID).Run()
		
		// Clean up container ID file
		containerIDFile := filepath.Join(dataDir, AgentRunnerContainerIDFileName)
		_ = os.Remove(containerIDFile)
	}
	
	// Also check for orphaned Temporal (if managed)
	cfg, err := config.Load()
	if err == nil && (cfg.Backend.Local.Temporal == nil || cfg.Backend.Local.Temporal.Managed) {
		// Load config, use defaults if it fails
		temporalManager := temporal.NewManager(
			dataDir,
			cfg.Backend.Local.ResolveTemporalVersion(),
			cfg.Backend.Local.ResolveTemporalPort(),
		)
		
		if temporalManager.IsRunning() {
			orphansFound = true
			log.Warn().Msg("Found orphaned Temporal server from previous run, stopping")
			_ = temporalManager.Stop()
		}
	}
	
	if orphansFound {
		log.Info().Msg("Cleaned up orphaned processes and containers from previous run")
	} else {
		log.Debug().Msg("No orphaned processes or containers found")
	}
}

// Stop stops the stigmer daemon, workflow-runner, agent-runner, and managed Temporal
func Stop(dataDir string) error {
	log.Debug().Str("data_dir", dataDir).Msg("Stopping daemon")

	// Stop workflow-runner first (if running)
	stopWorkflowRunner(dataDir)

	// Stop agent-runner (if running)
	stopAgentRunner(dataDir)

	// Stop managed Temporal (if running)
	stopManagedTemporal(dataDir)

	// Stop stigmer-server
	// First try to get PID from file
	pid, err := getPID(dataDir)
	if err != nil {
		// No PID file - try to find process by port
		log.Warn().Msg("PID file not found, searching for process by port")
		pid, err = findProcessByPort(DaemonPort)
		if err != nil {
			return errors.Wrap(err, "daemon is not running (no PID file and no process on port)")
		}
		log.Info().Int("pid", pid).Msg("Found orphaned daemon process by port")
	}

	// Check if process is actually alive (fixes macOS issue where os.FindProcess always succeeds)
	if !isProcessAlive(pid) {
		log.Debug().Int("pid", pid).Msg("Daemon not running (stale PID file)")
		pidFile := filepath.Join(dataDir, PIDFileName)
		_ = os.Remove(pidFile)
		return errors.New("daemon is not running")
	}

	// Process exists, try to stop it
	process, _ := os.FindProcess(pid)

	// Send SIGTERM for graceful shutdown
	if err := process.Signal(syscall.SIGTERM); err != nil {
		return errors.Wrap(err, "failed to send SIGTERM to daemon")
	}

	log.Info().Int("pid", pid).Msg("Sent SIGTERM to daemon")

	// Wait for process to exit (up to 10 seconds)
	for i := 0; i < 20; i++ {
		if !IsRunning(dataDir) {
			// Remove PID file (if it exists)
			pidFile := filepath.Join(dataDir, PIDFileName)
			_ = os.Remove(pidFile)
			
			log.Info().Msg("Daemon stopped successfully")
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	// Force kill if still running
	log.Warn().Msg("Daemon did not stop gracefully, force killing")
	if err := process.Kill(); err != nil {
		return errors.Wrap(err, "failed to kill daemon process")
	}

	// Remove PID file (if it exists)
	pidFile := filepath.Join(dataDir, PIDFileName)
	_ = os.Remove(pidFile)

	return nil
}

// stopManagedTemporal stops managed Temporal if it's running
func stopManagedTemporal(dataDir string) {
	// Load config, use defaults if it fails
	cfg, err := config.Load()
	if err != nil {
		log.Debug().Err(err).Msg("Failed to load config, using defaults for Temporal stop")
		cfg = config.GetDefault()
	}
	
	// Skip if explicitly configured as external Temporal
	if cfg.Backend.Local.Temporal != nil && !cfg.Backend.Local.Temporal.Managed {
		return // Using external Temporal, don't stop it
	}
	
	// Create manager with config (or defaults)
	tm := temporal.NewManager(
		dataDir,
		cfg.Backend.Local.ResolveTemporalVersion(),
		cfg.Backend.Local.ResolveTemporalPort(),
	)
	
	if !tm.IsRunning() {
		return // Not running
	}
	
	log.Info().Msg("Stopping managed Temporal...")
	if err := tm.Stop(); err != nil {
		log.Error().Err(err).Msg("Failed to stop Temporal")
	} else {
		log.Info().Msg("Temporal stopped successfully")
	}
}

// stopWorkflowRunner stops the workflow-runner subprocess
func stopWorkflowRunner(dataDir string) {
	pidFile := filepath.Join(dataDir, WorkflowRunnerPIDFileName)
	
	// Read PID file
	data, err := os.ReadFile(pidFile)
	if err != nil {
		// No PID file means workflow-runner is not running
		return
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		log.Warn().Str("pid_file", pidFile).Msg("Invalid workflow-runner PID file")
		_ = os.Remove(pidFile)
		return
	}

	// Check if process is actually alive FIRST (fixes macOS issue where os.FindProcess always succeeds)
	if !isProcessAlive(pid) {
		log.Debug().Int("pid", pid).Msg("Workflow-runner not running (stale PID file)")
		_ = os.Remove(pidFile)
		return
	}

	// Process exists, try to stop it
	process, _ := os.FindProcess(pid)

	// Send SIGTERM for graceful shutdown
	if err := process.Signal(syscall.SIGTERM); err != nil {
		log.Warn().Int("pid", pid).Err(err).Msg("Failed to send SIGTERM to workflow-runner")
		_ = os.Remove(pidFile)
		return
	}

	log.Info().Int("pid", pid).Msg("Sent SIGTERM to workflow-runner")

	// Wait for process to exit (up to 5 seconds)
	for i := 0; i < 10; i++ {
		if !isProcessAlive(pid) {
			// Process is dead
			_ = os.Remove(pidFile)
			log.Info().Msg("Workflow-runner stopped successfully")
			return
		}
		time.Sleep(500 * time.Millisecond)
	}

	// Force kill if still running
	log.Warn().Msg("Workflow-runner did not stop gracefully, force killing")
	_ = process.Kill()
	
	// Wait a bit for kill to take effect
	time.Sleep(500 * time.Millisecond)
	_ = os.Remove(pidFile)
}

// stopAgentRunner stops the agent-runner Docker container
func stopAgentRunner(dataDir string) {
	// Try to read container ID from file
	containerIDFile := filepath.Join(dataDir, AgentRunnerContainerIDFileName)
	data, err := os.ReadFile(containerIDFile)
	
	var containerID string
	if err == nil {
		containerID = strings.TrimSpace(string(data))
	}
	
	// If no container ID file, try to find container by name
	if containerID == "" {
		log.Debug().Msg("No container ID file found, trying to find container by name")
		cmd := exec.Command("docker", "ps", "-aq", "-f", fmt.Sprintf("name=^%s$", AgentRunnerContainerName))
		output, err := cmd.Output()
		if err != nil || len(output) == 0 {
			log.Debug().Msg("No agent-runner container found")
			return
		}
		containerID = strings.TrimSpace(string(output))
	}
	
	if containerID == "" {
		return
	}
	
	log.Info().Str("container_id", containerID[:12]).Msg("Stopping agent-runner container")
	
	// Stop container (graceful)
	stopCmd := exec.Command("docker", "stop", containerID)
	if err := stopCmd.Run(); err != nil {
		log.Warn().Str("container_id", containerID[:12]).Err(err).Msg("Failed to stop container gracefully")
		
		// Try force kill
		killCmd := exec.Command("docker", "kill", containerID)
		if err := killCmd.Run(); err != nil {
			log.Error().Str("container_id", containerID[:12]).Err(err).Msg("Failed to kill container")
		}
	}
	
	// Remove container
	rmCmd := exec.Command("docker", "rm", containerID)
	if err := rmCmd.Run(); err != nil {
		log.Warn().Str("container_id", containerID[:12]).Err(err).Msg("Failed to remove container")
	}
	
	// Clean up container ID file
	_ = os.Remove(containerIDFile)
	
	log.Info().Msg("Agent-runner container stopped successfully")
}

// IsRunning checks if the daemon is running
func IsRunning(dataDir string) bool {
	// First try PID file check (most reliable when PID file exists)
	pid, err := getPID(dataDir)
	if err == nil {
		// PID file exists - check if process is alive
		process, err := os.FindProcess(pid)
		if err == nil {
			// Send signal 0 to check if process is alive
			if process.Signal(syscall.Signal(0)) == nil {
				log.Debug().Int("pid", pid).Msg("Daemon is running (verified via PID file)")
				return true
			}
		}
		// PID file exists but process is dead - clean up stale PID file
		log.Warn().Int("pid", pid).Msg("Stale PID file found, cleaning up")
		_ = os.Remove(filepath.Join(dataDir, PIDFileName))
	}

	// Fallback: Try to connect with grpc.WithBlock() to verify server is actually ready
	// This handles cases where the PID file is missing but server is actually running
	// Using WithBlock() ensures we only return true if the server is ready to accept requests
	endpoint := fmt.Sprintf("localhost:%d", DaemonPort)
	
	// Short timeout - we're just checking if it's running, not waiting for startup
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()
	
	conn, err := grpc.DialContext(ctx, endpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(), // Block until connection is established or timeout
	)
	if err != nil {
		log.Debug().Err(err).Msg("Daemon is not running (connection failed)")
		return false
	}
	defer conn.Close()

	// Successfully connected with blocking dial - server is definitely running and ready
	log.Warn().
		Str("endpoint", endpoint).
		Msg("Daemon is running but PID file is missing - this may cause issues with 'stigmer server stop'")
	return true
}

// EnsureRunning ensures the daemon is running, starting it if necessary
//
// This is the magic function that makes the CLI "just work" - similar to how
// Docker auto-starts the daemon or Minikube starts the cluster.
//
// If the daemon is already running, this returns immediately.
// If not, it starts the daemon with user-friendly progress messages.
func EnsureRunning(dataDir string) error {
	// Already running? We're done!
	if IsRunning(dataDir) {
		log.Debug().Msg("Daemon is already running")
		return nil
	}

	// Not running - start it with nice UX
	cliprint.PrintInfo("🚀 Starting local backend daemon...")
	cliprint.PrintInfo("   This may take a moment on first run")
	fmt.Println()

	// Create progress display for nice output
	progress := cliprint.NewProgressDisplay()
	progress.Start()
	defer progress.Stop()

	// Start the daemon
	if err := StartWithOptions(dataDir, StartOptions{Progress: progress}); err != nil {
		return errors.Wrap(err, "failed to start daemon")
	}

	cliprint.PrintSuccess("✓ Daemon started successfully")
	fmt.Println()

	// No need to wait here - the gRPC client connection with WithBlock()
	// will automatically wait until the server is ready when commands try to connect
	// This is cleaner than polling and works reliably

	return nil
}

// GetStatus returns the daemon status
func GetStatus(dataDir string) (running bool, pid int) {
	pid, err := getPID(dataDir)
	if err != nil {
		return false, 0
	}

	process, err := os.FindProcess(pid)
	if err != nil {
		return false, 0
	}

	err = process.Signal(syscall.Signal(0))
	return err == nil, pid
}

// WaitForReady waits for the daemon to be ready to accept connections
//
// Uses gRPC's built-in blocking dial to wait until the server is ready.
// This is more reliable than polling and respects the context timeout.
func WaitForReady(ctx context.Context, endpoint string) error {
	log.Debug().
		Str("endpoint", endpoint).
		Msg("Waiting for daemon to be ready")

	// Use blocking dial - this automatically waits until server is ready or timeout
	conn, err := grpc.DialContext(ctx, endpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(), // Block until connection is established
	)
	if err != nil {
		return errors.Wrap(err, "daemon did not become ready in time")
	}
	conn.Close()

	log.Debug().Msg("Daemon is ready to accept connections")
	return nil
}

// getPID reads the PID from the PID file
func getPID(dataDir string) (int, error) {
	pidFile := filepath.Join(dataDir, PIDFileName)
	
	data, err := os.ReadFile(pidFile)
	if err != nil {
		return 0, errors.Wrap(err, "failed to read PID file")
	}

	pid, err := strconv.Atoi(string(data))
	if err != nil {
		return 0, errors.Wrap(err, "invalid PID in PID file")
	}

	return pid, nil
}

// findProcessByPort finds the PID of the process listening on the specified port
// This is used as a fallback when the PID file is missing but the server is running
func findProcessByPort(port int) (int, error) {
	// Use lsof to find process listening on the port
	cmd := exec.Command("lsof", "-t", "-i", fmt.Sprintf(":%d", port), "-sTCP:LISTEN")
	output, err := cmd.Output()
	if err != nil {
		return 0, errors.Wrap(err, "failed to find process on port")
	}

	// Parse PID from output
	pidStr := strings.TrimSpace(string(output))
	if pidStr == "" {
		return 0, errors.New("no process found listening on port")
	}

	// lsof might return multiple PIDs (one per line) - take the first one
	lines := strings.Split(pidStr, "\n")
	pid, err := strconv.Atoi(strings.TrimSpace(lines[0]))
	if err != nil {
		return 0, errors.Wrap(err, "invalid PID from lsof output")
	}

	return pid, nil
}

// Note: findServerBinary and findWorkflowRunnerBinary removed
// BusyBox pattern: CLI contains server and workflow-runner code
// They are started via hidden commands: stigmer internal-server, stigmer internal-workflow-runner

// findAgentRunnerBinary finds the agent-runner binary (PyInstaller)
//
// Lookup order:
//   1. Extracted binary from dataDir/bin/agent-runner (embedded in CLI)
//   2. Download from GitHub releases if missing (fallback for corrupted installations)
func findAgentRunnerBinary(dataDir string) (string, error) {
	// Check for extracted binary first
	binPath := filepath.Join(dataDir, "bin", "agent-runner")
	if _, err := os.Stat(binPath); err == nil {
		log.Debug().Str("path", binPath).Msg("Using extracted agent-runner binary")
		return binPath, nil
	}

	// Binary not found - download from GitHub releases as fallback
	log.Info().Msg("Agent-runner binary not found, downloading from GitHub releases...")
	
	version := embedded.GetBuildVersion()
	downloadedPath, err := downloadAgentRunnerBinary(dataDir, version)
	if err != nil {
		return "", errors.Wrap(err, `failed to download agent-runner binary

This usually means either:
  1. Your Stigmer CLI installation is corrupted
  2. The GitHub release does not include agent-runner binaries
  3. Network connectivity issues

To fix this:
  brew reinstall stigmer    (if installed via Homebrew)
  
Or download and install the latest release:
  https://github.com/stigmer/stigmer/releases`)
	}

	log.Info().Str("path", downloadedPath).Msg("Successfully downloaded agent-runner binary")
	return downloadedPath, nil
}


// rotateLogsIfNeeded rotates existing log files by renaming them with timestamps
// This is called on daemon start to archive old logs before starting a fresh session
func rotateLogsIfNeeded(dataDir string) error {
	logDir := filepath.Join(dataDir, "logs")
	
	// Ensure log directory exists
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create log directory")
	}
	
	// Generate timestamp for this rotation
	timestamp := time.Now().Format("2006-01-02-150405")
	
	// List of log files to rotate
	logFiles := []string{
		"stigmer-server.log",
		"stigmer-server.err",
		"agent-runner.log",
		"agent-runner.err",
		"workflow-runner.log",
		"workflow-runner.err",
	}
	
	// Rotate each log file if it exists
	rotatedCount := 0
	for _, logFile := range logFiles {
		oldPath := filepath.Join(logDir, logFile)
		
		// Check if file exists and has content
		info, err := os.Stat(oldPath)
		if err != nil {
			// File doesn't exist, skip
			continue
		}
		
		// Only rotate if file has content (size > 0)
		if info.Size() == 0 {
			continue
		}
		
		// Create new filename with timestamp
		newPath := fmt.Sprintf("%s.%s", oldPath, timestamp)
		
		// Rename file to archive it
		if err := os.Rename(oldPath, newPath); err != nil {
			log.Warn().
				Str("old_path", oldPath).
				Str("new_path", newPath).
				Err(err).
				Msg("Failed to rotate log file")
			continue
		}
		
		rotatedCount++
		log.Debug().
			Str("old_path", logFile).
			Str("new_path", filepath.Base(newPath)).
			Msg("Rotated log file")
	}
	
	if rotatedCount > 0 {
		log.Info().Int("count", rotatedCount).Msg("Rotated log files")
	}
	
	// Cleanup old archived logs (keep last 7 days)
	if err := cleanupOldLogs(logDir, 7); err != nil {
		log.Warn().Err(err).Msg("Failed to cleanup old logs")
		// Don't return error - cleanup failure shouldn't stop daemon
	}
	
	return nil
}

// cleanupOldLogs removes archived log files older than keepDays
func cleanupOldLogs(logDir string, keepDays int) error {
	cutoff := time.Now().AddDate(0, 0, -keepDays)
	
	// Find all archived log files (pattern: *.log.YYYY-MM-DD-HHMMSS)
	pattern := filepath.Join(logDir, "*.log.*")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return errors.Wrap(err, "failed to glob log files")
	}
	
	// Also check error logs (*.err.*)
	errPattern := filepath.Join(logDir, "*.err.*")
	errFiles, err := filepath.Glob(errPattern)
	if err != nil {
		return errors.Wrap(err, "failed to glob error log files")
	}
	
	files = append(files, errFiles...)
	
	deletedCount := 0
	for _, file := range files {
		info, err := os.Stat(file)
		if err != nil {
			log.Warn().Str("file", file).Err(err).Msg("Failed to stat log file")
			continue
		}
		
		// Delete if older than cutoff
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(file); err != nil {
				log.Warn().Str("file", file).Err(err).Msg("Failed to delete old log file")
				continue
			}
			
			deletedCount++
			log.Debug().
				Str("file", filepath.Base(file)).
				Str("age", time.Since(info.ModTime()).Round(24*time.Hour).String()).
				Msg("Deleted old log file")
		}
	}
	
	if deletedCount > 0 {
		log.Info().
			Int("count", deletedCount).
			Int("keep_days", keepDays).
			Msg("Cleaned up old log files")
	}
	
	return nil
}

