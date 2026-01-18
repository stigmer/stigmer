package synth

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockRef implements a simple Ref interface for testing
type mockRef struct {
	value interface{}
}

func (m *mockRef) ToValue() interface{} {
	return m.value
}

func TestInterpolateVariables_StringValues(t *testing.T) {
	// Setup
	taskConfig := map[string]interface{}{
		"url":     "${baseURL}/users",
		"timeout": 30,
	}

	contextVars := map[string]interface{}{
		"baseURL": &mockRef{value: "https://api.example.com"},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	assert.Equal(t, "https://api.example.com/users", result["url"])
	assert.Equal(t, float64(30), result["timeout"]) // JSON numbers are float64
}

func TestInterpolateVariables_IntegerValues(t *testing.T) {
	// Setup
	taskConfig := map[string]interface{}{
		"max_retries":    "${retries}",
		"timeout_seconds": 30,
	}

	contextVars := map[string]interface{}{
		"retries": &mockRef{value: 3},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	assert.Equal(t, float64(3), result["max_retries"]) // JSON numbers are float64
	assert.Equal(t, float64(30), result["timeout_seconds"])
}

func TestInterpolateVariables_BooleanValues(t *testing.T) {
	// Setup
	taskConfig := map[string]interface{}{
		"enabled": "${isProd}",
		"debug":   false,
	}

	contextVars := map[string]interface{}{
		"isProd": &mockRef{value: true},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	assert.Equal(t, true, result["enabled"])
	assert.Equal(t, false, result["debug"])
}

func TestInterpolateVariables_ObjectValues(t *testing.T) {
	// Setup
	taskConfig := map[string]interface{}{
		"database": "${dbConfig}",
	}

	contextVars := map[string]interface{}{
		"dbConfig": &mockRef{value: map[string]interface{}{
			"host": "localhost",
			"port": 5432,
		}},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	dbConfig, ok := result["database"].(map[string]interface{})
	require.True(t, ok, "database should be a map")
	assert.Equal(t, "localhost", dbConfig["host"])
	assert.Equal(t, float64(5432), dbConfig["port"]) // JSON numbers are float64
}

func TestInterpolateVariables_MultipleVariables(t *testing.T) {
	// Setup
	taskConfig := map[string]interface{}{
		"url":     "${baseURL}/api/v${version}",
		"retries": "${maxRetries}",
		"enabled": "${isEnabled}",
	}

	contextVars := map[string]interface{}{
		"baseURL":    &mockRef{value: "https://api.example.com"},
		"version":    &mockRef{value: "1"},
		"maxRetries": &mockRef{value: 3},
		"isEnabled":  &mockRef{value: true},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	assert.Equal(t, "https://api.example.com/api/v1", result["url"])
	assert.Equal(t, float64(3), result["retries"])
	assert.Equal(t, true, result["enabled"])
}

func TestInterpolateVariables_NestedObjects(t *testing.T) {
	// Setup
	taskConfig := map[string]interface{}{
		"endpoint": map[string]interface{}{
			"uri": "${baseURL}/users",
			"timeout": 30,
		},
		"headers": map[string]interface{}{
			"Authorization": "Bearer ${apiKey}",
		},
	}

	contextVars := map[string]interface{}{
		"baseURL": &mockRef{value: "https://api.example.com"},
		"apiKey":  &mockRef{value: "secret-key-123"},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	
	endpoint, ok := result["endpoint"].(map[string]interface{})
	require.True(t, ok, "endpoint should be a map")
	assert.Equal(t, "https://api.example.com/users", endpoint["uri"])
	
	headers, ok := result["headers"].(map[string]interface{})
	require.True(t, ok, "headers should be a map")
	assert.Equal(t, "Bearer secret-key-123", headers["Authorization"])
}

func TestInterpolateVariables_NoVariables(t *testing.T) {
	// Setup - no placeholders
	taskConfig := map[string]interface{}{
		"url":     "https://api.example.com/users",
		"timeout": 30,
	}

	contextVars := map[string]interface{}{
		"baseURL": &mockRef{value: "https://unused.com"},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	assert.Equal(t, "https://api.example.com/users", result["url"])
	assert.Equal(t, float64(30), result["timeout"])
}

func TestInterpolateVariables_EmptyContext(t *testing.T) {
	// Setup - no context variables
	taskConfig := map[string]interface{}{
		"url":     "https://api.example.com/users",
		"timeout": 30,
	}

	contextVars := map[string]interface{}{}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	assert.Equal(t, "https://api.example.com/users", result["url"])
	assert.Equal(t, float64(30), result["timeout"])
}

func TestInterpolateVariables_MissingVariable(t *testing.T) {
	// Setup - reference to undefined variable
	taskConfig := map[string]interface{}{
		"url": "${undefinedVar}/users",
	}

	contextVars := map[string]interface{}{
		"baseURL": &mockRef{value: "https://api.example.com"},
	}

	// Execute
	_, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.Error(t, err)
	assert.Contains(t, err.Error(), "missing or invalid context variables")
	assert.Contains(t, err.Error(), "undefinedVar")
}

func TestInterpolateVariables_PartialReplacement(t *testing.T) {
	// Setup - only some variables are replaced
	taskConfig := map[string]interface{}{
		"url":     "${baseURL}/v${version}/users",
		"timeout": 30,
	}

	contextVars := map[string]interface{}{
		"baseURL": &mockRef{value: "https://api.example.com"},
		"version": &mockRef{value: "2"},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	assert.Equal(t, "https://api.example.com/v2/users", result["url"])
}

func TestInterpolateVariables_SpecialCharactersInValues(t *testing.T) {
	// Setup - values with special characters
	taskConfig := map[string]interface{}{
		"password": "${dbPassword}",
		"url":      "${apiURL}",
	}

	contextVars := map[string]interface{}{
		"dbPassword": &mockRef{value: "p@ssw0rd!$#"},
		"apiURL":     &mockRef{value: "https://api.example.com/path?key=value&foo=bar"},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	assert.Equal(t, "p@ssw0rd!$#", result["password"])
	assert.Equal(t, "https://api.example.com/path?key=value&foo=bar", result["url"])
}

func TestInterpolateVariables_ArrayValues(t *testing.T) {
	// Setup - array/slice values
	taskConfig := map[string]interface{}{
		"tags": "${defaultTags}",
	}

	contextVars := map[string]interface{}{
		"defaultTags": &mockRef{value: []string{"prod", "api", "v1"}},
	}

	// Execute
	result, err := InterpolateVariables(taskConfig, contextVars)

	// Assert
	require.NoError(t, err)
	tags, ok := result["tags"].([]interface{})
	require.True(t, ok, "tags should be an array")
	assert.Len(t, tags, 3)
	assert.Equal(t, "prod", tags[0])
	assert.Equal(t, "api", tags[1])
	assert.Equal(t, "v1", tags[2])
}

func TestReplaceVariablePlaceholders_ValidCases(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		values    map[string]interface{}
		expected  string
		shouldErr bool
	}{
		{
			name:     "simple string replacement",
			input:    `{"url": "${baseURL}"}`,
			values:   map[string]interface{}{"baseURL": "https://api.example.com"},
			expected: `{"url": "https://api.example.com"}`,
		},
		{
			name:     "number replacement",
			input:    `{"retries": "${maxRetries}"}`,
			values:   map[string]interface{}{"maxRetries": 3},
			expected: `{"retries": 3}`,
		},
		{
			name:     "boolean replacement",
			input:    `{"enabled": "${isProd}"}`,
			values:   map[string]interface{}{"isProd": true},
			expected: `{"enabled": true}`,
		},
		{
			name:     "multiple replacements",
			input:    `{"url": "${baseURL}/v${version}"}`,
			values:   map[string]interface{}{"baseURL": "https://api.example.com", "version": "1"},
			expected: `{"url": "https://api.example.com/v1"}`,
		},
		{
			name:      "missing variable",
			input:     `{"url": "${missing}"}`,
			values:    map[string]interface{}{"baseURL": "https://api.example.com"},
			shouldErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := replaceVariablePlaceholders(tt.input, tt.values)
			
			if tt.shouldErr {
				assert.Error(t, err)
			} else {
				require.NoError(t, err)
				assert.JSONEq(t, tt.expected, result)
			}
		})
	}
}
