package envfile

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// ParseLine Tests
// =============================================================================

func TestParseLine_BasicKeyValue(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantKey   string
		wantValue string
		wantErr   bool
	}{
		{
			name:      "simple key value",
			input:     "API_KEY=abc123",
			wantKey:   "API_KEY",
			wantValue: "abc123",
		},
		{
			name:      "value with equals sign",
			input:     "URL=https://example.com?foo=bar",
			wantKey:   "URL",
			wantValue: "https://example.com?foo=bar",
		},
		{
			name:      "empty value",
			input:     "EMPTY_VAR=",
			wantKey:   "EMPTY_VAR",
			wantValue: "",
		},
		{
			name:      "key with underscore",
			input:     "MY_API_KEY=value",
			wantKey:   "MY_API_KEY",
			wantValue: "value",
		},
		{
			name:      "key starting with underscore",
			input:     "_PRIVATE_KEY=secret",
			wantKey:   "_PRIVATE_KEY",
			wantValue: "secret",
		},
		{
			name:      "numeric value",
			input:     "PORT=8080",
			wantKey:   "PORT",
			wantValue: "8080",
		},
		{
			name:      "value with spaces",
			input:     "MESSAGE=hello world",
			wantKey:   "MESSAGE",
			wantValue: "hello world",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key, value, err := ParseLine(tt.input)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantKey, key)
			assert.Equal(t, tt.wantValue, value)
		})
	}
}

func TestParseLine_QuotedValues(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantKey   string
		wantValue string
	}{
		{
			name:      "double quoted value",
			input:     `MESSAGE="hello world"`,
			wantKey:   "MESSAGE",
			wantValue: "hello world",
		},
		{
			name:      "single quoted value",
			input:     `MESSAGE='hello world'`,
			wantKey:   "MESSAGE",
			wantValue: "hello world",
		},
		{
			name:      "quoted value with leading/trailing spaces",
			input:     `MESSAGE="  spaced  "`,
			wantKey:   "MESSAGE",
			wantValue: "  spaced  ",
		},
		{
			name:      "quoted value with newline escape",
			input:     `MESSAGE="line1\nline2"`,
			wantKey:   "MESSAGE",
			wantValue: "line1\nline2",
		},
		{
			name:      "quoted value with tab escape",
			input:     `MESSAGE="col1\tcol2"`,
			wantKey:   "MESSAGE",
			wantValue: "col1\tcol2",
		},
		{
			name:      "quoted value with escaped quote",
			input:     `MESSAGE="say \"hello\""`,
			wantKey:   "MESSAGE",
			wantValue: `say "hello"`,
		},
		{
			name:      "quoted value with escaped backslash",
			input:     `PATH="C:\\Users\\test"`,
			wantKey:   "PATH",
			wantValue: `C:\Users\test`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key, value, err := ParseLine(tt.input)
			require.NoError(t, err)
			assert.Equal(t, tt.wantKey, key)
			assert.Equal(t, tt.wantValue, value)
		})
	}
}

func TestParseLine_CommentsAndEmptyLines(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantKey string
	}{
		{
			name:    "comment line",
			input:   "# This is a comment",
			wantKey: "",
		},
		{
			name:    "empty line",
			input:   "",
			wantKey: "",
		},
		{
			name:    "whitespace only line",
			input:   "   \t  ",
			wantKey: "",
		},
		{
			name:    "comment with leading whitespace",
			input:   "  # Indented comment",
			wantKey: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key, _, err := ParseLine(tt.input)
			require.NoError(t, err)
			assert.Equal(t, tt.wantKey, key)
		})
	}
}

func TestParseLine_ExportPrefix(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		wantKey   string
		wantValue string
	}{
		{
			name:      "export prefix",
			input:     "export API_KEY=value",
			wantKey:   "API_KEY",
			wantValue: "value",
		},
		{
			name:      "export with quoted value",
			input:     `export MESSAGE="hello world"`,
			wantKey:   "MESSAGE",
			wantValue: "hello world",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key, value, err := ParseLine(tt.input)
			require.NoError(t, err)
			assert.Equal(t, tt.wantKey, key)
			assert.Equal(t, tt.wantValue, value)
		})
	}
}

