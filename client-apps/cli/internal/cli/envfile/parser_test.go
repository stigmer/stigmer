package envfile

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
			key, value, isSecret, err := ParseLine(tt.input)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantKey, key)
			assert.Equal(t, tt.wantValue, value)
			assert.False(t, isSecret)
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
			key, value, _, err := ParseLine(tt.input)
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
			key, _, _, err := ParseLine(tt.input)
			require.NoError(t, err)
			assert.Equal(t, tt.wantKey, key)
		})
	}
}

func TestParseLine_SecretPrefix(t *testing.T) {
	tests := []struct {
		name       string
		input      string
		wantKey    string
		wantValue  string
		wantSecret bool
	}{
		{
			name:       "secret prefixed value",
			input:      "secret:DB_PASSWORD=supersecret",
			wantKey:    "DB_PASSWORD",
			wantValue:  "supersecret",
			wantSecret: true,
		},
		{
			name:       "secret with quoted value",
			input:      `secret:API_KEY="my-secret-key"`,
			wantKey:    "API_KEY",
			wantValue:  "my-secret-key",
			wantSecret: true,
		},
		{
			name:       "non-secret value",
			input:      "DEBUG=true",
			wantKey:    "DEBUG",
			wantValue:  "true",
			wantSecret: false,
		},
		{
			name:       "value containing secret: in value",
			input:      "MESSAGE=the secret: is here",
			wantKey:    "MESSAGE",
			wantValue:  "the secret: is here",
			wantSecret: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key, value, isSecret, err := ParseLine(tt.input)
			require.NoError(t, err)
			assert.Equal(t, tt.wantKey, key)
			assert.Equal(t, tt.wantValue, value)
			assert.Equal(t, tt.wantSecret, isSecret)
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
			name:      "export with secret",
			input:     "secret:export DB_PASS=secret",
			wantKey:   "DB_PASS",
			wantValue: "secret",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key, value, _, err := ParseLine(tt.input)
			require.NoError(t, err)
			assert.Equal(t, tt.wantKey, key)
			assert.Equal(t, tt.wantValue, value)
		})
	}
}

func TestParseLine_InvalidFormats(t *testing.T) {
	tests := []struct {
		name        string
		input       string
		wantErrMsg  string
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
			_, _, _, err := ParseLine(tt.input)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.wantErrMsg)
		})
	}
}

func TestParseFlags(t *testing.T) {
	tests := []struct {
		name    string
		input   []string
		want    map[string]struct{ value string; secret bool }
		wantErr bool
	}{
		{
			name:  "single flag",
			input: []string{"API_KEY=abc123"},
			want: map[string]struct{ value string; secret bool }{
				"API_KEY": {value: "abc123", secret: false},
			},
		},
		{
			name:  "multiple flags",
			input: []string{"API_KEY=abc", "DEBUG=true"},
			want: map[string]struct{ value string; secret bool }{
				"API_KEY": {value: "abc", secret: false},
				"DEBUG":   {value: "true", secret: false},
			},
		},
		{
			name:  "with secrets",
			input: []string{"API_KEY=abc", "secret:DB_PASS=secret"},
			want: map[string]struct{ value string; secret bool }{
				"API_KEY": {value: "abc", secret: false},
				"DB_PASS": {value: "secret", secret: true},
			},
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

			for key, expected := range tt.want {
				require.Contains(t, result, key)
				assert.Equal(t, expected.value, result[key].Value)
				assert.Equal(t, expected.secret, result[key].IsSecret)
			}
		})
	}
}

func TestParseFile(t *testing.T) {
	// Create temp directory
	tmpDir := t.TempDir()

	t.Run("valid env file", func(t *testing.T) {
		content := `# Database configuration
DB_HOST=localhost
DB_PORT=5432
secret:DB_PASSWORD=supersecret

# API settings
API_KEY="my-api-key"
DEBUG=true
`
		path := filepath.Join(tmpDir, "valid.env")
		err := os.WriteFile(path, []byte(content), 0644)
		require.NoError(t, err)

		result, err := ParseFile(path)
		require.NoError(t, err)

		assert.Len(t, result, 5)
		assert.Equal(t, "localhost", result["DB_HOST"].Value)
		assert.Equal(t, "5432", result["DB_PORT"].Value)
		assert.Equal(t, "supersecret", result["DB_PASSWORD"].Value)
		assert.True(t, result["DB_PASSWORD"].IsSecret)
		assert.Equal(t, "my-api-key", result["API_KEY"].Value)
		assert.Equal(t, "true", result["DEBUG"].Value)
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

func TestLoadAndMerge(t *testing.T) {
	tmpDir := t.TempDir()

	// Create test files
	defaultsContent := `API_KEY=default-key
DEBUG=false
LOG_LEVEL=info
`
	localContent := `DEBUG=true
secret:DB_PASSWORD=local-password
`
	defaultsPath := filepath.Join(tmpDir, ".env.defaults")
	localPath := filepath.Join(tmpDir, ".env.local")

	err := os.WriteFile(defaultsPath, []byte(defaultsContent), 0644)
	require.NoError(t, err)
	err = os.WriteFile(localPath, []byte(localContent), 0644)
	require.NoError(t, err)

	t.Run("files only", func(t *testing.T) {
		result, err := LoadAndMerge([]string{defaultsPath, localPath}, nil)
		require.NoError(t, err)

		assert.Equal(t, "default-key", result["API_KEY"].Value)
		assert.Equal(t, "true", result["DEBUG"].Value) // Override from local
		assert.Equal(t, "info", result["LOG_LEVEL"].Value)
		assert.Equal(t, "local-password", result["DB_PASSWORD"].Value)
		assert.True(t, result["DB_PASSWORD"].IsSecret)
	})

	t.Run("files with flag override", func(t *testing.T) {
		flags := []string{"API_KEY=flag-override", "secret:NEW_KEY=new-value"}

		result, err := LoadAndMerge([]string{defaultsPath, localPath}, flags)
		require.NoError(t, err)

		assert.Equal(t, "flag-override", result["API_KEY"].Value) // Flag wins
		assert.Equal(t, "true", result["DEBUG"].Value)
		assert.Equal(t, "new-value", result["NEW_KEY"].Value)
		assert.True(t, result["NEW_KEY"].IsSecret)
	})

	t.Run("flags only", func(t *testing.T) {
		flags := []string{"KEY1=value1", "KEY2=value2"}

		result, err := LoadAndMerge(nil, flags)
		require.NoError(t, err)

		assert.Len(t, result, 2)
		assert.Equal(t, "value1", result["KEY1"].Value)
		assert.Equal(t, "value2", result["KEY2"].Value)
	})

	t.Run("nonexistent file", func(t *testing.T) {
		_, err := LoadAndMerge([]string{filepath.Join(tmpDir, "nonexistent.env")}, nil)
		require.Error(t, err)
	})

	t.Run("invalid flag", func(t *testing.T) {
		flags := []string{"INVALID"}
		_, err := LoadAndMerge(nil, flags)
		require.Error(t, err)
	})
}

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
