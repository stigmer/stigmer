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
)

const (
	// DaemonPort is the port the daemon listens on (from ADR 011)
	DaemonPort = 50051

	// PIDFileName is the name of the PID file for stigmer-server
	PIDFileName = "daemon.pid"
	
	// AgentRunnerPIDFileName is the name of the PID file for agent-runner
	AgentRunnerPIDFileName = "agent-runner.pid"
)

// Start starts the stigmer daemon in the background
//
// The daemon runs stigmer-server on localhost:50051 as per ADR 011.
// It's a long-running process that manages:
// - gRPC API server
// - SQLite database
// - Workflow runner (embedded)
// - Agent runner (subprocess)
func Start(dataDir string) error {
	log.Debug().Str("data_dir", dataDir).Msg("Starting daemon")

	// Check if already running
	if IsRunning(dataDir) {
		return errors.New("daemon is already running")
	}

	// Ensure data directory exists
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create data directory")
	}

	// Gather required secrets (prompt for missing API keys)
	secrets, err := GatherRequiredSecrets()
	if err != nil {
		return errors.Wrap(err, "failed to gather required secrets")
	}

	// Find stigmer-server binary
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

	// Start agent-runner subprocess with injected secrets
	if err := startAgentRunner(dataDir, logDir, secrets); err != nil {
		log.Error().Err(err).Msg("Failed to start agent-runner, continuing without it")
		// Don't fail the entire daemon startup if agent-runner fails
		// The server is still useful without the agent-runner
	}

	return nil
}

// startAgentRunner starts the agent-runner subprocess with injected secrets
func startAgentRunner(dataDir string, logDir string, secrets map[string]string) error {
	// Find agent-runner script
	runnerScript, err := findAgentRunnerScript()
	if err != nil {
		return err
	}

	log.Debug().Str("script", runnerScript).Msg("Found agent-runner script")

	// Prepare environment with injected secrets
	env := os.Environ()
	
	// Add local mode configuration
	env = append(env,
		"MODE=local",
		"SANDBOX_TYPE=filesystem",
		"SANDBOX_ROOT_DIR=./workspace",
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=localhost:%d", DaemonPort),
		"STIGMER_API_KEY=dummy-local-key",
		"TEMPORAL_SERVICE_ADDRESS=localhost:7233",
		"TEMPORAL_NAMESPACE=default",
		"TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE=agent_execution_runner",
		"LOG_LEVEL=DEBUG",
	)
	
	// Inject gathered secrets
	for key, value := range secrets {
		env = append(env, fmt.Sprintf("%s=%s", key, value))
	}

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

// Stop stops the stigmer daemon and agent-runner
func Stop(dataDir string) error {
	log.Debug().Str("data_dir", dataDir).Msg("Stopping daemon")

	// Stop agent-runner first (if running)
	stopAgentRunner(dataDir)

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
func findServerBinary() (string, error) {
	// Check environment variable
	if bin := os.Getenv("STIGMER_SERVER_BIN"); bin != "" {
		if _, err := os.Stat(bin); err == nil {
			return bin, nil
		}
	}

	// Check same directory as CLI
	cliPath, err := os.Executable()
	if err == nil {
		serverBin := filepath.Join(filepath.Dir(cliPath), "stigmer-server")
		if _, err := os.Stat(serverBin); err == nil {
			return serverBin, nil
		}
	}

	// Check bazel-bin directory (development)
	possiblePaths := []string{
		"bazel-bin/backend/services/stigmer-server/cmd/server/server_/server",
		"./server", // if running from backend/services/stigmer-server
		"../backend/services/stigmer-server/server", // if running from cli
	}

	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			absPath, _ := filepath.Abs(path)
			return absPath, nil
		}
	}

	return "", errors.New("stigmer-server binary not found (set STIGMER_SERVER_BIN environment variable)")
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
	}

	// Check default location (from workspace root)
	possiblePaths := []string{
		"backend/services/agent-runner/run.sh",
		"./backend/services/agent-runner/run.sh",
		"../../../backend/services/agent-runner/run.sh", // if running from cli directory
	}

	for _, path := range possiblePaths {
		if _, err := os.Stat(path); err == nil {
			absPath, _ := filepath.Abs(path)
			return absPath, nil
		}
	}

	return "", errors.New("agent-runner script not found (set STIGMER_AGENT_RUNNER_SCRIPT environment variable)")
}