func TestParseLine_InvalidFormats(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantErrMsg string
	}{
		{
			name:       "missing equals sign",
			input:      "INVALID_LINE",
			wantErrMsg: "missing '=' separator",
		},
		{
			name:       "empty key",
			input:      "=value",
			wantErrMsg: "empty key",
		},
		{
			name:       "key starting with number",
			input:      "123KEY=value",
			wantErrMsg: "invalid key",
		},
		{
			name:       "key with special characters",
			input:      "MY-KEY=value",
			wantErrMsg: "invalid key",
		},
		{
			name:       "key with space",
			input:      "MY KEY=value",
			wantErrMsg: "invalid key",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, _, err := ParseLine(tt.input)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErrMsg)
		})
	}
}

// =============================================================================
// ParseFlags Tests (non-secrets)
// =============================================================================

func TestParseFlags(t *testing.T) {
	tests := []struct {
		name    string
		input   []string
		want    map[string]string
		wantErr bool
	}{
		{
			name:  "single flag",
			input: []string{"API_KEY=abc123"},
			want:  map[string]string{"API_KEY": "abc123"},
		},
		{
			name:  "multiple flags",
			input: []string{"API_KEY=abc", "DEBUG=true"},
			want:  map[string]string{"API_KEY": "abc", "DEBUG": "true"},
		},
		{
			name:    "invalid format",
			input:   []string{"INVALID"},
			wantErr: true,
		},
		{
			name:    "empty flag treated as invalid",
			input:   []string{""},
			wantErr: true,
		},
		{
			name:    "comment treated as invalid in flags",
			input:   []string{"# comment"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ParseFlags(tt.input)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)

			for key, expectedValue := range tt.want {
				require.Contains(t, result, key)
				assert.Equal(t, expectedValue, result[key].Value)
				assert.False(t, result[key].IsSecret, "ParseFlags should mark all values as non-secret")
			}
		})
	}
}

// =============================================================================
// ParseFlagsAsSecrets Tests
// =============================================================================

func TestParseFlagsAsSecrets(t *testing.T) {
	tests := []struct {
		name    string
		input   []string
		want    map[string]string
		wantErr bool
	}{
		{
			name:  "single secret flag",
			input: []string{"DB_PASSWORD=supersecret"},
			want:  map[string]string{"DB_PASSWORD": "supersecret"},
		},
		{
			name:  "multiple secret flags",
			input: []string{"DB_PASSWORD=secret1", "API_KEY=secret2"},
			want:  map[string]string{"DB_PASSWORD": "secret1", "API_KEY": "secret2"},
		},
		{
			name:    "invalid format",
			input:   []string{"INVALID"},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := ParseFlagsAsSecrets(tt.input)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)

			for key, expectedValue := range tt.want {
				require.Contains(t, result, key)
				assert.Equal(t, expectedValue, result[key].Value)
				assert.True(t, result[key].IsSecret, "ParseFlagsAsSecrets should mark all values as secret")
			}
		})
	}
}

// =============================================================================
// ParseFile Tests (non-secrets)
// =============================================================================

func TestParseFile(t *testing.T) {
	tmpDir := t.TempDir()

	t.Run("valid env file", func(t *testing.T) {
		content := `# Database configuration
DB_HOST=localhost
DB_PORT=5432

# API settings
API_KEY="my-api-key"
DEBUG=true
`
		path := filepath.Join(tmpDir, "valid.env")
		err := os.WriteFile(path, []byte(content), 0644)
		require.NoError(t, err)

		result, err := ParseFile(path)
		require.NoError(t, err)

		assert.Len(t, result, 4)
		assert.Equal(t, "localhost", result["DB_HOST"].Value)
		assert.False(t, result["DB_HOST"].IsSecret)
		assert.Equal(t, "5432", result["DB_PORT"].Value)
		assert.False(t, result["DB_PORT"].IsSecret)
		assert.Equal(t, "my-api-key", result["API_KEY"].Value)
		assert.False(t, result["API_KEY"].IsSecret)
		assert.Equal(t, "true", result["DEBUG"].Value)
		assert.False(t, result["DEBUG"].IsSecret)
	})

	t.Run("file not found", func(t *testing.T) {
		_, err := ParseFile(filepath.Join(tmpDir, "nonexistent.env"))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to open environment file")
	})

	t.Run("file with invalid line", func(t *testing.T) {
		content := `VALID=value
INVALID_LINE
`
		path := filepath.Join(tmpDir, "invalid.env")
		err := os.WriteFile(path, []byte(content), 0644)
		require.NoError(t, err)

		_, err = ParseFile(path)
		require.Error(t, err)

		parseErr, ok := err.(*ParseError)
		require.True(t, ok)
		assert.Equal(t, 2, parseErr.Line)
		assert.Contains(t, parseErr.Message, "missing '=' separator")
	})

	t.Run("empty file", func(t *testing.T) {
		path := filepath.Join(tmpDir, "empty.env")
		err := os.WriteFile(path, []byte(""), 0644)
		require.NoError(t, err)

		result, err := ParseFile(path)
		require.NoError(t, err)
		assert.Empty(t, result)
	})

	t.Run("comments only file", func(t *testing.T) {
		content := `# Comment 1
# Comment 2

# Comment 3
`
		path := filepath.Join(tmpDir, "comments.env")
		err := os.WriteFile(path, []byte(content), 0644)
		require.NoError(t, err)

		result, err := ParseFile(path)
		require.NoError(t, err)
		assert.Empty(t, result)
	})
}

