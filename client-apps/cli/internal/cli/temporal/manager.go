package temporal

import (
	"fmt"
	"net"
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
	// DefaultTemporalVersion is the default Temporal CLI version
	DefaultTemporalVersion = "1.5.1"
	
	// DefaultTemporalPort is the default port for Temporal dev server
	DefaultTemporalPort = 7233
	
	// TemporalPIDFileName is the name of the PID file for Temporal
	TemporalPIDFileName = "temporal.pid"
)

// Manager manages the Temporal CLI binary and dev server
type Manager struct {
	binPath  string // Path to temporal binary (~/.stigmer/bin/temporal)
	dataDir  string // Path to temporal data directory (~/.stigmer/temporal-data)
	version  string // Temporal CLI version
	port     int    // Port for dev server
	logFile  string // Path to log file
	pidFile  string // Path to PID file
}

// NewManager creates a new Temporal manager
func NewManager(stigmerDataDir string, version string, port int) *Manager {
	if version == "" {
		version = DefaultTemporalVersion
	}
	if port == 0 {
		port = DefaultTemporalPort
	}
	
	binDir := filepath.Join(stigmerDataDir, "..", "bin")
	logsDir := filepath.Join(stigmerDataDir, "..", "logs")
	temporalDataDir := filepath.Join(stigmerDataDir, "..", "temporal-data")
	
	return &Manager{
		binPath:  filepath.Join(binDir, "temporal"),
		dataDir:  temporalDataDir,
		version:  version,
		port:     port,
		logFile:  filepath.Join(logsDir, "temporal.log"),
		pidFile:  filepath.Join(stigmerDataDir, "..", TemporalPIDFileName),
	}
}

// EnsureInstalled checks if Temporal CLI is installed, downloads if not
func (m *Manager) EnsureInstalled() error {
	// Check if binary already exists
	if _, err := os.Stat(m.binPath); err == nil {
		log.Debug().Str("path", m.binPath).Msg("Temporal CLI already installed")
		return nil
	}
	
	log.Info().Str("version", m.version).Msg("Downloading Temporal CLI")
	
	// Download the binary
	if err := m.downloadBinary(); err != nil {
		return errors.Wrap(err, "failed to download Temporal CLI")
	}
	
	log.Info().Str("path", m.binPath).Msg("Temporal CLI installed successfully")
	return nil
}

// Start starts the Temporal dev server as a background process
func (m *Manager) Start() error {
	// Check if already running
	if m.IsRunning() {
		return errors.New("Temporal is already running")
	}
	
	// Ensure binary is installed
	if err := m.EnsureInstalled(); err != nil {
		return err
	}
	
	// Ensure data directory exists
	if err := os.MkdirAll(m.dataDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create Temporal data directory")
	}
	
	// Ensure log directory exists
	logDir := filepath.Dir(m.logFile)
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create log directory")
	}
	
	// Prepare command
	dbPath := filepath.Join(m.dataDir, "temporal.db")
	cmd := exec.Command(m.binPath, "server", "start-dev",
		"--port", strconv.Itoa(m.port),
		"--db-filename", dbPath,
		"--ui-port", "8233", // Web UI port
	)
	
	// Redirect output to log file
	logFile, err := os.OpenFile(m.logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create log file")
	}
	defer logFile.Close()
	
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	
	// Start process
	if err := cmd.Start(); err != nil {
		return errors.Wrap(err, "failed to start Temporal process")
	}
	
	// Write PID file
	pidContent := fmt.Sprintf("%d", cmd.Process.Pid)
	if err := os.WriteFile(m.pidFile, []byte(pidContent), 0644); err != nil {
		// Kill the process if we can't write PID file
		_ = cmd.Process.Kill()
		return errors.Wrap(err, "failed to write Temporal PID file")
	}
	
	log.Info().
		Int("pid", cmd.Process.Pid).
		Int("port", m.port).
		Msg("Temporal dev server started")
	
	// Wait for Temporal to be ready
	if err := m.waitForReady(10 * time.Second); err != nil {
		_ = cmd.Process.Kill()
		_ = os.Remove(m.pidFile)
		return errors.Wrap(err, "Temporal failed to start")
	}
	
	log.Info().
		Str("address", m.GetAddress()).
		Str("ui_url", "http://localhost:8233").
		Msg("Temporal is ready")
	return nil
}

// Stop stops the Temporal dev server
func (m *Manager) Stop() error {
	pid, err := m.getPID()
	if err != nil {
		return errors.Wrap(err, "Temporal is not running")
	}
	
	// Find process
	process, err := os.FindProcess(pid)
	if err != nil {
		return errors.Wrap(err, "failed to find Temporal process")
	}
	
	// Send SIGTERM for graceful shutdown
	if err := process.Signal(syscall.SIGTERM); err != nil {
		return errors.Wrap(err, "failed to send SIGTERM to Temporal")
	}
	
	log.Info().Int("pid", pid).Msg("Sent SIGTERM to Temporal")
	
	// Wait for process to exit (up to 10 seconds)
	for i := 0; i < 20; i++ {
		if !m.IsRunning() {
			// Remove PID file
			_ = os.Remove(m.pidFile)
			log.Info().Msg("Temporal stopped successfully")
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	
	// Force kill if still running
	log.Warn().Msg("Temporal did not stop gracefully, force killing")
	if err := process.Kill(); err != nil {
		return errors.Wrap(err, "failed to kill Temporal process")
	}
	
	// Remove PID file
	_ = os.Remove(m.pidFile)
	return nil
}

// IsRunning checks if Temporal is running
func (m *Manager) IsRunning() bool {
	pid, err := m.getPID()
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

// GetAddress returns the Temporal service address
func (m *Manager) GetAddress() string {
	return fmt.Sprintf("localhost:%d", m.port)
}

// getPID reads the PID from the PID file
func (m *Manager) getPID() (int, error) {
	data, err := os.ReadFile(m.pidFile)
	if err != nil {
		return 0, errors.Wrap(err, "failed to read PID file")
	}
	
	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, errors.Wrap(err, "invalid PID in PID file")
	}
	
	return pid, nil
}

// waitForReady polls Temporal until it's accepting connections
func (m *Manager) waitForReady(timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", m.GetAddress(), 100*time.Millisecond)
		if err == nil {
			conn.Close()
			return nil // Temporal is ready
		}
		time.Sleep(100 * time.Millisecond)
	}
	
	return errors.New("Temporal failed to start within timeout")
}
