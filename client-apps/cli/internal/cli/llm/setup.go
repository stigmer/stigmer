package llm

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/rs/zerolog/log"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/cliprint"
	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
)

const (
	// Default local LLM server port (Ollama)
	DefaultLocalPort = 11434
	DefaultLocalURL  = "http://localhost:11434"
	DefaultModel     = "qwen2.5-coder:7b"
)

// SetupOptions provides options for local LLM setup
type SetupOptions struct {
	Progress *cliprint.ProgressDisplay // Optional progress display
	Model    string                    // Model to pull (default: qwen2.5-coder:7b)
	Provider string                    // Provider: ollama, anthropic, openai
	Force    bool                      // Force reinstall even if exists
}

// Setup ensures local LLM is installed, running, and has the required model
// This is called automatically during 'stigmer server' startup
func Setup(ctx context.Context, cfg *config.LocalBackendConfig, opts *SetupOptions) error {
	if opts == nil {
		opts = &SetupOptions{}
	}

	// Resolve provider and model from config
	provider := cfg.ResolveLLMProvider()
	if opts.Provider != "" {
		provider = opts.Provider
	}

	model := cfg.ResolveLLMModel()
	if opts.Model != "" {
		model = opts.Model
	}

	log.Info().
		Str("provider", provider).
		Str("model", model).
		Msg("Setting up LLM")

	// Only auto-setup for local providers (ollama)
	// Cloud providers (anthropic, openai) require API keys
	if provider != "ollama" {
		log.Debug().Str("provider", provider).Msg("Skipping auto-setup for cloud provider")
		return nil
	}

	// Step 1: Check if local LLM server is already running
	if IsRunning() {
		log.Info().Msg("Local LLM server is already running")
	} else {
		// Step 2: Ensure LLM binary exists
		binaryPath, err := EnsureBinary(ctx, opts)
		if err != nil {
			return errors.Wrap(err, "failed to ensure LLM binary")
		}

		// Step 3: Start LLM server
		if err := StartServer(ctx, binaryPath, opts); err != nil {
			return errors.Wrap(err, "failed to start LLM server")
		}

		// Step 4: Wait for server to be ready
		if err := WaitForServer(ctx, opts); err != nil {
			return errors.Wrap(err, "LLM server failed to start")
		}
	}

	// Step 5: Ensure model is available
	if err := EnsureModel(ctx, model, opts); err != nil {
		return errors.Wrap(err, "failed to ensure model availability")
	}

	return nil
}

// IsRunning checks if local LLM server is running and responding
func IsRunning() bool {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("%s/api/tags", DefaultLocalURL))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

// EnsureBinary ensures LLM binary exists at ~/.stigmer/bin/ollama
// Downloads if missing or Force is true
func EnsureBinary(ctx context.Context, opts *SetupOptions) (string, error) {
	stigmerDir, err := getStigmerDir()
	if err != nil {
		return "", err
	}

	binaryPath := filepath.Join(stigmerDir, "bin", "ollama")
	if runtime.GOOS == "windows" {
		binaryPath += ".exe"
	}

	// Check if binary exists and Force is false
	if !opts.Force && fileExists(binaryPath) {
		log.Info().Str("path", binaryPath).Msg("LLM binary already exists")
		return binaryPath, nil
	}

	// Download binary
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInstalling, "Downloading local LLM")
	}

	if err := downloadBinary(ctx, binaryPath, opts); err != nil {
		return "", errors.Wrap(err, "failed to download LLM binary")
	}

	return binaryPath, nil
}

// StartServer starts the LLM server in the background
func StartServer(ctx context.Context, binaryPath string, opts *SetupOptions) error {
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseStarting, "Starting local LLM server")
	}

	stigmerDir, err := getStigmerDir()
	if err != nil {
		return err
	}

	// Prepare log file
	logDir := filepath.Join(stigmerDir, "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return errors.Wrap(err, "failed to create logs directory")
	}
	logFile := filepath.Join(logDir, "llm.log")

	// Open log file
	f, err := os.OpenFile(logFile, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return errors.Wrap(err, "failed to open log file")
	}

	// Start server in background
	cmd := exec.CommandContext(ctx, binaryPath, "serve")
	cmd.Stdout = f
	cmd.Stderr = f
	cmd.SysProcAttr = getSysProcAttr() // Platform-specific process attributes

	if err := cmd.Start(); err != nil {
		f.Close()
		return errors.Wrap(err, "failed to start LLM server")
	}

	// Save PID file
	pidFile := filepath.Join(stigmerDir, "llm.pid")
	if err := os.WriteFile(pidFile, []byte(fmt.Sprintf("%d", cmd.Process.Pid)), 0644); err != nil {
		log.Warn().Err(err).Msg("Failed to write PID file")
	}

	log.Info().
		Int("pid", cmd.Process.Pid).
		Str("log", logFile).
		Msg("Local LLM server started")

	// Close log file handle (process will keep writing)
	f.Close()

	return nil
}

