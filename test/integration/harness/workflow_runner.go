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

// WorkflowRunner manages the Go workflow-runner as a child process.
type WorkflowRunner struct {
	cmd     *exec.Cmd
	logFile *os.File
	logger  *slog.Logger
}

// WorkflowRunnerConfig holds configuration for starting the workflow runner.
type WorkflowRunnerConfig struct {
	// BinaryPath is the path to the workflow-runner binary.
	// If empty, the harness will attempt to build it.
	BinaryPath string

	// StigmerServiceAddress is the gRPC address of the Java service
	// that the runner calls back to for hydration and status updates.
	StigmerServiceAddress string

	// TemporalAddress is the Temporal server address.
	TemporalAddress string
}

// StartWorkflowRunner builds (if needed) and starts the workflow-runner binary.
func StartWorkflowRunner(ctx context.Context, cfg WorkflowRunnerConfig, logger *slog.Logger) (*WorkflowRunner, error) {
	if logger == nil {
		logger = slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	}

	binaryPath := cfg.BinaryPath
	if binaryPath == "" {
		var err error
		binaryPath, err = buildWorkflowRunner(ctx, logger)
		if err != nil {
			return nil, fmt.Errorf("build workflow-runner: %w", err)
		}
	}

	logDir, err := os.MkdirTemp("", "stigmer-workflow-runner-*")
	if err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}
	logPath := filepath.Join(logDir, "workflow-runner.log")
	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, fmt.Errorf("create log file: %w", err)
	}
	logger.Info("workflow-runner log", "path", logPath)

	cmd := exec.CommandContext(ctx, binaryPath)
	cmd.Env = buildRunnerEnv(cfg)
	cmd.Stdout = logFile
	cmd.Stderr = logFile

	logger.Info("starting workflow-runner",
		"binary", binaryPath,
		"stigmer_endpoint", cfg.StigmerServiceAddress,
		"temporal", cfg.TemporalAddress,
	)

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return nil, fmt.Errorf("start workflow-runner: %w", err)
	}

	// The workflow-runner is a Temporal worker — it doesn't expose a port.
	// Give it a moment to connect to Temporal and start polling.
	time.Sleep(2 * time.Second)

	// Verify the process is still alive after startup.
	if cmd.ProcessState != nil && cmd.ProcessState.Exited() {
		logFile.Sync()
		if logBytes, readErr := os.ReadFile(logPath); readErr == nil {
			lines := string(logBytes)
			if len(lines) > 2000 {
				lines = lines[len(lines)-2000:]
			}
			logger.Error("workflow-runner exited prematurely", "last_log", lines)
		}
		logFile.Close()
		return nil, fmt.Errorf("workflow-runner exited during startup")
	}

	logger.Info("workflow-runner started", "pid", cmd.Process.Pid)

	return &WorkflowRunner{
		cmd:     cmd,
		logFile: logFile,
		logger:  logger,
	}, nil
}

func (r *WorkflowRunner) Stop() error {
	if r.cmd == nil || r.cmd.Process == nil {
		return nil
	}
	r.logger.Info("stopping workflow-runner")
	err := r.cmd.Process.Kill()
	if r.logFile != nil {
		r.logFile.Close()
	}
	return err
}

func buildWorkflowRunner(ctx context.Context, logger *slog.Logger) (string, error) {
	runnerDir := findWorkflowRunnerDir()
	if runnerDir == "" {
		return "", fmt.Errorf("workflow-runner source directory not found")
	}

	outputPath := filepath.Join(os.TempDir(), "stigmer-workflow-runner-test")

	logger.Info("building workflow-runner", "source", runnerDir, "output", outputPath)

	cmd := exec.CommandContext(ctx, "go", "build", "-o", outputPath, ".")
	cmd.Dir = runnerDir
	cmd.Env = os.Environ()

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("go build failed: %w\noutput: %s", err, string(output))
	}

	return outputPath, nil
}

func findWorkflowRunnerDir() string {
	candidates := []string{
		"../../../../backend/services/workflow-runner",
		"../../backend/services/workflow-runner",
	}
	for _, c := range candidates {
		abs, err := filepath.Abs(c)
		if err != nil {
			continue
		}
		mainGo := filepath.Join(abs, "main.go")
		if _, err := os.Stat(mainGo); err == nil {
			return abs
		}
	}

	if envPath := os.Getenv("WORKFLOW_RUNNER_DIR"); envPath != "" {
		return envPath
	}

	return ""
}

func buildRunnerEnv(cfg WorkflowRunnerConfig) []string {
	env := os.Environ()
	env = append(env,
		fmt.Sprintf("STIGMER_BACKEND_ENDPOINT=%s", cfg.StigmerServiceAddress),
		"STIGMER_API_KEY=test-integration-key",
		"STIGMER_SERVICE_USE_TLS=false",

		fmt.Sprintf("TEMPORAL_SERVICE_ADDRESS=%s", cfg.TemporalAddress),
		"TEMPORAL_NAMESPACE=default",

		"TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE=workflow_execution_runner",
		"TEMPORAL_ZIGFLOW_EXECUTION_TASK_QUEUE=zigflow_execution",
		"TEMPORAL_WORKFLOW_VALIDATION_RUNNER_TASK_QUEUE=workflow_validation_runner",

		"LOG_LEVEL=info",
		"ENV=local",

		"CLAIMCHECK_ENABLED=false",
	)
	return env
}
