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
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/embedded"
	"github.com/stigmer/stigmer/client-apps/cli/embedded/agentrunner"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/llm"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/seedpackbootstrap"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/temporal"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
	orgv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/tenancy/organization/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/types/known/emptypb"
)

const (
	// DaemonPort is the port stigmer-server listens on.
	DaemonPort = 7234

	// WebConsolePort is the port the embedded web console is served on.
	// Follows the 7xxx=API, 8xxx=UI convention (Temporal UI is on 8233).
	WebConsolePort = 8234

	// PIDFileName stores the daemon process's own PID.
	PIDFileName = "daemon.pid"

	// WorkflowRunnerPIDFileName stores the workflow-runner PID.
	WorkflowRunnerPIDFileName = "workflow-runner.pid"

	// RunnerPIDFileName stores the agent-runner PID.
	RunnerPIDFileName = "agent-runner.pid"
)

// StartOptions provides options for starting the daemon.
type StartOptions struct {
	Progress         *cliprint.ProgressDisplay
	ExecutionMode    string
	SandboxImage     string
	SandboxAutoPull  bool
	SandboxCleanup   bool
	SandboxTTL       int
	NoWeb            bool
	Secrets          map[string]string
	OnLLMSetupFailed func(err error)

	// ServerOnly starts only the control plane (Temporal + stigmer-server +
	// web console) without workflow-runner or agent-runner. This is the
	// foundation for `stigmer up server` which starts the control plane
	// independently of any runners.
	ServerOnly bool
}

// Start starts the stigmer daemon in the background.
func Start(dataDir string) error {
	return StartWithOptions(dataDir, StartOptions{})
}

