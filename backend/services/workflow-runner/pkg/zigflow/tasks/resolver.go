/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package tasks

import (
	"fmt"
	"regexp"
	"strings"
)

// ResolvePlaceholders replaces runtime placeholders in a string with actual values.
//
// This implements just-in-time (JIT) secret resolution: placeholders like ${.secrets.KEY}
// and ${.env_vars.VAR} are resolved at task execution time (not compile-time), ensuring
// secrets never appear in Temporal workflow history.
//
// **SECURITY CRITICAL**: This is the last line of defense preventing secret leakage.
// Placeholders MUST be resolved here (in activities), not in workflows.
//
// Patterns:
//   - ${.secrets.KEY} → resolved from runtimeEnv[KEY] (if is_secret=true)
//   - ${.env_vars.VAR} → resolved from runtimeEnv[VAR]
//
// Example:
//
//	runtimeEnv := map[string]any{
//	    "OPENAI_KEY": map[string]interface{}{
//	        "value": "sk-12345",
//	        "is_secret": true,
//	    },
//	    "ENVIRONMENT": map[string]interface{}{
//	        "value": "production",
//	        "is_secret": false,
//	    },
//	}
//	
//	result, _ := ResolvePlaceholders(
//	    "Bearer ${.secrets.OPENAI_KEY} in ${.env_vars.ENVIRONMENT}",
//	    runtimeEnv,
//	)
//	// result: "Bearer sk-12345 in production"
//
// Error Handling:
//   - Missing values: Returns error (fail-fast, don't silently ignore)
//   - Invalid format: Keeps original placeholder (non-runtime expressions pass through)
//   - Nil runtimeEnv: Returns original string unchanged
func ResolvePlaceholders(s string, runtimeEnv map[string]any) (string, error) {
	// If no runtime environment, nothing to resolve
	if runtimeEnv == nil || len(runtimeEnv) == 0 {
		return s, nil
	}

	// Pattern: ${.secrets.KEY} or ${.env_vars.VAR}
	// Key/Var names must be UPPERCASE with optional underscores and numbers
	pattern := regexp.MustCompile(`\$\{\.(?P<type>secrets|env_vars)\.(?P<key>[A-Z_][A-Z0-9_]*)\}`)

	// Track missing variables for error reporting
	var missingVars []string

	// Replace all matches
	result := pattern.ReplaceAllStringFunc(s, func(match string) string {
		// Extract type and key
		matches := pattern.FindStringSubmatch(match)
		if len(matches) != 3 {
			// Shouldn't happen if regex is correct, but be defensive
			return match // Keep original if parse fails
		}

		refType := matches[1] // "secrets" or "env_vars"
		key := matches[2]     // e.g., "OPENAI_KEY"

		// Lookup in runtime environment
		envValue, exists := runtimeEnv[key]
		if !exists {
			missingVars = append(missingVars, fmt.Sprintf("%s.%s", refType, key))
			return match // Keep placeholder for error reporting
		}

		// Extract value from map structure
		// Expected format: {"value": "...", "is_secret": true/false}
		valueMap, ok := envValue.(map[string]interface{})
		if !ok {
			missingVars = append(missingVars, fmt.Sprintf("%s.%s (invalid format)", refType, key))
			return match
		}

		actualValue, ok := valueMap["value"].(string)
		if !ok {
			missingVars = append(missingVars, fmt.Sprintf("%s.%s (value not string)", refType, key))
			return match
		}

		// Optional: Verify type matches (security check)
		// If referenced as .secrets but is_secret=false, log warning but allow
		if isSecret, ok := valueMap["is_secret"].(bool); ok {
			if refType == "secrets" && !isSecret {
				// Log warning: referenced as secret but not marked as secret
				// In a real implementation, this should use the logger
				// For now, we allow it (could be stricter)
			}
		}

		return actualValue
	})

	// Report errors if any variables were missing or invalid
	if len(missingVars) > 0 {
		return "", fmt.Errorf("failed to resolve runtime placeholders: %s", strings.Join(missingVars, ", "))
	}

	return result, nil
}

