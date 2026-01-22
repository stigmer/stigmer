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

	// Step 1: Detect which binary to use (system vs local)
	binaryPath, err := detectBinary()
	if err != nil {
		return errors.Wrap(err, "failed to detect Ollama binary")
	}

	// Step 2: Check if local LLM server is already running
	if IsRunning() {
		log.Info().Str("binary", binaryPath).Msg("Local LLM server is already running")
	} else {
		// If binary was not found, try to download it
		if binaryPath == "" {
			binaryPath, err = EnsureBinary(ctx, opts)
			if err != nil {
				return errors.Wrap(err, "failed to ensure LLM binary - please install Ollama manually: https://ollama.ai/download")
			}
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

	// Step 5: Ensure model is available (use detected binary)
	actualModel, err := EnsureModel(ctx, model, binaryPath, opts)
	if err != nil {
		return errors.Wrap(err, "failed to ensure model availability")
	}

	// If we're using a different model than configured, log it
	if actualModel != model {
		log.Info().
			Str("requested", model).
			Str("using", actualModel).
			Msg("Using compatible model instead of configured model")
	}

	return nil
}

// detectBinary detects which Ollama binary to use
// Priority: 1) System PATH, 2) Local ~/.stigmer/bin/, 3) Empty (needs download)
func detectBinary() (string, error) {
	// Check system PATH first (e.g., installed via Brew)
	systemPath, err := exec.LookPath("ollama")
	if err == nil {
		log.Info().Str("path", systemPath).Msg("Found Ollama in system PATH")
		return systemPath, nil
	}

	// Check local installation
	stigmerDir, err := getStigmerDir()
	if err != nil {
		return "", err
	}

	localPath := filepath.Join(stigmerDir, "bin", "ollama")
	if runtime.GOOS == "windows" {
		localPath += ".exe"
	}

	if fileExists(localPath) {
		log.Info().Str("path", localPath).Msg("Found Ollama in local installation")
		return localPath, nil
	}

	// Not found anywhere - will need to download
	log.Info().Msg("Ollama not found - will download automatically")
	return "", nil
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

// EnsureModel ensures a compatible model is available locally
// Returns the actual model being used (may differ from requested if using compatible model)
func EnsureModel(ctx context.Context, model string, binaryPath string, opts *SetupOptions) (string, error) {
	// Check if exact model exists
	hasModel, err := HasModel(ctx, model, binaryPath)
	if err != nil {
		return "", errors.Wrap(err, "failed to check model availability")
	}

	if hasModel {
		log.Info().Str("model", model).Msg("Model already available")
		return model, nil
	}

	// Exact model not found - look for compatible models
	compatibleModel, err := FindCompatibleModel(ctx, model, binaryPath)
	if err != nil {
		return "", err
	}

	if compatibleModel != "" {
		log.Info().
			Str("requested", model).
			Str("found", compatibleModel).
			Msg("Using compatible model")
		return compatibleModel, nil
	}

	// No models found - inform user instead of auto-downloading
	availableModels, _ := ListModels(ctx)
	if len(availableModels) > 0 {
		return "", fmt.Errorf("model '%s' not found\n\nAvailable models:\n%s\n\nTo use an existing model:\n  stigmer config set llm.model <model-name>\n\nTo pull the required model:\n  stigmer server llm pull %s",
			model,
			formatModelList(availableModels),
			model)
	}

	return "", fmt.Errorf("no models found\n\nTo install the default model:\n  stigmer server llm pull %s\n\nOr browse models at: https://ollama.ai/library", model)
}

// HasModel checks if a model is available locally
func HasModel(ctx context.Context, model string, binaryPath string) (bool, error) {
	// If no binary path provided, try to detect it
	if binaryPath == "" {
		var err error
		binaryPath, err = detectBinary()
		if err != nil {
			return false, err
		}
		if binaryPath == "" {
			return false, errors.New("Ollama binary not found - install from https://ollama.ai/download")
		}
	}

	cmd := exec.CommandContext(ctx, binaryPath, "list")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return false, errors.Wrapf(err, "failed to list models using binary: %s", binaryPath)
	}

	// Check if model name appears in output
	return strings.Contains(string(output), model), nil
}

// PullModel pulls a model with progress display
func PullModel(ctx context.Context, model string, binaryPath string, opts *SetupOptions) error {
	if opts.Progress != nil {
		opts.Progress.SetPhase(cliprint.PhaseInstalling, fmt.Sprintf("Downloading model %s (this may take 3-10 minutes)", model))
	}

	// If no binary path provided, try to detect it
	if binaryPath == "" {
		var err error
		binaryPath, err = detectBinary()
		if err != nil {
			return err
		}
		if binaryPath == "" {
			return errors.New("Ollama binary not found - install from https://ollama.ai/download")
		}
	}

	cmd := exec.CommandContext(ctx, binaryPath, "pull", model)

	// TODO: Parse progress output and update progress display with percentage
	// For now, just show output directly
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	if err := cmd.Run(); err != nil {
		return errors.Wrapf(err, "failed to pull model using binary: %s", binaryPath)
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
	binaryPath, err := detectBinary()
	if err != nil {
		return nil, err
	}
	if binaryPath == "" {
		return nil, errors.New("Ollama binary not found - install from https://ollama.ai/download")
	}

	cmd := exec.CommandContext(ctx, binaryPath, "list")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, errors.Wrapf(err, "failed to list models using binary: %s", binaryPath)
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

// FindCompatibleModel finds a compatible model when exact match not found
// For example, if looking for qwen2.5-coder:7b, will accept qwen2.5-coder:14b
func FindCompatibleModel(ctx context.Context, requestedModel string, binaryPath string) (string, error) {
	models, err := ListModels(ctx)
	if err != nil {
		return "", err
	}

	// Extract base model name (everything before the colon)
	// e.g., "qwen2.5-coder:7b" -> "qwen2.5-coder"
	baseModel := requestedModel
	if idx := strings.Index(requestedModel, ":"); idx > 0 {
		baseModel = requestedModel[:idx]
	}

	// Look for any model with the same base name
	for _, model := range models {
		if strings.HasPrefix(model, baseModel+":") || model == baseModel {
			log.Info().
				Str("base", baseModel).
				Str("found", model).
				Msg("Found compatible model")
			return model, nil
		}
	}

	return "", nil
}

// formatModelList formats a list of models for display
func formatModelList(models []string) string {
	var lines []string
	for _, model := range models {
		lines = append(lines, fmt.Sprintf("  • %s", model))
	}
	return strings.Join(lines, "\n")
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