// StartWithOptions performs interactive setup in the foreground (config loading,
// secret gathering, Temporal start, Python runtime bootstrap) and then spawns
// the long-lived daemon process (`stigmer internal-daemon`) which starts and
// monitors all child components.
func StartWithOptions(dataDir string, opts StartOptions) error {
	log.Debug().Str("data_dir", dataDir).Msg("Starting daemon")

	cleanupOrphanedProcesses(dataDir)

	if IsRunning(dataDir) {
		return errors.New("daemon is already running")
	}

	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInitializing, "Setting up data directory")
	}
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create data directory")
	}

	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInitializing, "Extracting binaries")
	}
	if err := embedded.EnsureBinariesExtracted(dataDir); err != nil {
		return errors.Wrap(err, "failed to extract embedded binaries")
	}

	if err := rotateLogsIfNeeded(dataDir); err != nil {
		log.Warn().Err(err).Msg("Failed to rotate logs, continuing anyway")
	}

	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInitializing, "Loading configuration")
	}
	cfg, err := config.Load()
	if err != nil {
		log.Warn().Err(err).Msg("Failed to load config, using defaults")
		cfg = config.GetDefault()
	}

	llmProvider := cfg.Backend.Local.ResolveLLMProvider()
	llmModel := cfg.Backend.Local.ResolveLLMModel()
	llmBaseURL := cfg.Backend.Local.ResolveLLMBaseURL()

	log.Debug().
		Str("llm_provider", llmProvider).
		Str("llm_model", llmModel).
		Str("llm_base_url", llmBaseURL).
		Msg("Resolved LLM configuration")

	var secrets map[string]string
	if opts.Secrets != nil {
		secrets = opts.Secrets
	} else {
		if opts.Progress != nil {
			opts.Progress.SetPhase(cliprint.PhaseInitializing, "Gathering credentials")
		}
		var err error
		secrets, err = GatherRequiredSecrets(llmProvider, cfg.Backend.Local)
		if err != nil {
			return errors.Wrap(err, "failed to gather required secrets")
		}
	}

	// --- Phase 2: Installing ---
	// Operations that download/install external dependencies.
	// Slow on first run, fast or no-op on subsequent runs.

	if llmProvider == "ollama" {
		if opts.Progress != nil {
			opts.Progress.SetPhase(cliprint.PhaseInstalling, "Setting up local LLM")
		}

		llmOpts := &llm.SetupOptions{
			Progress: opts.Progress,
			Model:    llmModel,
			Provider: llmProvider,
		}

		if err := llm.Setup(context.Background(), cfg.Backend.Local, llmOpts); err != nil {
			log.Warn().Err(err).Msg("Ollama setup failed, continuing without local LLM")
			if opts.OnLLMSetupFailed != nil {
				opts.OnLLMSetupFailed(err)
			}
		}
	} else if llmProvider == "" {
		log.Info().Msg("No LLM provider configured, skipping LLM setup")
	}

	temporalAddr, isManaged := cfg.Backend.Local.ResolveTemporalAddress()

	log.Debug().
		Str("temporal_address", temporalAddr).
		Bool("temporal_managed", isManaged).
		Msg("Resolved Temporal configuration")

	if isManaged {
		if opts.Progress != nil {
			opts.Progress.SetPhase(cliprint.PhaseInstalling, "Setting up Temporal")
		}
		log.Info().Msg("Setting up managed Temporal...")

		tm := temporal.NewManager(
			dataDir,
			cfg.Backend.Local.ResolveTemporalVersion(),
			cfg.Backend.Local.ResolveTemporalPort(),
		)

		if err := tm.EnsureInstalled(); err != nil {
			return errors.Wrap(err, "failed to ensure Temporal installation")
		}
	} else {
		log.Info().Str("address", temporalAddr).Msg("Using external Temporal")
	}

	// Bootstrap the native Python runtime for agent-runner.
	// This runs in the foreground so the user sees progress.
	// Independent of Temporal — only needs configDir and embedded source.
	// Skipped in server-only mode where no runners are started.
	var pythonBin, appDir string

	if !opts.ServerOnly {
		if opts.Progress != nil {
			opts.Progress.SetPhase(cliprint.PhaseInstalling, "Bootstrapping Python runtime")
		}

		if !agentrunner.IsAvailable() {
			return errors.New("agent-runner Python runtime is not bundled in this binary. " +
				"If you are using the desktop app, update to the latest version. " +
				"If building from source, run sync.sh and build with -tags embed_agentrunner")
		}

		pythonBin, appDir, err = bootstrapRunnerRuntime()
		if err != nil {
			return errors.Wrap(err, "failed to bootstrap agent-runner runtime")
		}
	}

	// --- Phase 3: Starting ---
	// Spawn the daemon process. The daemon itself starts and supervises
	// Temporal (if managed) along with all other child components.

	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseStarting, "Launching Stigmer server")
	}
	cliBin, err := os.Executable()
	if err != nil {
		return errors.Wrap(err, "failed to get CLI executable path")
	}

	log.Debug().Str("binary", cliBin).Msg("Starting daemon process")

	execMode := opts.ExecutionMode
	if execMode == "" {
		execMode = cfg.Backend.Local.ResolveExecutionMode()
	}
	sbImage := opts.SandboxImage
	if sbImage == "" {
		sbImage = cfg.Backend.Local.ResolveSandboxImage()
	}

	logDir := filepath.Join(dataDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create log directory")
	}

	// Build environment for the daemon process.
	// The daemon reads these to start all child components.
	env := append(os.Environ(),
		fmt.Sprintf("STIGMER_DATA_DIR=%s", dataDir),
		fmt.Sprintf("STIGMER_LOG_DIR=%s", logDir),
		fmt.Sprintf("GRPC_PORT=%d", DaemonPort),
		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", temporalAddr),
		fmt.Sprintf("STIGMER_TEMPORAL_MANAGED=%t", isManaged),
		fmt.Sprintf("STIGMER_LLM_PROVIDER=%s", llmProvider),
		fmt.Sprintf("STIGMER_LLM_MODEL=%s", llmModel),
		fmt.Sprintf("STIGMER_LLM_BASE_URL=%s", llmBaseURL),
		fmt.Sprintf("STIGMER_EXECUTION_MODE=%s", execMode),
		fmt.Sprintf("STIGMER_SANDBOX_IMAGE=%s", sbImage),
		fmt.Sprintf("STIGMER_SANDBOX_AUTO_PULL=%t", opts.SandboxAutoPull),
		fmt.Sprintf("STIGMER_SANDBOX_CLEANUP=%t", opts.SandboxCleanup),
		fmt.Sprintf("STIGMER_SANDBOX_TTL=%d", opts.SandboxTTL),
	)

	if !opts.ServerOnly {
		env = append(env,
			fmt.Sprintf("STIGMER_AGENT_RUNNER_PYTHON_BIN=%s", pythonBin),
			fmt.Sprintf("STIGMER_AGENT_RUNNER_APP_DIR=%s", appDir),
		)
	}

	if opts.ServerOnly {
		env = append(env, "STIGMER_SERVER_ONLY=true")
	}

	if opts.NoWeb {
		env = append(env, "STIGMER_NO_WEB=1")
	}

	for key, value := range secrets {
		env = append(env, fmt.Sprintf("%s=%s", key, value))
	}

	// Spawn the long-lived daemon process.
	cmd := exec.Command(cliBin, "internal-daemon")
	cmd.Env = env

	daemonLogFile := filepath.Join(logDir, "daemon.log")
	daemonLog, err := os.OpenFile(daemonLogFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to create daemon log file")
	}
	defer daemonLog.Close()

	cmd.Stdout = daemonLog
	cmd.Stderr = daemonLog

	if err := cmd.Start(); err != nil {
		return errors.Wrap(err, "failed to start daemon process")
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Int("port", DaemonPort).
		Str("data_dir", dataDir).
		Msg("Daemon process started")

	// Wait briefly for the daemon to write its PID and start components
	time.Sleep(3 * time.Second)

	if !isProcessAlive(cmd.Process.Pid) {
		return errors.New("daemon process crashed during startup — check logs/daemon.log")
	}

	startupCfg := &StartupConfig{
		DataDir:          dataDir,
		LogDir:           logDir,
		TemporalAddr:     temporalAddr,
		LLMProvider:      llmProvider,
		LLMModel:         llmModel,
		LLMBaseURL:       llmBaseURL,
		ExecutionMode:    execMode,
		SandboxImage:     sbImage,
		SandboxAutoPull:  opts.SandboxAutoPull,
		SandboxCleanup:   opts.SandboxCleanup,
		SandboxTTL:       opts.SandboxTTL,
		StigmerServerPID: cmd.Process.Pid,
		ServerOnly:       opts.ServerOnly,
	}
	if err := saveStartupConfig(startupCfg); err != nil {
		log.Warn().Err(err).Msg("Failed to save startup config")
	}

	return nil
}

