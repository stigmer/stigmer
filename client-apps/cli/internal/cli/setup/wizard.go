// Package setup provides the interactive first-run setup wizard for Stigmer.
//
// The wizard guides users through LLM provider selection on first run
// and is re-invocable via 'stigmer server setup' for reconfiguration.
package setup

import (
	"bufio"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"time"

	"golang.org/x/term"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// RunWizard runs the interactive LLM provider setup wizard.
// It modifies cfg.Backend.Local.LLM based on user selection.
// All other configuration (Temporal, Execution, etc.) is preserved.
func RunWizard(cfg *config.Config) error {
	if cfg.Backend.Local == nil {
		cfg.Backend.Local = &config.LocalBackendConfig{}
	}

	fmt.Fprintln(os.Stderr)
	climsg.Info("Welcome to Stigmer! Let's configure your environment.")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "Choose your LLM provider (required for agent execution):")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "  [1] Anthropic  — Cloud API, best quality (requires API key)")
	fmt.Fprintln(os.Stderr, "  [2] OpenAI     — Cloud API (requires API key)")
	fmt.Fprintln(os.Stderr, "  [3] Ollama     — Free, local, offline (requires separate install)")
	fmt.Fprintln(os.Stderr, "  [4] Skip       — Configure later (agents won't execute)")
	fmt.Fprintln(os.Stderr)

	for {
		choice := promptLine("Select [1-4]: ")

		switch choice {
		case "1":
			return configureAnthropic(cfg)
		case "2":
			return configureOpenAI(cfg)
		case "3":
			return configureOllama(cfg)
		case "4":
			return configureSkip(cfg)
		default:
			fmt.Fprintln(os.Stderr, "Invalid choice. Please enter 1, 2, 3, or 4.")
		}
	}
}

func configureAnthropic(cfg *config.Config) error {
	if key := os.Getenv("ANTHROPIC_API_KEY"); key != "" {
		climsg.Success("Using ANTHROPIC_API_KEY from environment")
		setLLMConfig(cfg, "anthropic", "claude-sonnet-4.5", "", "")
		return nil
	}

	apiKey, err := promptSecret("Enter your Anthropic API key")
	if err != nil {
		return fmt.Errorf("failed to read API key: %w", err)
	}

	setLLMConfig(cfg, "anthropic", "claude-sonnet-4.5", apiKey, "")
	climsg.Success("Anthropic configured (model: claude-sonnet-4.5)")
	return nil
}

func configureOpenAI(cfg *config.Config) error {
	if key := os.Getenv("OPENAI_API_KEY"); key != "" {
		climsg.Success("Using OPENAI_API_KEY from environment")
		setLLMConfig(cfg, "openai", "gpt-4", "", "")
		return nil
	}

	apiKey, err := promptSecret("Enter your OpenAI API key")
	if err != nil {
		return fmt.Errorf("failed to read API key: %w", err)
	}

	setLLMConfig(cfg, "openai", "gpt-4", apiKey, "")
	climsg.Success("OpenAI configured (model: gpt-4)")
	return nil
}

func configureOllama(cfg *config.Config) error {
	if isOllamaAvailable() {
		setLLMConfig(cfg, "ollama", "qwen2.5-coder:7b", "", "http://localhost:11434")
		climsg.Success("Ollama detected and configured (model: qwen2.5-coder:7b)")
		return nil
	}

	climsg.Warning("Ollama is not installed or not running.")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "  Install Ollama first:")
	fmt.Fprintln(os.Stderr, "    brew install ollama && ollama serve && ollama pull qwen2.5-coder:7b")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "  Or choose a different provider:")
	fmt.Fprintln(os.Stderr, "    [1] Anthropic   [2] OpenAI   [4] Skip")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "  Press Enter to configure Ollama anyway (install later).")
	fmt.Fprintln(os.Stderr)

	for {
		choice := promptLine("Select [1/2/4] or Enter: ")

		switch choice {
		case "1":
			return configureAnthropic(cfg)
		case "2":
			return configureOpenAI(cfg)
		case "4":
			return configureSkip(cfg)
		case "":
			setLLMConfig(cfg, "ollama", "qwen2.5-coder:7b", "", "http://localhost:11434")
			climsg.Warning("Ollama configured but not detected. Install and start Ollama before running agents.")
			return nil
		default:
			fmt.Fprintln(os.Stderr, "Invalid choice. Please enter 1, 2, 4, or press Enter.")
		}
	}
}

func configureSkip(cfg *config.Config) error {
	cfg.Backend.Local.LLM = nil

	fmt.Fprintln(os.Stderr)
	climsg.Warning("No LLM configured. The server will start, but agent execution will fail.")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "  Configure later:")
	fmt.Fprintln(os.Stderr, "    stigmer server setup")
	fmt.Fprintln(os.Stderr)
	fmt.Fprintln(os.Stderr, "  Or set provider directly:")
	fmt.Fprintln(os.Stderr, "    stigmer config set llm.provider anthropic")
	fmt.Fprintln(os.Stderr, "    export ANTHROPIC_API_KEY=sk-ant-...")
	fmt.Fprintln(os.Stderr, "    stigmer server stop && stigmer server")
	fmt.Fprintln(os.Stderr)
	return nil
}

func setLLMConfig(cfg *config.Config, provider, model, apiKey, baseURL string) {
	cfg.Backend.Local.LLM = &config.LLMConfig{
		Provider: provider,
		Model:    model,
	}
	if apiKey != "" {
		cfg.Backend.Local.LLM.APIKey = apiKey
	}
	if baseURL != "" {
		cfg.Backend.Local.LLM.BaseURL = baseURL
	}
}

func isOllamaAvailable() bool {
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get("http://localhost:11434/api/tags")
	if err == nil {
		resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			return true
		}
	}

	_, err = exec.LookPath("ollama")
	return err == nil
}

func promptLine(prompt string) string {
	fmt.Fprint(os.Stderr, prompt)
	reader := bufio.NewReader(os.Stdin)
	line, _ := reader.ReadString('\n')
	return strings.TrimSpace(line)
}

func promptSecret(prompt string) (string, error) {
	fmt.Fprintf(os.Stderr, "%s: ", prompt)
	bytePassword, err := term.ReadPassword(int(syscall.Stdin))
	if err != nil {
		return "", err
	}
	fmt.Fprintln(os.Stderr)

	secret := strings.TrimSpace(string(bytePassword))
	if secret == "" {
		return "", fmt.Errorf("API key cannot be empty")
	}
	return secret, nil
}