// WaitForServer waits for LLM server to be ready
func WaitForServer(ctx context.Context, opts *SetupOptions) error {
	maxWait := 30 * time.Second
	checkInterval := 500 * time.Millisecond
	deadline := time.Now().Add(maxWait)

	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			if IsRunning() {
				return nil
			}
			time.Sleep(checkInterval)
		}
	}

	return errors.New("timeout waiting for LLM server to start")
}

// EnsureModel ensures the specified model is available locally
func EnsureModel(ctx context.Context, model string, opts *SetupOptions) error {
	// Check if model exists
	hasModel, err := HasModel(ctx, model)
	if err != nil {
		return errors.Wrap(err, "failed to check model availability")
	}

	if hasModel {
		log.Info().Str("model", model).Msg("Model already available")
		return nil
	}

	// Pull model with progress
	if err := PullModel(ctx, model, opts); err != nil {
		return errors.Wrap(err, "failed to pull model")
	}

	return nil
}

// HasModel checks if a model is available locally
func HasModel(ctx context.Context, model string) (bool, error) {
	stigmerDir, err := getStigmerDir()
	if err != nil {
		return false, err
	}

	binaryPath := filepath.Join(stigmerDir, "bin", "ollama")
	if runtime.GOOS == "windows" {
		binaryPath += ".exe"
	}

	cmd := exec.CommandContext(ctx, binaryPath, "list")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return false, errors.Wrap(err, "failed to list models")
	}

	// Check if model name appears in output
	return strings.Contains(string(output), model), nil
}

// PullModel pulls a model with progress display
func PullModel(ctx context.Context, model string, opts *SetupOptions) error {
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInstalling, fmt.Sprintf("Downloading model %s (this may take 3-10 minutes)", model))
	}

	stigmerDir, err := getStigmerDir()
	if err != nil {
		return err
	}

	binaryPath := filepath.Join(stigmerDir, "bin", "ollama")
	if runtime.GOOS == "windows" {
		binaryPath += ".exe"
	}

	cmd := exec.CommandContext(ctx, binaryPath, "pull", model)

	// TODO: Parse progress output and update progress display with percentage
	// For now, just show output directly
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return errors.Wrap(err, "failed to pull model")
	}

	return nil
}

// GetStatus returns the status of the local LLM server
func GetStatus() (running bool, pid int, models []string, err error) {
	// Check if running
	running = IsRunning()

	if !running {
		return false, 0, nil, nil
	}

	// Read PID file
	stigmerDir, err := getStigmerDir()
	if err != nil {
		return true, 0, nil, err
	}

	pidFile := filepath.Join(stigmerDir, "llm.pid")
	pidData, err := os.ReadFile(pidFile)
	if err == nil {
		fmt.Sscanf(string(pidData), "%d", &pid)
	}

	// List models
	models, err = ListModels(context.Background())
	if err != nil {
		log.Warn().Err(err).Msg("Failed to list models")
		err = nil // Don't fail status check if model list fails
	}

	return true, pid, models, nil
}

// ListModels lists available models
func ListModels(ctx context.Context) ([]string, error) {
	stigmerDir, err := getStigmerDir()
	if err != nil {
		return nil, err
	}

	binaryPath := filepath.Join(stigmerDir, "bin", "ollama")
	if runtime.GOOS == "windows" {
		binaryPath += ".exe"
	}

	cmd := exec.CommandContext(ctx, binaryPath, "list")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, errors.Wrap(err, "failed to list models")
	}

	// Parse output - skip header line, extract model names
	lines := strings.Split(string(output), "\n")
	var models []string
	for i, line := range lines {
		if i == 0 || strings.TrimSpace(line) == "" {
			continue // Skip header and empty lines
		}
		// Extract first field (model name)
		fields := strings.Fields(line)
		if len(fields) > 0 {
			models = append(models, fields[0])
		}
	}

	return models, nil
}

// Helper functions

func getStigmerDir() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", errors.Wrap(err, "failed to get user home directory")
	}
	return filepath.Join(homeDir, ".stigmer"), nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