// isProcessAlive checks if a process with given PID is actually running.
func isProcessAlive(pid int) bool {
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = process.Signal(syscall.Signal(0))
	return err == nil
}

// cleanupOrphanedProcesses kills any orphaned processes from previous daemon runs.
func cleanupOrphanedProcesses(dataDir string) {
	log.Debug().Msg("Checking for orphaned processes from previous runs")

	pidFiles := map[string]string{
		"daemon":          filepath.Join(dataDir, PIDFileName),
		"stigmer-server":  filepath.Join(dataDir, StigmerServerPIDFileName),
		"workflow-runner": filepath.Join(dataDir, WorkflowRunnerPIDFileName),
		"agent-runner":    filepath.Join(dataDir, RunnerPIDFileName),
	}

	orphansFound := false

	for name, pidFile := range pidFiles {
		data, err := os.ReadFile(pidFile)
		if err != nil {
			continue
		}

		pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
		if err != nil {
			log.Warn().Str("component", name).Str("pid_file", pidFile).Msg("Invalid PID file, removing")
			_ = os.Remove(pidFile)
			continue
		}

		if isProcessAlive(pid) {
			orphansFound = true
			log.Warn().Str("component", name).Int("pid", pid).Msg("Found orphaned process, killing")

			process, _ := os.FindProcess(pid)
			_ = process.Signal(syscall.SIGTERM)
			time.Sleep(500 * time.Millisecond)

			if isProcessAlive(pid) {
				log.Warn().Str("component", name).Int("pid", pid).Msg("Process didn't stop gracefully, force killing")
				_ = process.Kill()
				time.Sleep(500 * time.Millisecond)
			}
		}

		_ = os.Remove(pidFile)
	}

	// Check for orphaned Temporal (if managed)
	cfg, err := config.Load()
	if err == nil && (cfg.Backend.Local.Temporal == nil || cfg.Backend.Local.Temporal.Managed) {
		temporalManager := temporal.NewManager(
			dataDir,
			cfg.Backend.Local.ResolveTemporalVersion(),
			cfg.Backend.Local.ResolveTemporalPort(),
		)
		temporalManager.CleanupStaleProcesses()
	}

	if orphansFound {
		log.Info().Msg("Cleaned up orphaned processes from previous run")
	} else {
		log.Debug().Msg("No orphaned processes found")
	}
}

