package daemon

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
)

const (
	// DaemonPort is the port the daemon listens on (from ADR 011)
	DaemonPort = 50051

	// PIDFileName is the name of the PID file
	PIDFileName = "daemon.pid"
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

	return nil
}

// Stop stops the stigmer daemon
func Stop(dataDir string) error {
	log.Debug().Str("data_dir", dataDir).Msg("Stopping daemon")

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
