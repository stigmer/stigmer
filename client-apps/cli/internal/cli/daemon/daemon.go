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
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/temporal"
)

const (
	// DaemonPort is the port the daemon listens on (from ADR 011)
	DaemonPort = 50051

	// PIDFileName is the name of the PID file for stigmer-server
	PIDFileName = "daemon.pid"
	
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
	serverBin, err := findServerBinary()
	if err != nil {
		return err
	}

	log.Debug().Str("binary", serverBin).Msg("Found stigmer-server binary")

	// Start daemon process
	cmd := exec.Command(serverBin)
	cmd.Env = append(os.Environ(),
		fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
		fmt.Sprintf("STIGMER_PORT=%d", DaemonPort),
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
	runnerScript, err := findAgentRunnerScript()
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

// Stop stops the stigmer daemon, agent-runner, and managed Temporal
func Stop(dataDir string) error {
	log.Debug().Str("data_dir", dataDir).Msg("Stopping daemon")

	// Stop agent-runner first (if running)
	stopAgentRunner(dataDir)

	// Stop managed Temporal (if running)
	stopManagedTemporal(dataDir)

	// Stop stigmer-server
	pid, err := getPID(dataDir)
	if err != nil {
		return errors.Wrap(err, "daemon is not running")
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
			// Remove PID file
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

	// Remove PID file
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
	pid, err := getPID(dataDir)
	if err != nil {
		return false
	}

	// Check if process exists
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}

	// Send signal 0 to check if process is alive
	err = process.Signal(syscall.Signal(0))
	return err == nil
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
func WaitForReady(ctx context.Context, endpoint string) error {
	// TODO: Implement health check
	// For now, just wait a moment
	time.Sleep(1 * time.Second)
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

// findServerBinary finds the stigmer-server binary
//
// Search order:
// 1. STIGMER_SERVER_BIN environment variable
// 2. Same directory as CLI binary
// 3. Build output directories (for development)
// 4. Try to auto-build with Go if in development environment
func findServerBinary() (string, error) {
	// Check environment variable
	if bin := os.Getenv("STIGMER_SERVER_BIN"); bin != "" {
		if _, err := os.Stat(bin); err == nil {
			return bin, nil
		}
		log.Warn().Str("path", bin).Msg("STIGMER_SERVER_BIN set but file not found")
	}

	// Check same directory as CLI
	cliPath, err := os.Executable()
	if err == nil {
		serverBin := filepath.Join(filepath.Dir(cliPath), "stigmer-server")
		if _, err := os.Stat(serverBin); err == nil {
			log.Debug().Str("path", serverBin).Msg("Found stigmer-server in same directory as CLI")
			return serverBin, nil
		}
	}

	// Check common development paths
	possiblePaths := []string{
		"bin/stigmer-server",                                                  // make build-backend
		"bazel-bin/backend/services/stigmer-server/cmd/server/server_/server", // bazel build
		"./stigmer-server",                                                    // current directory
		"backend/services/stigmer-server/stigmer-server",                      // from workspace root
	}

	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			absPath, _ := filepath.Abs(path)
			log.Debug().Str("path", absPath).Msg("Found stigmer-server")
			return absPath, nil
		}
	}

	// Try to auto-build if we're in a development environment
	if workspaceRoot := findWorkspaceRoot(); workspaceRoot != "" {
		log.Info().Msg("stigmer-server not found, attempting to build it...")
		
		serverPath := filepath.Join(workspaceRoot, "bin", "stigmer-server")
		buildCmd := exec.Command("go", "build", "-o", serverPath, "./backend/services/stigmer-server/cmd/server")
		buildCmd.Dir = workspaceRoot
		
		if output, err := buildCmd.CombinedOutput(); err != nil {
			log.Error().
				Err(err).
				Str("output", string(output)).
				Msg("Failed to auto-build stigmer-server")
		} else {
			log.Info().Str("path", serverPath).Msg("Successfully built stigmer-server")
			return serverPath, nil
		}
	}

	return "", errors.New(`stigmer-server binary not found

Please build it first:
  make release-local    (recommended - builds and installs both CLI and server)
  
Or:
  go build -o ~/bin/stigmer-server ./backend/services/stigmer-server/cmd/server

Or set STIGMER_SERVER_BIN environment variable to point to the binary`)
}

// findAgentRunnerScript finds the agent-runner run script
//
// Search order:
// 1. STIGMER_AGENT_RUNNER_SCRIPT environment variable
// 2. Default location in workspace: backend/services/agent-runner/run.sh
func findAgentRunnerScript() (string, error) {
	// Check environment variable
	if script := os.Getenv("STIGMER_AGENT_RUNNER_SCRIPT"); script != "" {
		if _, err := os.Stat(script); err == nil {
			return script, nil
		}
		log.Warn().Str("path", script).Msg("STIGMER_AGENT_RUNNER_SCRIPT set but file not found")
	}

	// Try to find workspace root first
	workspaceRoot := findWorkspaceRoot()
	if workspaceRoot != "" {
		scriptPath := filepath.Join(workspaceRoot, "backend/services/agent-runner/run.sh")
		if _, err := os.Stat(scriptPath); err == nil {
			log.Debug().Str("path", scriptPath).Msg("Found agent-runner script")
			return scriptPath, nil
		}
	}

	// Fallback: Check relative paths
	possiblePaths := []string{
		"backend/services/agent-runner/run.sh",
		"./backend/services/agent-runner/run.sh",
		"../../../backend/services/agent-runner/run.sh", // if running from cli directory
	}

	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			absPath, _ := filepath.Abs(path)
			log.Debug().Str("path", absPath).Msg("Found agent-runner script")
			return absPath, nil
		}
	}

	return "", errors.New("agent-runner script not found (set STIGMER_AGENT_RUNNER_SCRIPT environment variable)")
}

// findWorkspaceRoot attempts to find the Stigmer workspace root
// by looking for characteristic files like go.mod, MODULE.bazel, etc.
func findWorkspaceRoot() string {
	// Start from current directory
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}

	// Walk up the directory tree looking for workspace markers
	for {
		// Check for Stigmer-specific markers
		markers := []string{
			"MODULE.bazel",
			filepath.Join("backend", "services", "stigmer-server"),
			filepath.Join("client-apps", "cli"),
		}

		allFound := true
		for _, marker := range markers {
			if _, err := os.Stat(filepath.Join(dir, marker)); err != nil {
				allFound = false
				break
			}
		}

		if allFound {
			return dir
		}

		// Move up one directory
		parent := filepath.Dir(dir)
		if parent == dir {
			// Reached root
			break
		}
		dir = parent
	}

	return ""
}