// Stop stops the daemon process, which gracefully stops all children and
// managed Temporal as part of its own shutdown sequence.
func Stop(dataDir string) error {
	log.Debug().Str("data_dir", dataDir).Msg("Stopping daemon")

	// Read daemon PID
	pid, err := getPID(dataDir)
	if err != nil {
		log.Warn().Msg("PID file not found, searching for process by port")
		pid, err = findProcessByPort(DaemonPort)
		if err != nil {
			// Daemon is gone -- clean up Temporal as a safety net.
			stopManagedTemporal(dataDir)
			return errors.Wrap(err, "daemon is not running (no PID file and no process on port)")
		}
		log.Info().Int("pid", pid).Msg("Found orphaned daemon process by port")
	}

	if !isProcessAlive(pid) {
		log.Debug().Int("pid", pid).Msg("Daemon not running (stale PID file)")
		_ = os.Remove(filepath.Join(dataDir, PIDFileName))
		stopManagedTemporal(dataDir)
		return errors.New("daemon is not running")
	}

	process, _ := os.FindProcess(pid)

	// The daemon process catches SIGTERM and gracefully stops all children
	// including managed Temporal.
	if err := process.Signal(syscall.SIGTERM); err != nil {
		return errors.Wrap(err, "failed to send SIGTERM to daemon")
	}

	log.Info().Int("pid", pid).Msg("Sent SIGTERM to daemon")

	// Allow more time since the daemon stops children + Temporal sequentially.
	for i := 0; i < 30; i++ {
		if !isProcessAlive(pid) {
			_ = os.Remove(filepath.Join(dataDir, PIDFileName))
			removeStartupConfig(dataDir)
			log.Info().Msg("Daemon stopped successfully")
			return nil
		}
		time.Sleep(500 * time.Millisecond)
	}

	log.Warn().Msg("Daemon did not stop gracefully, force killing")
	_ = process.Kill()

	_ = os.Remove(filepath.Join(dataDir, PIDFileName))
	removeStartupConfig(dataDir)

	// Safety net: clean up any children or Temporal that survived.
	stopManagedTemporal(dataDir)
	cleanupOrphanedProcesses(dataDir)

	return nil
}

// stopManagedTemporal stops managed Temporal if it's running.
func stopManagedTemporal(dataDir string) {
	cfg, err := config.Load()
	if err != nil {
		log.Debug().Err(err).Msg("Failed to load config, using defaults for Temporal stop")
		cfg = config.GetDefault()
	}

	if cfg.Backend.Local.Temporal != nil && !cfg.Backend.Local.Temporal.Managed {
		return
	}

	tm := temporal.NewManager(
		dataDir,
		cfg.Backend.Local.ResolveTemporalVersion(),
		cfg.Backend.Local.ResolveTemporalPort(),
	)

	log.Info().Msg("Stopping managed Temporal...")
	if err := tm.Stop(); err != nil {
		log.Debug().Err(err).Msg("PID-based Temporal stop failed (may not be running or PID file missing)")
	} else {
		log.Info().Msg("Temporal stopped successfully")
		return
	}

	tm.CleanupStaleProcesses()
}

