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
	
	// AgentRunnerPIDFileName is the name of the PID file for agent-runner
	AgentRunnerPIDFileName = "agent-runner.pid"
)

// StartOptions provides options for starting the daemon
type StartOptions struct {
	Progress *cliprint.ProgressDisplay // Optional progress display for UI
}

// Start starts the stigmer daemon in the background
//
// The daemon runs stigmer-server on localhost:50051 as per ADR 011.
// It's a long-running process that manages:
// - gRPC API server
// - SQLite database
// - Workflow runner (embedded)
// - Agent runner (subprocess)
func Start(dataDir string) error {
	return StartWithOptions(dataDir, StartOptions{})
}

// StartWithOptions starts the daemon with custom options
func StartWithOptions(dataDir string, opts StartOptions) error {
	log.Debug().Str("data_dir", dataDir).Msg("Starting daemon")

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

	// Find stigmer-server binary
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseDeploying, "Starting Stigmer server")
	}
	serverBin, err := findServerBinary(dataDir)
	if err != nil {
		return err
	}

	log.Debug().Str("binary", serverBin).Msg("Found stigmer-server binary")

	// Start daemon process
	cmd := exec.Command(serverBin)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
		fmt.Sprintf("GRPC_PORT=%d", DaemonPort),
	)

	// Redirect output to log files
	logDir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create log directory")
	}

	stdoutLog := filepath.Join(logDir, "daemon.log")
	stderrLog := filepath.Join(logDir, "daemon.err")

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

	// Wait a moment for server to start
	time.Sleep(500 * time.Millisecond)

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
	// Find workflow-runner binary
	runnerBin, err := findWorkflowRunnerBinary(dataDir)
	if err != nil {
		return err
	}

	log.Debug().Str("binary", runnerBin).Msg("Found workflow-runner binary")

	// Prepare environment for Temporal worker mode
	env := os.Environ()
	env = append(env,
		// Execution mode: temporal worker only (no gRPC server)
		"EXECUTION_MODE=temporal",
		
		// Temporal configuration
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr),
		"TEMPORAL_NAMESPACE=default",
		"WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner",
		"ZIGFLOW_EXECUTION_TASK_QUEUE=zigflow_execution",
		"WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner",
		
		// Stigmer backend configuration (for callbacks)
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", DaemonPort),
		"STIGMER_API_KEY=dummy-local-key",
		"STIGMER_USE_TLS=false",
		
		"LOG_LEVEL=DEBUG",
		"ENV=local",
	)

	log.Info().
		Str("temporal_address", temporalAddr).
		Msg("Starting workflow-runner with configuration")

	// Start workflow-runner process
	cmd := exec.Command(runnerBin)
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
		Str("binary", runnerBin).
		Msg("Workflow-runner started successfully")

	return nil
}