// =============================================================================
// ParseFileAsSecrets Tests
// =============================================================================

func TestParseFileAsSecrets(t *testing.T) {
	tmpDir := t.TempDir()

	t.Run("valid secrets file", func(t *testing.T) {
		content := `# Database secrets
DB_PASSWORD=supersecret
API_KEY=ghp_abc123
`
		path := filepath.Join(tmpDir, "secrets.env")
		err := os.WriteFile(path, []byte(content), 0644)
		require.NoError(t, err)

		result, err := ParseFileAsSecrets(path)
		require.NoError(t, err)

		assert.Len(t, result, 2)
		assert.Equal(t, "supersecret", result["DB_PASSWORD"].Value)
		assert.True(t, result["DB_PASSWORD"].IsSecret, "All values should be marked as secret")
		assert.Equal(t, "ghp_abc123", result["API_KEY"].Value)
		assert.True(t, result["API_KEY"].IsSecret, "All values should be marked as secret")
	})

	t.Run("file not found", func(t *testing.T) {
		_, err := ParseFileAsSecrets(filepath.Join(tmpDir, "nonexistent.env"))
		require.Error(t, err)
		assert.Contains(t, err.Error(), "failed to open environment file")
	})
}

// =============================================================================
// MergeEnvSources Tests
// =============================================================================

func TestMergeEnvSources(t *testing.T) {
	t.Run("single source", func(t *testing.T) {
		source := EnvMap{
			"KEY1": {Value: "value1", IsSecret: false},
		}

		result := MergeEnvSources(source)
		assert.Len(t, result, 1)
		assert.Equal(t, "value1", result["KEY1"].Value)
	})

	t.Run("multiple sources with override", func(t *testing.T) {
		source1 := EnvMap{
			"KEY1": {Value: "value1", IsSecret: false},
			"KEY2": {Value: "value2", IsSecret: false},
		}
		source2 := EnvMap{
			"KEY2": {Value: "override2", IsSecret: true},
			"KEY3": {Value: "value3", IsSecret: false},
		}

		result := MergeEnvSources(source1, source2)
		assert.Len(t, result, 3)
		assert.Equal(t, "value1", result["KEY1"].Value)
		assert.Equal(t, "override2", result["KEY2"].Value)
		assert.True(t, result["KEY2"].IsSecret)
		assert.Equal(t, "value3", result["KEY3"].Value)
	})

	t.Run("empty sources", func(t *testing.T) {
		result := MergeEnvSources()
		assert.Empty(t, result)
	})

	t.Run("nil sources handled", func(t *testing.T) {
		source1 := EnvMap{
			"KEY1": {Value: "value1", IsSecret: false},
		}

		result := MergeEnvSources(source1, nil)
		assert.Len(t, result, 1)
		assert.Equal(t, "value1", result["KEY1"].Value)
	})

	t.Run("later source wins", func(t *testing.T) {
		source1 := EnvMap{
			"API_KEY": {Value: "first", IsSecret: false},
		}
		source2 := EnvMap{
			"API_KEY": {Value: "second", IsSecret: false},
		}
		source3 := EnvMap{
			"API_KEY": {Value: "third", IsSecret: true},
		}

		result := MergeEnvSources(source1, source2, source3)
		assert.Equal(t, "third", result["API_KEY"].Value)
		assert.True(t, result["API_KEY"].IsSecret)
	})
}