// IsRunning checks if the daemon is running.
func IsRunning(dataDir string) bool {
	pid, err := getPID(dataDir)
	if err == nil {
		process, err := os.FindProcess(pid)
		if err == nil {
			if process.Signal(syscall.Signal(0)) == nil {
				log.Debug().Int("pid", pid).Msg("Daemon is running (verified via PID file)")
				return true
			}
		}
		log.Warn().Int("pid", pid).Msg("Stale PID file found, cleaning up")
		_ = os.Remove(filepath.Join(dataDir, PIDFileName))
	}

	// Fallback: try to connect to the gRPC port
	endpoint := fmt.Sprintf("localhost:%d", DaemonPort)
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
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

	log.Warn().
		Str("endpoint", endpoint).
		Msg("Daemon is running but PID file is missing - this may cause issues with 'stigmer server stop'")
	return true
}

// EnsureRunning ensures the daemon is running, starting it if necessary.
func EnsureRunning(dataDir string) error {
	if IsRunning(dataDir) {
		log.Debug().Msg("Daemon is already running")
		if err := EnsureSeedpackBootstrapped(dataDir); err != nil {
			return err
		}
		EnsureOrgContext()
		return nil
	}

	climsg.Info("🚀 Starting local backend daemon...")
	climsg.Info("   This may take a moment on first run")
	fmt.Fprintln(os.Stderr)

	progress := cliprint.NewProgressDisplay()
	progress.Start()
	defer progress.Stop()

	if err := StartWithOptions(dataDir, StartOptions{Progress: progress}); err != nil {
		return errors.Wrap(err, "failed to start daemon")
	}

	climsg.Success("✓ Daemon started successfully")
	fmt.Fprintln(os.Stderr)

	if err := EnsureSeedpackBootstrapped(dataDir); err != nil {
		return err
	}
	EnsureOrgContext()
	return nil
}

// EnsureSeedpackBootstrapped applies the embedded seedpack content if the
// current binary's seedpack differs from the last-applied version.
//
// Delegates to seedpackbootstrap.Apply with the daemon's data directory
// as the marker location for idempotency.
func EnsureSeedpackBootstrapped(dataDir string) error {
	_, err := seedpackbootstrap.Apply(seedpackbootstrap.Options{
		MarkerDir: dataDir,
		Verbose:   zerolog.GlobalLevel() <= zerolog.DebugLevel,
	})
	return err
}

