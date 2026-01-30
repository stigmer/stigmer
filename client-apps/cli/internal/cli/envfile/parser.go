package envfile

import (
	"bufio"
	"os"
	"strings"

	"github.com/pkg/errors"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
)

const (
	// secretPrefix marks a value as a secret in env files and flags.
	secretPrefix = "secret:"
)

// ParseFile reads and parses an environment file.
// Supports comments (#), empty lines, quoted values, and secret: prefix.
func ParseFile(path string) (EnvMap, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, errors.Wrapf(err, "failed to open environment file %s", path)
	}
	defer file.Close()

	result := make(EnvMap)
	scanner := bufio.NewScanner(file)
	lineNum := 0

	for scanner.Scan() {
		lineNum++
		line := scanner.Text()

		key, value, isSecret, err := ParseLine(line)
		if err != nil {
			return nil, &ParseError{
				File:    path,
				Line:    lineNum,
				Message: err.Error(),
			}
		}

		// Skip empty results (comments, blank lines)
		if key == "" {
			continue
		}

		result[key] = &executioncontextv1.ExecutionValue{
			Value:    value,
			IsSecret: isSecret,
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, errors.Wrapf(err, "failed to read environment file %s", path)
	}

	return result, nil
}

// ParseLine parses a single KEY=VALUE line.
// Returns key, value, isSecret, error.
// Returns empty key for comments and blank lines (not an error).
func ParseLine(line string) (key string, value string, isSecret bool, err error) {
	// Trim whitespace
	line = strings.TrimSpace(line)

	// Skip empty lines and comments
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", false, nil
	}

	// Check for secret prefix
	if strings.HasPrefix(line, secretPrefix) {
		isSecret = true
		line = strings.TrimPrefix(line, secretPrefix)
	}

	// Handle optional 'export ' prefix (common in shell scripts)
	line = strings.TrimPrefix(line, "export ")

	// Find the first '=' separator
	eqIndex := strings.Index(line, "=")
	if eqIndex == -1 {
		return "", "", false, errors.New("invalid format: missing '=' separator")
	}

	key = strings.TrimSpace(line[:eqIndex])
	if key == "" {
		return "", "", false, errors.New("empty key")
	}

	// Validate key format (alphanumeric and underscores only)
	if !isValidEnvKey(key) {
		return "", "", false, errors.Errorf("invalid key %q: must contain only letters, numbers, and underscores", key)
	}

	value = line[eqIndex+1:]
	value = parseValue(value)

	return key, value, isSecret, nil
}

// ParseFlags parses --env flag values (KEY=VALUE or secret:KEY=VALUE).
// Same format as existing --runtime-env parsing.
func ParseFlags(envVars []string) (EnvMap, error) {
	result := make(EnvMap)

	for _, envVar := range envVars {
		key, value, isSecret, err := ParseLine(envVar)
		if err != nil {
			return nil, errors.Wrapf(err, "invalid environment variable %q", envVar)
		}

		if key == "" {
			return nil, errors.Errorf("invalid environment variable %q: empty or comment", envVar)
		}

		result[key] = &executioncontextv1.ExecutionValue{
			Value:    value,
			IsSecret: isSecret,
		}
	}

	return result, nil
}

// isValidEnvKey checks if a key contains only valid characters.
// Valid: A-Z, a-z, 0-9, _ (must not start with a digit).
func isValidEnvKey(key string) bool {
	if len(key) == 0 {
		return false
	}

	// First character must be a letter or underscore
	first := key[0]
	if !((first >= 'A' && first <= 'Z') || (first >= 'a' && first <= 'z') || first == '_') {
		return false
	}

	// Rest can be alphanumeric or underscore
	for i := 1; i < len(key); i++ {
		c := key[i]
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}

	return true
}

// parseValue handles quoted values and whitespace.
func parseValue(value string) string {
	value = strings.TrimSpace(value)

	// Handle quoted values
	if len(value) >= 2 {
		if (value[0] == '"' && value[len(value)-1] == '"') ||
			(value[0] == '\'' && value[len(value)-1] == '\'') {
			// Remove quotes and handle escape sequences
			value = value[1 : len(value)-1]
			value = unescapeValue(value)
		}
	}

	return value
}

// unescapeValue handles common escape sequences in quoted strings.
func unescapeValue(value string) string {
	// Handle common escape sequences
	replacer := strings.NewReplacer(
		`\\`, `\`,
		`\"`, `"`,
		`\'`, `'`,
		`\n`, "\n",
		`\t`, "\t",
		`\r`, "\r",
	)
	return replacer.Replace(value)
}
