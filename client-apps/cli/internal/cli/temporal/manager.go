package temporal

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
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

	// TemporalLockFileName is the name of the lock file for Temporal
	TemporalLockFileName = "temporal.lock"
)

// Manager manages the Temporal CLI binary and dev server
type Manager struct {
	binPath    string      // Path to temporal binary (~/.stigmer/bin/temporal)
	dataDir    string      // Path to temporal data directory (~/.stigmer/temporal-data)
	version    string      // Temporal CLI version
	port       int         // Port for dev server
	logFile    string      // Path to log file
	pidFile    string      // Path to PID file (kept for debugging)
	lockFile   string      // Path to lock file (source of truth)
	lockFd     *os.File    // Lock file descriptor (held while Temporal runs)
	supervisor *Supervisor // Optional supervisor for auto-restart
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
	stigmerDir := filepath.Join(stigmerDataDir, "..")

	return &Manager{
		binPath:  filepath.Join(binDir, "temporal"),
		dataDir:  temporalDataDir,
		version:  version,
		port:     port,
		logFile:  filepath.Join(logsDir, "temporal.log"),
		pidFile:  filepath.Join(stigmerDir, TemporalPIDFileName),
		lockFile: filepath.Join(stigmerDir, TemporalLockFileName),
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
// This function is idempotent - if Temporal is already running and healthy,
// it will log success and return without error.
func (m *Manager) Start() error {
	// Full health check first: process alive, actually Temporal, port listening.
	if m.IsRunning() {
		log.Info().
			Str("address", m.GetAddress()).
			Str("ui_url", "http://localhost:8233").
			Msg("Temporal is already running and healthy - reusing existing instance")
		return nil
	}

	// If WE hold a stale lock (Temporal crashed while the daemon is still
	// alive), release it so the fresh start below can re-acquire cleanly.
	// This fixes macOS/BSD where flock is per-open-file-description: a new
	// fd in isLocked() would see our own lock and wrongly bail out.
	if m.lockFd != nil {
		log.Info().Msg("Releasing stale Temporal lock (process died while we held the lock)")
		m.releaseLock()
		_ = os.Remove(m.pidFile)
	}

	// Cleanup any stale processes before starting
	m.CleanupStaleProcesses()

	// Check if ANOTHER process holds the lock (external Temporal instance).
	if m.isLocked() {
		if m.isPortInUse() {
			log.Info().Msg("Temporal lock held by another process and port is active - reusing")
			return nil
		}
		log.Warn().Msg("Temporal lock held by another process but port is not active - cannot start")
		return errors.New("Temporal lock held by another process but service is not responding")
	}

	// Ensure binary is installed
	if err := m.EnsureInstalled(); err != nil {
		return err
	}

	// Acquire lock before starting Temporal
	if err := m.acquireLock(); err != nil {
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

	// Set up process group so we can kill all child processes
	setProcGroup(cmd)

	// Start process
	if err := cmd.Start(); err != nil {
		m.releaseLock()
		return errors.Wrap(err, "failed to start Temporal process")
	}

	// Write PID file with enhanced format (PID, command name, timestamp)
	// Note: PID file is kept for debugging, but lock file is the source of truth
	if err := m.writePIDFile(cmd.Process.Pid, "temporal"); err != nil {
		// Kill the process if we can't write PID file
		_ = cmd.Process.Kill()
		m.releaseLock()
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
		m.releaseLock()
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
		// No PID file - check if lock file is held
		if m.isLocked() {
			log.Warn().Msg("Lock file exists but PID file missing - releasing lock")
			m.releaseLock()
		}
		return errors.Wrap(err, "Temporal is not running")
	}

	// Send SIGTERM to entire process group for graceful shutdown
	if err := killGroup(pid, sigTERM); err != nil {
		m.releaseLock()
		return errors.Wrap(err, "failed to send SIGTERM to Temporal process group")
	}

	log.Info().Int("pid", pid).Msg("Sent SIGTERM to Temporal process group")

	// Wait for process to exit (up to 10 seconds)
	for i := 0; i < 20; i++ {
		if !m.IsRunning() {
			// Remove PID file and release lock
			_ = os.Remove(m.pidFile)
			m.releaseLock()
			log.Info().Msg("Temporal stopped successfully")
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	// Force kill entire process group if still running
	log.Warn().Msg("Temporal did not stop gracefully, force killing process group")
	if err := killGroup(pid, sigKILL); err != nil {
		// Check if process is already dead (common on macOS)
		if !m.IsRunning() {
			log.Info().Msg("Temporal process already terminated")
			_ = os.Remove(m.pidFile)
			m.releaseLock()
			return nil
		}
		m.releaseLock()
		return errors.Wrap(err, "failed to kill Temporal process group")
	}

	// Remove PID file and release lock
	_ = os.Remove(m.pidFile)
	m.releaseLock()
	return nil
}

// IsRunning checks if Temporal is running with multi-layer validation
func (m *Manager) IsRunning() bool {
	// Layer 1: Check if lock file is held (most reliable, source of truth)
	if !m.isLocked() {
		return false
	}

	// Layer 2: Check if PID file exists and read PID
	pid, err := m.getPID()
	if err != nil {
		log.Debug().Msg("Lock file held but PID file missing")
		return false
	}

	// Layer 3: Check if process exists and is alive
	if err := processAlive(pid); err != nil {
		log.Debug().Int("pid", pid).Msg("Lock file held but process not alive")
		return false
	}

	// Layer 4: Verify process is actually Temporal (not PID reuse)
	if !m.isActuallyTemporal(pid) {
		log.Debug().Int("pid", pid).Msg("Process exists but is not Temporal")
		return false
	}

	// Layer 5: Check if Temporal port is listening
	if !m.isPortInUse() {
		log.Debug().Int("pid", pid).Msg("Process is Temporal but port not listening")
		return false
	}

	// All checks passed - Temporal is genuinely running
	return true
}

// GetAddress returns the Temporal service address
func (m *Manager) GetAddress() string {
	return fmt.Sprintf("localhost:%d", m.port)
}

// GetPID returns the PID of the running Temporal process, or 0 if unavailable.
func (m *Manager) GetPID() int {
	pid, err := m.getPID()
	if err != nil {
		return 0
	}
	return pid
}

// writePIDFile writes the enhanced PID file with metadata
func (m *Manager) writePIDFile(pid int, cmdName string) error {
	timestamp := time.Now().Unix()
	content := fmt.Sprintf("%d\n%s\n%d\n", pid, cmdName, timestamp)

	if err := os.WriteFile(m.pidFile, []byte(content), 0644); err != nil {
		return errors.Wrap(err, "failed to write PID file")
	}

	return nil
}

// getPID reads the PID from the PID file (supports both old and new formats)
func (m *Manager) getPID() (int, error) {
	file, err := os.Open(m.pidFile)
	if err != nil {
		return 0, errors.Wrap(err, "failed to open PID file")
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	if !scanner.Scan() {
		return 0, errors.New("PID file is empty")
	}

	pidStr := strings.TrimSpace(scanner.Text())
	pid, err := strconv.Atoi(pidStr)
	if err != nil {
		return 0, errors.Wrap(err, "invalid PID in PID file")
	}

	return pid, nil
}

// isActuallyTemporal verifies that the given PID is actually running Temporal
func (m *Manager) isActuallyTemporal(pid int) bool {
	cmdName, err := processCommandName(pid)
	if err != nil {
		log.Debug().Err(err).Int("pid", pid).Msg("Failed to get process command")
		return false
	}

	if !strings.Contains(strings.ToLower(cmdName), "temporal") {
		log.Debug().
			Int("pid", pid).
			Str("command", cmdName).
			Msg("Process is not Temporal (command name mismatch)")
		return false
	}

	fullCmd, err := processFullCommand(pid)
	if err == nil {
		if strings.Contains(fullCmd, m.binPath) ||
			(strings.Contains(fullCmd, "temporal") && strings.Contains(fullCmd, "server")) {
			return true
		}

		log.Debug().
			Int("pid", pid).
			Str("command", fullCmd).
			Msg("Process command doesn't match expected Temporal binary")
		return false
	}

	return true
}

// isPortInUse checks if the Temporal port is actually in use
func (m *Manager) isPortInUse() bool {
	conn, err := net.DialTimeout("tcp", m.GetAddress(), 100*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
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

// CleanupStaleProcesses removes stale PID files and kills orphaned processes.
// Handles two scenarios:
//  1. PID file exists but process is dead or not Temporal -> remove PID file.
//  2. PID file is missing but port is occupied -> find and kill the orphan via lsof.
func (m *Manager) CleanupStaleProcesses() {
	// Scenario 1: PID file exists
	pid, err := m.getPID()
	if err == nil {
		m.cleanupByPID(pid)
		return
	}

	// Scenario 2: No PID file -- check if something is using our port anyway.
	// This covers the case where `stigmer server reset` removed the PID file
	// without killing the Temporal process.
	m.cleanupByPort()
}

// cleanupByPID handles the case where a PID file exists.
func (m *Manager) cleanupByPID(pid int) {
	if err := processAlive(pid); err != nil {
		log.Debug().Int("pid", pid).Msg("Removing stale PID file (process not alive)")
		_ = os.Remove(m.pidFile)
		return
	}

	if !m.isActuallyTemporal(pid) {
		log.Warn().Int("pid", pid).Msg("Process exists but is not Temporal (PID reuse detected) - removing stale PID file")
		_ = os.Remove(m.pidFile)
		return
	}

	if !m.isPortInUse() {
		log.Warn().Int("pid", pid).Msg("Temporal process exists but port not listening - killing stale process")
		_ = killGroup(pid, sigKILL)
		_ = os.Remove(m.pidFile)
		return
	}

	log.Debug().Int("pid", pid).Msg("Found valid running Temporal instance")
}

// cleanupByPort finds and kills whatever process is occupying the managed
// Temporal port when no PID file is available. Uses lsof to resolve the PID.
func (m *Manager) cleanupByPort() {
	if !m.isPortInUse() {
		return
	}

	log.Warn().Int("port", m.port).Msg("Temporal port occupied but no PID file -- attempting port-based cleanup")

	pid := m.findPIDOnPort()
	if pid == 0 {
		log.Warn().Int("port", m.port).Msg("Could not determine PID holding Temporal port")
		return
	}

	if !m.isActuallyTemporal(pid) {
		log.Warn().Int("pid", pid).Int("port", m.port).
			Msg("Process on Temporal port is not Temporal -- skipping kill to avoid collateral damage")
		return
	}

	log.Warn().Int("pid", pid).Int("port", m.port).Msg("Killing orphaned Temporal process found via port")
	_ = killGroup(pid, sigTERM)
	time.Sleep(500 * time.Millisecond)

	if m.isPortInUse() {
		log.Warn().Int("pid", pid).Msg("Temporal did not exit after SIGTERM, sending SIGKILL")
		_ = killGroup(pid, sigKILL)
		time.Sleep(500 * time.Millisecond)
	}
}

// findPIDOnPort returns the PID of the process listening on the Temporal port,
// or 0 if it cannot be determined.
func (m *Manager) findPIDOnPort() int {
	return findListeningPID(m.port)
}

// acquireLock attempts to acquire an exclusive lock on the lock file.
// Returns nil on success, error if lock is already held by another process.
func (m *Manager) acquireLock() error {
	fd, err := os.OpenFile(m.lockFile, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to open lock file")
	}

	err = flockAcquire(fd)
	if err != nil {
		fd.Close()
		if isLockBusy(err) {
			return errors.New("Temporal is already running (lock file held by another process)")
		}
		return errors.Wrap(err, "failed to acquire lock")
	}

	m.lockFd = fd
	log.Debug().Str("lock_file", m.lockFile).Msg("Acquired lock file")
	return nil
}

// releaseLock releases the lock file.
func (m *Manager) releaseLock() {
	if m.lockFd == nil {
		return
	}

	_ = flockRelease(m.lockFd)
	_ = m.lockFd.Close()
	m.lockFd = nil

	log.Debug().Str("lock_file", m.lockFile).Msg("Released lock file")
}

// isLocked checks if the lock file is currently held by another process.
func (m *Manager) isLocked() bool {
	fd, err := os.OpenFile(m.lockFile, os.O_CREATE|os.O_RDWR, 0644)
	if err != nil {
		return false
	}
	defer fd.Close()

	err = flockAcquire(fd)
	if err != nil {
		return true
	}

	_ = flockRelease(fd)
	return false
}

// StartSupervisor starts monitoring Temporal and auto-restarting on failure
func (m *Manager) StartSupervisor() {
	if m.supervisor != nil {
		log.Warn().Msg("Supervisor already running")
		return
	}

	m.supervisor = NewSupervisor(m)
	m.supervisor.Start()
}

// StopSupervisor stops the supervisor gracefully
func (m *Manager) StopSupervisor() {
	if m.supervisor == nil {
		return
	}

	m.supervisor.Stop()
	m.supervisor = nil
}
