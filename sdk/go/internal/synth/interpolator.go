package synth

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// InterpolateVariables resolves ${variableName} placeholders in a task configuration
// with actual values from the context variables map.
//
// This implements compile-time variable resolution: instead of generating a SET task
// and resolving variables at runtime, we resolve them during synthesis and bake
// the values directly into the task configuration.
//
// Process:
// 1. Convert task config to JSON
// 2. Find all ${variableName} placeholders
// 3. Replace placeholders with actual values from contextVars
// 4. Convert back to map[string]interface{} for protobuf serialization
//
// Example:
//   Input config:  {"url": "${baseURL}/users"}
//   Context vars:  {"baseURL": "https://api.example.com"}
//   Output config: {"url": "https://api.example.com/users"}
//
// Note: This function does NOT resolve JQ expressions like ${ $context.apiURL }.
// Those are runtime expressions that should be evaluated by the workflow runner.
// This function ONLY resolves simple ${variableName} references to compile-time values.
func InterpolateVariables(taskConfig interface{}, contextVars map[string]interface{}) (map[string]interface{}, error) {
	// 1. Convert config to JSON bytes
	jsonBytes, err := json.Marshal(taskConfig)
	if err != nil {
		return nil, fmt.Errorf("marshaling task config to JSON: %w", err)
	}

	// 2. Perform variable replacement
	jsonString := string(jsonBytes)
	
	// Create a map of values to replace
	// We need to extract actual values from Ref interfaces
	values := make(map[string]interface{}, len(contextVars))
	for name, refInterface := range contextVars {
		// Extract the actual value from the Ref using ToValue()
		type valueExtractor interface {
			ToValue() interface{}
		}
		
		if ref, ok := refInterface.(valueExtractor); ok {
			values[name] = ref.ToValue()
		} else {
			// Fallback: use the value as-is
			values[name] = refInterface
		}
	}
	
	// Replace each variable placeholder with its actual value
	// We need to be careful about JSON encoding - strings need quotes, numbers don't
	jsonString, err = replaceVariablePlaceholders(jsonString, values)
	if err != nil {
		return nil, fmt.Errorf("replacing variable placeholders: %w", err)
	}

	// 3. Convert back to map for google.protobuf.Struct compatibility
	var result map[string]interface{}
	if err := json.Unmarshal([]byte(jsonString), &result); err != nil {
		return nil, fmt.Errorf("unmarshaling interpolated JSON: %w", err)
	}

	return result, nil
}

// replaceVariablePlaceholders replaces ${variableName} placeholders in a JSON string
// with actual values, handling proper JSON encoding for different types.
//
// Strategy:
// 1. Replace complete value placeholders: "${var}" → actual value (preserving type)
// 2. Replace partial string placeholders: "prefix${var}suffix" → "prefix<value>suffix"
//
// Examples:
// - Complete: "${retries}" → 3 (number), "${enabled}" → true (bool)
// - Partial:  "${baseURL}/users" → "https://api.example.com/users" (string)
// - Complete string: "${apiKey}" → "secret-key-123" (string)
func replaceVariablePlaceholders(jsonString string, values map[string]interface{}) (string, error) {
	// Track any missing variables for error reporting
	var missingVars []string
	
	// Step 1: Replace complete value placeholders: "${var}" (quoted, nothing else)
	// This preserves the type (numbers, bools, objects, arrays)
	completeValueRegex := regexp.MustCompile(`"\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}"`)
	result := completeValueRegex.ReplaceAllStringFunc(jsonString, func(match string) string {
		// Extract variable name: "${var}" → var
		varName := match[3 : len(match)-2] // Remove "${ and }"
		
		// Look up value
		value, exists := values[varName]
		if !exists {
			missingVars = append(missingVars, varName)
			return match
		}
		
		// Convert to JSON (preserves type)
		valueJSON, err := json.Marshal(value)
		if err != nil {
			missingVars = append(missingVars, fmt.Sprintf("%s (marshal error: %v)", varName, err))
			return match
		}
		
		// Return JSON value as-is (e.g., 3, true, {"key": "value"}, "string value")
		return string(valueJSON)
	})
	
	// Step 2: Replace partial string placeholders: ${var} (not complete value)
	// This unwraps string quotes to blend into the surrounding string
	partialValueRegex := regexp.MustCompile(`\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}`)
	result = partialValueRegex.ReplaceAllStringFunc(result, func(match string) string {
		// Extract variable name: ${var} → var
		varName := match[2 : len(match)-1] // Remove ${ and }
		
		// Look up value
		value, exists := values[varName]
		if !exists {
			missingVars = append(missingVars, varName)
			return match
		}
		
		// Convert to JSON
		valueJSON, err := json.Marshal(value)
		if err != nil {
			missingVars = append(missingVars, fmt.Sprintf("%s (marshal error: %v)", varName, err))
			return match
		}
		
		// For strings, unwrap the JSON quotes so they blend into surrounding string
		// For non-strings, this shouldn't happen (already handled by complete value regex)
		valueStr := string(valueJSON)
		if _, ok := value.(string); ok {
			valueStr = strings.Trim(valueStr, `"`)
		}
		
		return valueStr
	})
	
	// Report errors if any variables were missing
	if len(missingVars) > 0 {
		return "", fmt.Errorf("missing or invalid context variables: %s", strings.Join(missingVars, ", "))
	}
	
	return result, nil
}

// shouldInterpolate determines if a task configuration should have variable interpolation applied.
// 
// Some task kinds may have special handling or may not need interpolation.
// For now, we apply interpolation to all task kinds.
//
// Future: We might skip interpolation for tasks that explicitly use JQ runtime expressions.
func shouldInterpolate(taskKind string) bool {
	// For now, interpolate all tasks
	return true
}