// =============================================================================
// LoadAndMergeWithSecrets Tests
// =============================================================================

func TestLoadAndMergeWithSecrets(t *testing.T) {
	tmpDir := t.TempDir()

	// Create test files
	envDefaultsContent := `API_URL=https://api.default.com
DEBUG=false
LOG_LEVEL=info
`
	envLocalContent := `DEBUG=true
API_URL=https://api.local.com
`
	secretsContent := `DB_PASSWORD=file-secret-password
API_KEY=file-api-key
`
	envDefaultsPath := filepath.Join(tmpDir, ".env.defaults")
	envLocalPath := filepath.Join(tmpDir, ".env.local")
	secretsPath := filepath.Join(tmpDir, ".env.secret")

	err := os.WriteFile(envDefaultsPath, []byte(envDefaultsContent), 0644)
	require.NoError(t, err)
	err = os.WriteFile(envLocalPath, []byte(envLocalContent), 0644)
	require.NoError(t, err)
	err = os.WriteFile(secretsPath, []byte(secretsContent), 0644)
	require.NoError(t, err)

	t.Run("env files only", func(t *testing.T) {
		result, err := LoadAndMergeWithSecrets(
			[]string{envDefaultsPath, envLocalPath}, // env files
			nil,                                     // secret files
			nil,                                     // env flags
			nil,                                     // secret flags
		)
		require.NoError(t, err)

		assert.Equal(t, "https://api.local.com", result["API_URL"].Value) // Later file wins
		assert.False(t, result["API_URL"].IsSecret)
		assert.Equal(t, "true", result["DEBUG"].Value) // Override from local
		assert.False(t, result["DEBUG"].IsSecret)
		assert.Equal(t, "info", result["LOG_LEVEL"].Value)
		assert.False(t, result["LOG_LEVEL"].IsSecret)
	})

	t.Run("env files with secret files", func(t *testing.T) {
		result, err := LoadAndMergeWithSecrets(
			[]string{envDefaultsPath}, // env files
			[]string{secretsPath},     // secret files
			nil,                       // env flags
			nil,                       // secret flags
		)
		require.NoError(t, err)

		// Env file values (non-secrets)
		assert.Equal(t, "https://api.default.com", result["API_URL"].Value)
		assert.False(t, result["API_URL"].IsSecret)

		// Secret file values (secrets)
		assert.Equal(t, "file-secret-password", result["DB_PASSWORD"].Value)
		assert.True(t, result["DB_PASSWORD"].IsSecret)
		assert.Equal(t, "file-api-key", result["API_KEY"].Value)
		assert.True(t, result["API_KEY"].IsSecret)
	})

	t.Run("flags override files", func(t *testing.T) {
		result, err := LoadAndMergeWithSecrets(
			[]string{envDefaultsPath},                      // env files
			[]string{secretsPath},                          // secret files
			[]string{"API_URL=https://api.override.com"},   // env flags
			[]string{"DB_PASSWORD=flag-override-password"}, // secret flags
		)
		require.NoError(t, err)

		// Env flag overrides env file
		assert.Equal(t, "https://api.override.com", result["API_URL"].Value)
		assert.False(t, result["API_URL"].IsSecret)

		// Secret flag overrides secret file
		assert.Equal(t, "flag-override-password", result["DB_PASSWORD"].Value)
		assert.True(t, result["DB_PASSWORD"].IsSecret)
	})

	t.Run("flags only", func(t *testing.T) {
		result, err := LoadAndMergeWithSecrets(
			nil,                                    // env files
			nil,                                    // secret files
			[]string{"KEY1=value1", "KEY2=value2"}, // env flags
			[]string{"SECRET1=secret1"},            // secret flags
		)
		require.NoError(t, err)

		assert.Len(t, result, 3)
		assert.Equal(t, "value1", result["KEY1"].Value)
		assert.False(t, result["KEY1"].IsSecret)
		assert.Equal(t, "value2", result["KEY2"].Value)
		assert.False(t, result["KEY2"].IsSecret)
		assert.Equal(t, "secret1", result["SECRET1"].Value)
		assert.True(t, result["SECRET1"].IsSecret)
	})

	t.Run("nonexistent env file", func(t *testing.T) {
		_, err := LoadAndMergeWithSecrets(
			[]string{filepath.Join(tmpDir, "nonexistent.env")},
			nil, nil, nil,
		)
		require.Error(t, err)
	})

	t.Run("nonexistent secret file", func(t *testing.T) {
		_, err := LoadAndMergeWithSecrets(
			nil,
			[]string{filepath.Join(tmpDir, "nonexistent.secret")},
			nil, nil,
		)
		require.Error(t, err)
	})

	t.Run("invalid env flag", func(t *testing.T) {
		_, err := LoadAndMergeWithSecrets(nil, nil, []string{"INVALID"}, nil)
		require.Error(t, err)
	})

	t.Run("invalid secret flag", func(t *testing.T) {
		_, err := LoadAndMergeWithSecrets(nil, nil, nil, []string{"INVALID"})
		require.Error(t, err)
	})

	t.Run("precedence order", func(t *testing.T) {
		// Same key in all sources - verify precedence
		envContent := `SHARED_KEY=from-env-file
`
		secretContent := `SHARED_KEY=from-secret-file
`
		envPath := filepath.Join(tmpDir, ".env.precedence")
		secretPath := filepath.Join(tmpDir, ".secret.precedence")

		err := os.WriteFile(envPath, []byte(envContent), 0644)
		require.NoError(t, err)
		err = os.WriteFile(secretPath, []byte(secretContent), 0644)
		require.NoError(t, err)

		result, err := LoadAndMergeWithSecrets(
			[]string{envPath},                       // env files (lowest)
			[]string{secretPath},                    // secret files
			[]string{"SHARED_KEY=from-env-flag"},    // env flags
			[]string{"SHARED_KEY=from-secret-flag"}, // secret flags (highest)
		)
		require.NoError(t, err)

		// Secret flags have highest precedence
		assert.Equal(t, "from-secret-flag", result["SHARED_KEY"].Value)
		assert.True(t, result["SHARED_KEY"].IsSecret)
	})
}

