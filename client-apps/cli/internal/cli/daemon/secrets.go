package daemon

import (
	"fmt"
	"os"
	"strings"
	"syscall"

	"golang.org/x/term"
)

// PromptForSecret prompts the user to enter a secret value with masked input.
// Returns the secret value or an error.
func PromptForSecret(prompt string) (string, error) {
	fmt.Fprintf(os.Stderr, "%s: ", prompt)
	
	// Read password with masked input
	bytePassword, err := term.ReadPassword(int(syscall.Stdin))
	if err != nil {
		return "", err
	}
	
	// Print newline after masked input
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
	// Check if already set in environment
	if value := os.Getenv(envVar); value != "" {
		return value, false, nil
	}
	
	// Prompt user for the secret
	secret, err := PromptForSecret(prompt)
	if err != nil {
		return "", false, err
	}
	
	return secret, true, nil
}

// GatherRequiredSecrets prompts for any missing required secrets.
// Returns a map of environment variable names to secret values.
func GatherRequiredSecrets() (map[string]string, error) {
	secrets := make(map[string]string)
	
	// Check for ANTHROPIC_API_KEY
	apiKey, prompted, err := GetOrPromptSecret("ANTHROPIC_API_KEY", "Enter Anthropic API key")
	if err != nil {
		return nil, fmt.Errorf("failed to get Anthropic API key: %w", err)
	}
	
	if prompted {
		secrets["ANTHROPIC_API_KEY"] = apiKey
		fmt.Fprintf(os.Stderr, "✓ Anthropic API key configured\n")
	}
	
	// Future: Add other provider keys here (OpenAI, etc.)
	// openaiKey, prompted, err := GetOrPromptSecret("OPENAI_API_KEY", "Enter OpenAI API key (optional, press Enter to skip)")
	
	return secrets, nil
}