// startAgentRunner starts the agent-runner subprocess with LLM config and injected secrets
func startAgentRunner(
	dataDir string,
	logDir string,
	llmProvider string,
	llmModel string,
	llmBaseURL string,
	temporalAddr string,
	secrets map[string]string,
) error {
	// Find agent-runner script
	runnerScript, err := findAgentRunnerScript(dataDir)
	if err != nil {
		return err
	}

	log.Debug().Str("script", runnerScript).Msg("Found agent-runner script")

	// Prepare environment with LLM and Temporal configuration
	env := os.Environ()
	
	// Add local mode configuration
	env = append(env,
		"MODE=local",
		"SANDBOX_TYPE=filesystem",
		"SANDBOX_ROOT_DIR=./workspace",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", DaemonPort),
		"STIGMER_API_KEY=dummy-local-key",
		
		// Temporal configuration
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr),
		"TEMPORAL_NAMESPACE=default",
		"TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner",
		
		// LLM configuration (matches agent-runner expectations)
		fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", llmProvider),
		fmt.Sprintf("STIGMER_LLM_MODEL=%s", llmModel),
		fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
		
		"LOG_LEVEL=DEBUG",
	)
	
	// Inject provider-specific secrets
	for key, value := range secrets {
		env = append(env, fmt.Sprintf("%s=%s", key, value))
	}
	
	log.Info().
		Str("llm_provider", llmProvider).
		Str("llm_model", llmModel).
		Str("temporal_address", temporalAddr).
		Msg("Starting agent-runner with configuration")

	// Start agent-runner process
	cmd := exec.Command(runnerScript)
	cmd.Env = env

	// Redirect output to separate log files
	stdoutLog := filepath.Join(logDir, "agent-runner.log")
	stderrLog := filepath.Join(logDir, "agent-runner.err")

	stdout, err := os.OpenFile(stdoutLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create agent-runner stdout log file")
	}
	defer stdout.Close()

	stderr, err := os.OpenFile(stderrLog, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create agent-runner stderr log file")
	}
	defer stderr.Close()

	cmd.Stdout = stdout
	cmd.Stderr = stderr

	// Start process
	if err := cmd.Start(); err != nil {
		return errors.Wrap(err, "failed to start agent-runner process")
	}

	// Write PID file
	pidFile := filepath.Join(dataDir, AgentRunnerPIDFileName)
	pidContent := fmt.Sprintf("%d", cmd.Process.Pid)
	if err := os.WriteFile(pidFile, []byte(pidContent), 0644); err != nil {
		// Kill the process if we can't write PID file
		_ = cmd.Process.Kill()
		return errors.Wrap(err, "failed to write agent-runner PID file")
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Str("script", runnerScript).
		Msg("Agent-runner started successfully")

	return nil
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

	// Find process
	process, err := os.FindProcess(pid)
	if err != nil {
		return errors.Wrap(err, "failed to find daemon process")
	}

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

	// Find process
	process, err := os.FindProcess(pid)
	if err != nil {
		log.Warn().Int("pid", pid).Msg("Failed to find workflow-runner process")
		_ = os.Remove(pidFile)
		return
	}

	// Send SIGTERM for graceful shutdown
	if err := process.Signal(syscall.SIGTERM); err != nil {
		log.Warn().Int("pid", pid).Err(err).Msg("Failed to send SIGTERM to workflow-runner")
		_ = os.Remove(pidFile)
		return
	}

	log.Info().Int("pid", pid).Msg("Sent SIGTERM to workflow-runner")

	// Wait for process to exit (up to 5 seconds)
	for i := 0; i < 10; i++ {
		if err := process.Signal(syscall.Signal(0)); err != nil {
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
	_ = os.Remove(pidFile)
}

// stopAgentRunner stops the agent-runner subprocess
func stopAgentRunner(dataDir string) {
	pidFile := filepath.Join(dataDir, AgentRunnerPIDFileName)
	
	// Read PID file
	data, err := os.ReadFile(pidFile)
	if err != nil {
		// No PID file means agent-runner is not running
		return
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		log.Warn().Str("pid_file", pidFile).Msg("Invalid agent-runner PID file")
		_ = os.Remove(pidFile)
		return
	}

	// Find process
	process, err := os.FindProcess(pid)
	if err != nil {
		log.Warn().Int("pid", pid).Msg("Failed to find agent-runner process")
		_ = os.Remove(pidFile)
		return
	}

	// Send SIGTERM for graceful shutdown
	if err := process.Signal(syscall.SIGTERM); err != nil {
		log.Warn().Int("pid", pid).Err(err).Msg("Failed to send SIGTERM to agent-runner")
		_ = os.Remove(pidFile)
		return
	}

	log.Info().Int("pid", pid).Msg("Sent SIGTERM to agent-runner")

	// Wait for process to exit (up to 5 seconds)
	for i := 0; i < 10; i++ {
		if err := process.Signal(syscall.Signal(0)); err != nil {
			// Process is dead
			_ = os.Remove(pidFile)
			log.Info().Msg("Agent-runner stopped successfully")
			return
		}
		time.Sleep(500 * time.Millisecond)
	}

	// Force kill if still running
	log.Warn().Msg("Agent-runner did not stop gracefully, force killing")
	_ = process.Kill()
	_ = os.Remove(pidFile)
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

	// Fallback: Try to connect and verify it's actually stigmer-server
	// This handles cases where the PID file is missing but server is actually running
	// We do a real gRPC call to ensure it's our server, not just any process on that port
	endpoint := fmt.Sprintf("localhost:%d", DaemonPort)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	
	conn, err := grpc.DialContext(ctx, endpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		log.Debug().Err(err).Msg("Daemon is not running (connection failed)")
		return false
	}
	defer conn.Close()

	// Successfully connected - stigmer-server is running (even without PID file)
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

	// Wait for daemon to be ready to accept connections
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	endpoint := fmt.Sprintf("localhost:%d", DaemonPort)
	if err := WaitForReady(ctx, endpoint); err != nil {
		return errors.Wrap(err, "daemon started but not responding")
	}

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
// This polls the gRPC server until it responds to a connection attempt,
// ensuring it's fully initialized before returning.
func WaitForReady(ctx context.Context, endpoint string) error {
	// Poll every 500ms until the server responds or context times out
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return errors.Wrap(ctx.Err(), "daemon did not become ready in time")
		case <-ticker.C:
			// Try to connect to the gRPC server
			dialCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			conn, err := grpc.DialContext(dialCtx, endpoint,
				grpc.WithTransportCredentials(insecure.NewCredentials()),
				grpc.WithBlock(),
			)
			cancel()

			if err != nil {
				// Server not ready yet, continue polling
				log.Debug().Err(err).Msg("Daemon not ready yet, retrying...")
				continue
			}

			// Successfully connected - server is ready
			conn.Close()
			log.Debug().Msg("Daemon is ready to accept connections")
			return nil
		}
	}
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

// findServerBinary finds the stigmer-server binary
//
// Production mode (default):
//   Uses extracted binary from dataDir/bin/stigmer-server
//
// Development mode (STIGMER_SERVER_BIN env var set):
//   Uses custom binary path from environment variable
func findServerBinary(dataDir string) (string, error) {
	// Dev mode: environment variable takes precedence
	if bin := os.Getenv("STIGMER_SERVER_BIN"); bin != "" {
		if _, err := os.Stat(bin); err == nil {
			log.Debug().Str("path", bin).Msg("Using stigmer-server from STIGMER_SERVER_BIN")
			return bin, nil
		}
		return "", errors.Errorf("STIGMER_SERVER_BIN set but file not found: %s", bin)
	}

	// Production mode: use extracted binary only
	binPath := filepath.Join(dataDir, "bin", "stigmer-server")
	if _, err := os.Stat(binPath); err == nil {
		log.Debug().Str("path", binPath).Msg("Using extracted stigmer-server binary")
		return binPath, nil
	}

	// Binary not found - this should not happen if extraction succeeded
	return "", errors.New(`stigmer-server binary not found

Expected location: ` + binPath + `

This usually means the Stigmer CLI installation is corrupted.

To fix this:
  brew reinstall stigmer    (if installed via Homebrew)
  
Or download and install the latest release:
  https://github.com/stigmer/stigmer/releases

For development, set STIGMER_SERVER_BIN environment variable:
  export STIGMER_SERVER_BIN=/path/to/stigmer-server`)
}

// findWorkflowRunnerBinary finds the workflow-runner binary
//
// Production mode (default):
//   Uses extracted binary from dataDir/bin/workflow-runner
//
// Development mode (STIGMER_WORKFLOW_RUNNER_BIN env var set):
//   Uses custom binary path from environment variable
func findWorkflowRunnerBinary(dataDir string) (string, error) {
	// Dev mode: environment variable takes precedence
	if bin := os.Getenv("STIGMER_WORKFLOW_RUNNER_BIN"); bin != "" {
		if _, err := os.Stat(bin); err == nil {
			log.Debug().Str("path", bin).Msg("Using workflow-runner from STIGMER_WORKFLOW_RUNNER_BIN")
			return bin, nil
		}
		return "", errors.Errorf("STIGMER_WORKFLOW_RUNNER_BIN set but file not found: %s", bin)
	}

	// Production mode: use extracted binary only
	binPath := filepath.Join(dataDir, "bin", "workflow-runner")
	if _, err := os.Stat(binPath); err == nil {
		log.Debug().Str("path", binPath).Msg("Using extracted workflow-runner binary")
		return binPath, nil
	}

	// Binary not found - this should not happen if extraction succeeded
	return "", errors.New(`workflow-runner binary not found

Expected location: ` + binPath + `

This usually means the Stigmer CLI installation is corrupted.

To fix this:
  brew reinstall stigmer    (if installed via Homebrew)
  
Or download and install the latest release:
  https://github.com/stigmer/stigmer/releases

For development, set STIGMER_WORKFLOW_RUNNER_BIN environment variable:
  export STIGMER_WORKFLOW_RUNNER_BIN=/path/to/workflow-runner`)
}

// findAgentRunnerScript finds the agent-runner run script
//
// Production mode (default):
//   Uses extracted script from dataDir/bin/agent-runner/run.sh
//
// Development mode (STIGMER_AGENT_RUNNER_SCRIPT env var set):
//   Uses custom script path from environment variable
func findAgentRunnerScript(dataDir string) (string, error) {
	// Dev mode: environment variable takes precedence
	if script := os.Getenv("STIGMER_AGENT_RUNNER_SCRIPT"); script != "" {
		if _, err := os.Stat(script); err == nil {
			log.Debug().Str("path", script).Msg("Using agent-runner script from STIGMER_AGENT_RUNNER_SCRIPT")
			return script, nil
		}
		return "", errors.Errorf("STIGMER_AGENT_RUNNER_SCRIPT set but file not found: %s", script)
	}

	// Production mode: use extracted script only
	scriptPath := filepath.Join(dataDir, "bin", "agent-runner", "run.sh")
	if _, err := os.Stat(scriptPath); err == nil {
		log.Debug().Str("path", scriptPath).Msg("Using extracted agent-runner script")
		return scriptPath, nil
	}

	// Script not found - this should not happen if extraction succeeded
	return "", errors.New(`agent-runner script not found

Expected location: ` + scriptPath + `

This usually means the Stigmer CLI installation is corrupted.

To fix this:
  brew reinstall stigmer    (if installed via Homebrew)
  
Or download and install the latest release:
  https://github.com/stigmer/stigmer/releases

For development, set STIGMER_AGENT_RUNNER_SCRIPT environment variable:
  export STIGMER_AGENT_RUNNER_SCRIPT=/path/to/agent-runner/run.sh`)
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
		"daemon.log",
		"daemon.err",
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

