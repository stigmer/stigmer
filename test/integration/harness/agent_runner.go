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

// AgentRunner manages the Python agent-runner as a child process.
type AgentRunner struct {
	cmd     *exec.Cmd
	logFile *os.File
	logPath string
	logger  *slog.Logger
}

// LogPath returns the path to the agent-runner log file.
func (r *AgentRunner) LogPath() string {
	return r.logPath
}

// AgentRunnerConfig holds configuration for starting the agent runner.
type AgentRunnerConfig struct {
	// StigmerServiceAddress is the gRPC address of the Java service.
	StigmerServiceAddress string

	// TemporalAddress is the Temporal server address.
	TemporalAddress string

	// LogDir is the directory for the runner log file.
	LogDir string

	// AnthropicAPIKey is the Anthropic API key for LLM calls.
	// Used as a fallback when ProxyEndpoint is not set.
	AnthropicAPIKey string

	// ProxyEndpoint is the HTTP address of the Java service's built-in
	// LLM proxy (e.g. "http://127.0.0.1:8080"). When set, the runner
	// routes LLM calls through the proxy instead of calling providers
	// directly. The proxy records LlmCallUsageRecord for billing.
	ProxyEndpoint string

	// MinIO R2-compatible storage config. When set, the runner uses R2
	// storage directly for attachment downloads instead of the proxy
	// presigned URL flow (which requires endpoints not available in
	// test environments).
	R2Endpoint  string
	R2AccessKey string
	R2SecretKey string
	R2Bucket    string

	// OTLPEndpoint sets OTEL_EXPORTER_OTLP_ENDPOINT for distributed tracing.
	// When set, the agent-runner exports spans to this OTLP/gRPC receiver.
	OTLPEndpoint string
}

// StartAgentRunner locates the agent-runner Python service, verifies a virtualenv
// exists, and starts it as a child process wired to the test Temporal and Java service.
func StartAgentRunner(ctx context.Context, cfg AgentRunnerConfig, logger *slog.Logger) (*AgentRunner, error) {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	runnerDir := findAgentRunnerDir()
	if runnerDir == "" {
		return nil, fmt.Errorf("agent-runner source directory not found")
	}

	pythonBin := findPython(runnerDir)
	if pythonBin == "" {
		return nil, fmt.Errorf("python3 not found (checked %s/.venv/bin/python and PATH)", runnerDir)
	}

	mainPy := filepath.Join(runnerDir, "main.py")
	if _, err := os.Stat(mainPy); err != nil {
		return nil, fmt.Errorf("agent-runner main.py not found at %s", mainPy)
	}

	logDir := cfg.LogDir
	if logDir == "" {
		var mkErr error
		logDir, mkErr = os.MkdirTemp("", "stigmer-agent-runner-*")
		if mkErr != nil {
			return nil, fmt.Errorf("create log dir: %w", mkErr)
		}
	}
	logPath := filepath.Join(logDir, "agent-runner.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	logger.Info("agent-runner log", "path", logPath)

	// Use exec.Command (not CommandContext) so the runner process lifetime
	// is decoupled from the startup context and runs until Stop() is called.
	cmd := exec.Command(pythonBin, mainPy)
	cmd.Dir = runnerDir
	cmd.Env = buildAgentRunnerEnv(cfg, runnerDir)
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	logger.Info("starting agent-runner",
		"python", pythonBin,
		"dir", runnerDir,
		"stigmer_endpoint", cfg.StigmerServiceAddress,
		"temporal", cfg.TemporalAddress,
	)

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start agent-runner: %w", err)
	}

	// Give the Python Temporal worker time to connect and start polling.
	time.Sleep(5 * time.Second)

	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		logFile.Sync()
		if logBytes, readErr := os.ReadFile(logPath); readErr == nil {
			lines := string(logBytes)
			if len(lines) > 2000 {
				lines = lines[len(lines)-2000:]
			}
			logger.Error("agent-runner exited prematurely", "last_log", lines)
		}
		logFile.Close()
		return nil, fmt.Errorf("agent-runner exited during startup")
	}

	logger.Info("agent-runner started", "pid", cmd.Process.Pid)

	return &AgentRunner{
		cmd:     cmd,
		logFile: logFile,
		logPath: logPath,
		logger:  logger,
	}, nil
}

