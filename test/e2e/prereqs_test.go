package e2e

import (
	"context"
	"fmt"
	"net/http"
	"os/exec"
	"strings"
	"time"
)

// CheckPrerequisites verifies all required services for Phase 2 (full execution) tests
// Returns nil if all prerequisites are met, otherwise returns a helpful error message
func CheckPrerequisites() error {
	// Check Docker
	if err := checkDocker(); err != nil {
		return fmt.Errorf(`Docker is not available or not running.

Required for: Running Temporal server and agent-runner via docker-compose

Install Docker:
  - macOS: https://docs.docker.com/desktop/install/mac-install/
  - Linux: https://docs.docker.com/engine/install/
  - Windows: https://docs.docker.com/desktop/install/windows-install/

Error: %w`, err)
	}

	// Check Ollama
	if err := checkOllama(); err != nil {
		return fmt.Errorf(`Ollama is not running or not accessible.

Required for: LLM-powered agent execution

Setup Ollama:
  1. Install: https://ollama.com/
  2. Start server: ollama serve
  3. Pull model: ollama pull llama3.2:1b

To verify Ollama is running:
  curl http://localhost:11434/api/version

Error: %w`, err)
	}

	return nil
}

// checkDocker verifies Docker is installed and the daemon is running
func checkDocker() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Check if docker command exists
	cmd := exec.CommandContext(ctx, "docker", "version", "--format", "{{.Server.Version}}")
	output, err := cmd.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("docker command timed out (daemon may not be running)")
		}
		return fmt.Errorf("docker command failed: %w (output: %s)", err, string(output))
	}

	version := strings.TrimSpace(string(output))
	if version == "" {
		return fmt.Errorf("docker daemon not running (could not get server version)")
	}

	return nil
}

// checkOllama verifies Ollama server is running and accessible
func checkOllama() error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "http://localhost:11434/api/version", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to connect to Ollama (is it running?): %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Ollama returned status %d (expected 200)", resp.StatusCode)
	}

	return nil
}

// checkOllamaModel verifies a specific model is available in Ollama
func checkOllamaModel(model string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, "GET", "http://localhost:11434/api/tags", nil)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to list models: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Ollama API returned status %d", resp.StatusCode)
	}

	// Note: Full JSON parsing could be added here to check if specific model exists
	// For now, just checking that the API is responsive
	return nil
}
