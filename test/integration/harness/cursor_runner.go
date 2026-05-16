package harness

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"time"
)

// CursorRunner manages the TypeScript cursor-runner as a child process.
type CursorRunner struct {
	cmd          *exec.Cmd
	logFile      *os.File
	logPath      string
	workspaceDir string
	logger       *slog.Logger
}

// LogPath returns the path to the cursor-runner log file.
func (r *CursorRunner) LogPath() string {
	return r.logPath
}

// WorkspaceDir returns the isolated workspace directory that the Cursor agent
// writes files into. Tests use this to assert file creation side effects.
func (r *CursorRunner) WorkspaceDir() string {
	return r.workspaceDir
}

// CursorRunnerConfig holds configuration for starting the cursor runner.
type CursorRunnerConfig struct {
	// StigmerServiceAddress is the gRPC address of the Java service.
	StigmerServiceAddress string

	// TemporalAddress is the Temporal server address.
	TemporalAddress string

	// LogDir is the directory for the runner log file.
	LogDir string

	// CursorAPIKey is the Cursor SDK API key.
	// Used as a fallback when ProxyEndpoint is not set.
	CursorAPIKey string

	// ProxyEndpoint is the HTTP address of the Java service's built-in
	// Cursor proxy (e.g. "http://127.0.0.1:8080"). When set, the runner's
	// fetch interceptor rewrites Cursor SDK requests to route through
	// the proxy. The proxy injects the API key server-side and records
	// per-call usage for billing.
	ProxyEndpoint string

	// WorkspaceDir is the directory the Cursor agent will use as its workspace.
	// If empty, a temporary directory is created.
	WorkspaceDir string
}

// StartCursorRunner locates the cursor-runner TypeScript service, ensures it is
// built, and starts it as a child process wired to the test Temporal and Java service.
func StartCursorRunner(ctx context.Context, cfg CursorRunnerConfig, logger *slog.Logger) (*CursorRunner, error) {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	runnerDir := findCursorRunnerDir()
	if runnerDir == "" {
		return nil, fmt.Errorf("cursor-runner source directory not found")
	}

	// Use tsx to run TypeScript source directly — the @stigmer/protos package
	// exports raw .ts files (dev mode), which Node.js cannot import natively.
	tsxBin := filepath.Join(runnerDir, "node_modules", ".bin", "tsx")
	if _, err := os.Stat(tsxBin); err != nil {
		return nil, fmt.Errorf("tsx not found at %s — run 'npm install' in cursor-runner", tsxBin)
	}

	entrypoint := filepath.Join(runnerDir, "src", "main.ts")

	workspaceDir := cfg.WorkspaceDir
	if workspaceDir == "" {
		var mkErr error
		workspaceDir, mkErr = os.MkdirTemp("", "stigmer-cursor-workspace-*")
		if mkErr != nil {
			return nil, fmt.Errorf("create workspace dir: %w", mkErr)
		}
	}

	logDir := cfg.LogDir
	if logDir == "" {
		var mkErr error
		logDir, mkErr = os.MkdirTemp("", "stigmer-cursor-runner-*")
		if mkErr != nil {
			return nil, fmt.Errorf("create log dir: %w", mkErr)
		}
	}
	logPath := filepath.Join(logDir, "cursor-runner.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	logger.Info("cursor-runner log", "path", logPath)

	// Use exec.Command (not CommandContext) so the runner process lifetime
	// is decoupled from the startup context and runs until Stop() is called.
	cmd := exec.Command(tsxBin, entrypoint)
	cmd.Dir = runnerDir
	cmd.Env = buildCursorRunnerEnv(cfg, workspaceDir)
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	logger.Info("starting cursor-runner",
		"tsx", tsxBin,
		"dir", runnerDir,
		"stigmer_endpoint", cfg.StigmerServiceAddress,
		"temporal", cfg.TemporalAddress,
		"workspace", workspaceDir,
	)

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start cursor-runner: %w", err)
	}

	time.Sleep(5 * time.Second)

	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		logFile.Sync()
		if logBytes, readErr := os.ReadFile(logPath); readErr == nil {
			lines := string(logBytes)
			if len(lines) > 2000 {
				lines = lines[len(lines)-2000:]
			}
			logger.Error("cursor-runner exited prematurely", "last_log", lines)
		}
		logFile.Close()
		return nil, fmt.Errorf("cursor-runner exited during startup")
	}

	logger.Info("cursor-runner started", "pid", cmd.Process.Pid)

	return &CursorRunner{
		cmd:          cmd,
		logFile:      logFile,
		logPath:      logPath,
		workspaceDir: workspaceDir,
		logger:       logger,
	}, nil
}

func (r *CursorRunner) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	r.logger.Info("stopping cursor-runner")
	err := r.cmd.Process.Kill()
	if r.logFile != nil {
		r.logFile.Close()
	}
	return err
}

func findCursorRunnerDir() string {
	candidates := []string{
		"../../../../backend/services/cursor-runner",
		"../../backend/services/cursor-runner",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		pkgJSON := filepath.Join(abs, "package.json")
		if _, err := os.Stat(pkgJSON); err == nil {
			return abs
		}
	}

	if envPath := os.Getenv("CURSOR_RUNNER_DIR"); envPath != "" {
		return envPath
	}

	return ""
}

func buildCursorRunnerEnv(cfg CursorRunnerConfig, workspaceDir string) []string {
	env := os.Environ()

	env = append(env,
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=http://%s", cfg.StigmerServiceAddress),
		"STIGMER_API_KEY=test-integration-key",

		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", cfg.TemporalAddress),
		"TEMPORAL_NAMESPACE=default",
		"STIGMER_TASK_QUEUE=agent_execution_runner",

		"MODE=local",

		fmt.Sprintf("WORKSPACE_ROOT_DIR=%s", workspaceDir),

		"LOG_LEVEL=INFO",

		// Propagated to MCP server subprocesses spawned by the runner.
		// Required by mcp-server-stigmer to connect back to the test Java service.
		fmt.Sprintf("STIGMER_SERVER_ADDRESS=%s", cfg.StigmerServiceAddress),
	)

	if cfg.ProxyEndpoint != "" {
		// Route Cursor SDK calls through the Java service's Cursor proxy.
		// The fetch interceptor (proxy/fetch-interceptor.ts) rewrites
		// outbound requests and the proxy injects the API key server-side.
		env = append(env,
			fmt.Sprintf("STIGMER_PROXY_ENDPOINT=%s", cfg.ProxyEndpoint),
			"STIGMER_TOKEN=test-integration-key",
		)
	} else if cfg.CursorAPIKey != "" {
		// Fallback: call Cursor directly (no billing records)
		env = append(env, fmt.Sprintf("CURSOR_API_KEY=%s", cfg.CursorAPIKey))
	}

	return env
}