func (r *AgentRunner) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	r.logger.Info("stopping agent-runner")
	err := r.cmd.Process.Kill()
	if r.logFile != nil {
		r.logFile.Close()
	}
	return err
}

func findAgentRunnerDir() string {
	candidates := []string{
		"../../../../backend/services/agent-runner",
		"../../backend/services/agent-runner",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		mainPy := filepath.Join(abs, "main.py")
		if _, err := os.Stat(mainPy); err == nil {
			return abs
		}
	}

	if envPath := os.Getenv("AGENT_RUNNER_DIR"); envPath != "" {
		return envPath
	}

	return ""
}

func findPython(runnerDir string) string {
	venvPython := filepath.Join(runnerDir, ".venv", "bin", "python")
	if _, err := os.Stat(venvPython); err == nil {
		return venvPython
	}

	if p, err := exec.LookPath("python3"); err == nil {
		return p
	}

	return ""
}

func buildAgentRunnerEnv(cfg AgentRunnerConfig, runnerDir string) []string {
	env := os.Environ()

	srcPath := filepath.Join(runnerDir, "src")

	artifactDir := filepath.Join(os.TempDir(), "stigmer-test-artifacts")

	env = append(env,
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=%s", cfg.StigmerServiceAddress),
		"STIGMER_API_KEY=test-integration-key",

		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", cfg.TemporalAddress),
		"TEMPORAL_NAMESPACE=default",
		"STIGMER_TASK_QUEUE=agent_execution_runner",

		"MODE=local",

		"STIGMER_LLM_PROVIDER=anthropic",
		"STIGMER_LLM_MODEL=claude-sonnet-4-6",

		// sqlite persists checkpoints across activity invocations, which
		// is required for pause/resume and HITL approval flows. MemorySaver
		// loses state when the activity re-invokes.
		"STIGMER_CHECKPOINTER_TYPE=sqlite",

		fmt.Sprintf("LOCAL_ARTIFACT_PATH=%s", artifactDir),

		fmt.Sprintf("PYTHONPATH=%s", srcPath),

		"LOG_LEVEL=INFO",

		// Propagated to MCP server subprocesses spawned by the runner.
		// Required by mcp-server-stigmer to connect back to the test Java service.
		fmt.Sprintf("STIGMER_SERVER_ADDRESS=%s", cfg.StigmerServiceAddress),
	)

	if cfg.ProxyEndpoint != "" {
		// Route LLM calls through the Java service's built-in proxy.
		// The proxy injects the API key server-side and records
		// LlmCallUsageRecord for billing.
		env = append(env, fmt.Sprintf("STIGMER_PROXY_ENDPOINT=%s", cfg.ProxyEndpoint))
	} else if cfg.AnthropicAPIKey != "" {
		// Fallback: call Anthropic directly (no billing records)
		env = append(env, fmt.Sprintf("ANTHROPIC_API_KEY=%s", cfg.AnthropicAPIKey))
		env = append(env, fmt.Sprintf("STIGMER_LLM_API_KEY=%s", cfg.AnthropicAPIKey))
	}

	if cfg.R2Endpoint != "" {
		env = append(env,
			"ARTIFACT_STORAGE_TYPE=r2",
			fmt.Sprintf("AGENT_EXECUTION_ARTIFACT_R2_ENDPOINT=%s", cfg.R2Endpoint),
			fmt.Sprintf("AGENT_EXECUTION_ARTIFACT_R2_ACCESS_KEY_ID=%s", cfg.R2AccessKey),
			fmt.Sprintf("AGENT_EXECUTION_ARTIFACT_R2_SECRET_ACCESS_KEY=%s", cfg.R2SecretKey),
			fmt.Sprintf("AGENT_EXECUTION_ARTIFACT_R2_BUCKET=%s", cfg.R2Bucket),
		)
	}

	if cfg.OTLPEndpoint != "" {
		env = append(env, fmt.Sprintf("OTEL_EXPORTER_OTLP_ENDPOINT=%s", cfg.OTLPEndpoint))
	}

	return env
}
