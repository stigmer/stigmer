package daemon

import (
	"fmt"
	"os"
	"strings"
	"syscall"

	"golang.org/x/term"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/config"
	"github.com/stigmer/stigmer/client-apps/cli/pkg/climsg"
)

// PromptForSecret prompts the user to enter a secret value with masked input.
// Returns the secret value or an error.
func PromptForSecret(prompt string) (string, error) {
	fmt.Fprintf(os.Stderr, "%s: ", prompt)

	bytePassword, err := term.ReadPassword(int(syscall.Stdin))
	if err != nil {
		return "", err
	}

	fmt.Fprintln(os.Stderr)

	secret := strings.TrimSpace(string(bytePassword))
	if secret == "" {
		return "", fmt.Errorf("secret cannot be empty")
	}

	return secret, nil
}

// GetOrPromptSecret gets a secret from environment or prompts the user for it.
// envVar: the environment variable name to check
// prompt: the user-facing prompt text
// Returns the secret value and whether it was newly prompted (true) or from env (false).
func GetOrPromptSecret(envVar string, prompt string) (string, bool, error) {
	if value := os.Getenv(envVar); value != "" {
		return value, false, nil
	}

	secret, err := PromptForSecret(prompt)
	if err != nil {
		return "", false, err
	}

	return secret, true, nil
}

// GatherRequiredSecrets resolves provider-specific secrets from environment
// variables, config file, or interactive prompt (in that priority order).
// Returns a map of environment variable names to secret values.
func GatherRequiredSecrets(llmProvider string, localCfg *config.LocalBackendConfig) (map[string]string, error) {
	secrets := make(map[string]string)

	switch llmProvider {
	case "ollama":
		return secrets, nil

	case "anthropic":
		apiKey := resolveAPIKey(localCfg, "ANTHROPIC_API_KEY")
		if apiKey != "" {
			secrets["ANTHROPIC_API_KEY"] = apiKey
			return secrets, nil
		}

		prompted, err := PromptForSecret("Enter Anthropic API key")
		if err != nil {
			return nil, fmt.Errorf("failed to get Anthropic API key: %w", err)
		}
		secrets["ANTHROPIC_API_KEY"] = prompted
		climsg.Success("Anthropic API key configured")

	case "openai":
		apiKey := resolveAPIKey(localCfg, "OPENAI_API_KEY")
		if apiKey != "" {
			secrets["OPENAI_API_KEY"] = apiKey
			return secrets, nil
		}

		prompted, err := PromptForSecret("Enter OpenAI API key")
		if err != nil {
			return nil, fmt.Errorf("failed to get OpenAI API key: %w", err)
		}
		secrets["OPENAI_API_KEY"] = prompted
		climsg.Success("OpenAI API key configured")

	case "":
		return secrets, nil

	default:
		return nil, fmt.Errorf("unsupported LLM provider: %s (supported: ollama, anthropic, openai)", llmProvider)
	}

	return secrets, nil
}

// resolveAPIKey checks environment variable first, then config file.
func resolveAPIKey(localCfg *config.LocalBackendConfig, envVar string) string {
	if val := os.Getenv(envVar); val != "" {
		return val
	}
	if localCfg != nil && localCfg.LLM != nil && localCfg.LLM.APIKey != "" {
		return localCfg.LLM.APIKey
	}
	return ""
}