// ResolveObject recursively resolves runtime placeholders in objects, maps, and arrays.
//
// This enables JIT resolution for complex task configurations containing nested
// structures with runtime references.
//
// **Use this before passing task configurations to workflow activities.**
//
// Example:
//
//	taskConfig := map[string]interface{}{
//	    "endpoint": map[string]interface{}{
//	        "uri": "https://api.example.com",
//	        "headers": map[string]interface{}{
//	            "Authorization": "${.secrets.API_KEY}",
//	        },
//	    },
//	    "region": "${.env_vars.AWS_REGION}",
//	}
//	
//	resolved, _ := ResolveObject(taskConfig, runtimeEnv)
//	// resolved["endpoint"]["headers"]["Authorization"] = "sk-12345"
//	// resolved["region"] = "us-east-1"
func ResolveObject(obj interface{}, runtimeEnv map[string]any) (interface{}, error) {
	switch v := obj.(type) {
	case string:
		// Resolve runtime placeholders in string
		return ResolvePlaceholders(v, runtimeEnv)

	case map[string]interface{}:
		// Recursively resolve map values
		resolved := make(map[string]interface{})
		for key, val := range v {
			resolvedVal, err := ResolveObject(val, runtimeEnv)
			if err != nil {
				return nil, fmt.Errorf("resolving key %s: %w", key, err)
			}
			resolved[key] = resolvedVal
		}
		return resolved, nil

	case []interface{}:
		// Recursively resolve array elements
		resolved := make([]interface{}, len(v))
		for i, val := range v {
			resolvedVal, err := ResolveObject(val, runtimeEnv)
			if err != nil {
				return nil, fmt.Errorf("resolving array index %d: %w", i, err)
			}
			resolved[i] = resolvedVal
		}
		return resolved, nil

	default:
		// Non-string, non-container types pass through unchanged
		// (numbers, booleans, nil, etc.)
		return obj, nil
	}
}

// SanitizeOutput scans output for secret values and warns if found.
//
// **SECURITY FEATURE**: Prevents accidental secret leakage in task outputs.
//
// This is a defensive measure. Ideally, secrets should never appear in outputs,
// but this provides an additional safety net by detecting and logging warnings
// when secret values are found in output data.
//
// **Note**: This does NOT modify the output - it only logs warnings.
// Modifying outputs could break workflows that legitimately include secret-like patterns.
//
// Example:
//
//	output := map[string]interface{}{
//	    "status": "success",
//	    "response": "Bearer sk-12345 authenticated", // ❌ Contains secret!
//	}
//	
//	warnings := SanitizeOutput(output, runtimeEnv)
//	// warnings: ["Output contains secret value for OPENAI_KEY"]
func SanitizeOutput(output interface{}, runtimeEnv map[string]any) []string {
	if runtimeEnv == nil {
		return nil
	}

	// Extract all secret values
	secretValues := extractSecretValues(runtimeEnv)
	if len(secretValues) == 0 {
		return nil
	}

	// Scan output for secret values
	var warnings []string
	scanForSecrets(output, secretValues, &warnings)

	return warnings
}

// extractSecretValues extracts all secret values from runtime environment.
func extractSecretValues(runtimeEnv map[string]any) []string {
	var secrets []string
	for _, envValue := range runtimeEnv {
		if valueMap, ok := envValue.(map[string]interface{}); ok {
			// Only extract if marked as secret
			if isSecret, _ := valueMap["is_secret"].(bool); isSecret {
				if val, ok := valueMap["value"].(string); ok {
					secrets = append(secrets, val)
				}
			}
		}
	}
	return secrets
}

// scanForSecrets recursively scans objects for secret values.
func scanForSecrets(obj interface{}, secretValues []string, warnings *[]string) {
	switch v := obj.(type) {
	case string:
		// Check if string contains any secret values
		for _, secret := range secretValues {
			if strings.Contains(v, secret) {
				*warnings = append(*warnings, fmt.Sprintf("Output contains secret value"))
				return // Stop after first match to avoid duplicates
			}
		}

	case map[string]interface{}:
		// Recursively scan map values
		for _, val := range v {
			scanForSecrets(val, secretValues, warnings)
		}

	case []interface{}:
		// Recursively scan array elements
		for _, val := range v {
			scanForSecrets(val, secretValues, warnings)
		}

	default:
		// Non-string, non-container types - nothing to scan
	}
}
