package envfile

import (
	"bufio"
	"os"
	"strings"

	"github.com/pkg/errors"
	executioncontextv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/executioncontext/v1"
)

// ParseFile reads and parses an environment file.
// All values are marked as non-secrets. Use ParseFileAsSecrets for secret files.
// Supports comments (#), empty lines, quoted values, and export prefix.
func ParseFile(path string) (EnvMap, error) {
	return parseFileWithSecretFlag(path, false)
}

// ParseFileAsSecrets reads and parses an environment file where all values are secrets.
// Use this for --secret-file flag to load files where all values should be encrypted.
func ParseFileAsSecrets(path string) (EnvMap, error) {
	return parseFileWithSecretFlag(path, true)
}

// parseFileWithSecretFlag is the internal implementation that parses a file
// and marks all values with the specified isSecret flag.
func parseFileWithSecretFlag(path string, isSecret bool) (EnvMap, error) {
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

		key, value, err := ParseLine(line)
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
// Returns key, value, error.
// Returns empty key for comments and blank lines (not an error).
func ParseLine(line string) (key string, value string, err error) {
	// Trim whitespace
	line = strings.TrimSpace(line)

	// Skip empty lines and comments
	if line == "" || strings.HasPrefix(line, "#") {
		return "", "", nil
	}

	// Handle optional 'export ' prefix (common in shell scripts)
	line = strings.TrimPrefix(line, "export ")

	// Find the first '=' separator
	eqIndex := strings.Index(line, "=")
	if eqIndex == -1 {
		return "", "", errors.New("invalid format: missing '=' separator")
	}

	key = strings.TrimSpace(line[:eqIndex])
	if key == "" {
		return "", "", errors.New("empty key")
	}

	// Validate key format (alphanumeric and underscores only)
	if !isValidEnvKey(key) {
		return "", "", errors.Errorf("invalid key %q: must contain only letters, numbers, and underscores", key)
	}

	value = line[eqIndex+1:]
	value = parseValue(value)

	return key, value, nil
}

// ParseFlags parses --env flag values (KEY=VALUE format).
// All values are marked as non-secrets. Use ParseFlagsAsSecrets for --secret flags.
func ParseFlags(envVars []string) (EnvMap, error) {
	return parseFlagsWithSecretFlag(envVars, false)
}

// ParseFlagsAsSecrets parses --secret flag values (KEY=VALUE format).
// All values are marked as secrets and will be encrypted.
func ParseFlagsAsSecrets(secretVars []string) (EnvMap, error) {
	return parseFlagsWithSecretFlag(secretVars, true)
}

// parseFlagsWithSecretFlag is the internal implementation that parses flag values
// and marks all values with the specified isSecret flag.
func parseFlagsWithSecretFlag(vars []string, isSecret bool) (EnvMap, error) {
	result := make(EnvMap)

	for _, envVar := range vars {
		key, value, err := ParseLine(envVar)
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