// EnsureOrgContext checks whether the CLI has an active organization context
// and auto-sets it when exactly one organization exists on the server. This is
// idempotent: if context.organization is already set, it returns immediately.
func EnsureOrgContext() {
	cfg, err := config.Load()
	if err != nil {
		log.Debug().Err(err).Msg("Skipping org context auto-detection: failed to load config")
		return
	}

	if cfg.ResolveContextOrganization() != "" {
		return
	}

	endpoint := fmt.Sprintf("localhost:%d", DaemonPort)
	conn, err := grpc.NewClient(endpoint, grpc.WithTransportCredentials(insecure.NewCredentials()))
	if err != nil {
		log.Debug().Err(err).Msg("Skipping org context auto-detection: failed to connect")
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client := orgv1.NewOrganizationQueryControllerClient(conn)
	resp, err := client.FindMyOrganizations(ctx, &emptypb.Empty{})
	if err != nil {
		log.Debug().Err(err).Msg("Skipping org context auto-detection: query failed")
		return
	}

	if len(resp.GetEntries()) == 1 {
		slug := resp.GetEntries()[0].GetMetadata().GetSlug()
		cfg.Context.Organization = slug
		if err := config.Save(cfg); err != nil {
			log.Warn().Err(err).Msg("Failed to save org context")
			return
		}
		log.Debug().Str("org", slug).Msg("Auto-set organization context")
	}
}

// GetStatus returns the daemon status.
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

// WaitForReady waits for the daemon to be ready to accept connections.
func WaitForReady(ctx context.Context, endpoint string) error {
	log.Debug().
		Str("endpoint", endpoint).
		Msg("Waiting for daemon to be ready")

	conn, err := grpc.DialContext(ctx, endpoint,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithBlock(),
	)
	if err != nil {
		return errors.Wrap(err, "daemon did not become ready in time")
	}
	conn.Close()

	log.Debug().Msg("Daemon is ready to accept connections")
	return nil
}

// getPID reads the PID from the PID file.
func getPID(dataDir string) (int, error) {
	pidFile := filepath.Join(dataDir, PIDFileName)

	data, err := os.ReadFile(pidFile)
	if err != nil {
		return 0, errors.Wrap(err, "failed to read PID file")
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, errors.Wrap(err, "invalid PID in PID file")
	}

	return pid, nil
}

// GetWorkflowRunnerPID reads the workflow-runner PID file.
func GetWorkflowRunnerPID(dataDir string) (int, error) {
	pidFile := filepath.Join(dataDir, WorkflowRunnerPIDFileName)

	data, err := os.ReadFile(pidFile)
	if err != nil {
		return 0, errors.Wrap(err, "failed to read workflow-runner PID file")
	}

	pid, err := strconv.Atoi(strings.TrimSpace(string(data)))
	if err != nil {
		return 0, errors.Wrap(err, "invalid PID in workflow-runner PID file")
	}

	return pid, nil
}

// findProcessByPort finds the PID of the process listening on the specified port.
func findProcessByPort(port int) (int, error) {
	cmd := exec.Command("lsof", "-t", "-i", fmt.Sprintf(":%d", port), "-sTCP:LISTEN")
	output, err := cmd.Output()
	if err != nil {
		return 0, errors.Wrap(err, "failed to find process on port")
	}

	pidStr := strings.TrimSpace(string(output))
	if pidStr == "" {
		return 0, errors.New("no process found listening on port")
	}

	lines := strings.Split(pidStr, "\n")
	pid, err := strconv.Atoi(strings.TrimSpace(lines[0]))
	if err != nil {
		return 0, errors.Wrap(err, "invalid PID from lsof output")
	}

	return pid, nil
}

// rotateLogsIfNeeded rotates existing log files by renaming them with timestamps.
func rotateLogsIfNeeded(dataDir string) error {
	logDir := filepath.Join(dataDir, "logs")

	if err := os.MkdirAll(logDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create log directory")
	}

	timestamp := time.Now().Format("2006-01-02-150405")

	logFiles := []string{
		"daemon.log",
		"stigmer-server.log",
		"stigmer-server.err",
		"agent-runner.log",
		"agent-runner.err",
		"workflow-runner.log",
		"workflow-runner.err",
		"temporal.log",
		"llm.log",
	}

	rotatedCount := 0
	for _, logFile := range logFiles {
		oldPath := filepath.Join(logDir, logFile)

		info, err := os.Stat(oldPath)
		if err != nil {
			continue
		}

		if info.Size() == 0 {
			continue
		}

		newPath := fmt.Sprintf("%s.%s", oldPath, timestamp)

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

	if err := cleanupOldLogs(logDir, 7); err != nil {
		log.Warn().Err(err).Msg("Failed to cleanup old logs")
	}

	return nil
}

// cleanupOldLogs removes archived log files older than keepDays.
func cleanupOldLogs(logDir string, keepDays int) error {
	cutoff := time.Now().AddDate(0, 0, -keepDays)

	pattern := filepath.Join(logDir, "*.log.*")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return errors.Wrap(err, "failed to glob log files")
	}

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