// =============================================================================
// CopyEnvMap Tests
// =============================================================================

func TestCopyEnvMap(t *testing.T) {
	t.Run("copy non-nil map", func(t *testing.T) {
		original := EnvMap{
			"KEY1": {Value: "value1", IsSecret: false},
			"KEY2": {Value: "value2", IsSecret: true},
		}

		copied := CopyEnvMap(original)

		// Verify values are equal
		assert.Equal(t, original["KEY1"].Value, copied["KEY1"].Value)
		assert.Equal(t, original["KEY2"].Value, copied["KEY2"].Value)

		// Verify it's a deep copy (modifying copy doesn't affect original)
		copied["KEY1"].Value = "modified"
		assert.Equal(t, "value1", original["KEY1"].Value)
	})

	t.Run("copy nil map", func(t *testing.T) {
		result := CopyEnvMap(nil)
		assert.Nil(t, result)
	})

	t.Run("copy empty map", func(t *testing.T) {
		original := EnvMap{}
		copied := CopyEnvMap(original)
		assert.Empty(t, copied)
	})
}

// =============================================================================
// ParseError Tests
// =============================================================================

func TestParseError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      *ParseError
		expected string
	}{
		{
			name: "with file and line",
			err: &ParseError{
				File:    ".env",
				Line:    5,
				Message: "invalid format",
			},
			expected: "failed to parse .env at line 5: invalid format",
		},
		{
			name: "with file only",
			err: &ParseError{
				File:    ".env",
				Message: "file error",
			},
			expected: "failed to parse .env: file error",
		},
		{
			name: "message only",
			err: &ParseError{
				Message: "generic error",
			},
			expected: "generic error",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, tt.err.Error())
		})
	}
}

// =============================================================================
// isValidEnvKey Tests
// =============================================================================

func TestIsValidEnvKey(t *testing.T) {
	tests := []struct {
		key   string
		valid bool
	}{
		{"API_KEY", true},
		{"api_key", true},
		{"_PRIVATE", true},
		{"Key123", true},
		{"A", true},
		{"_", true},
		{"", false},
		{"123KEY", false},
		{"MY-KEY", false},
		{"MY KEY", false},
		{"KEY!", false},
		{"KEY.NAME", false},
	}

	for _, tt := range tests {
		t.Run(tt.key, func(t *testing.T) {
			assert.Equal(t, tt.valid, isValidEnvKey(tt.key))
		})
	}
}
