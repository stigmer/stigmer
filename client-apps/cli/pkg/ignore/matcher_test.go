package ignore

import (
	"os"
	"path/filepath"
	"testing"
)

func TestNew_Validation(t *testing.T) {
	t.Run("empty RootDir returns error", func(t *testing.T) {
		_, err := New(Options{})
		if err == nil {
			t.Error("expected error for empty RootDir")
		}
	})

	t.Run("non-existent RootDir returns error", func(t *testing.T) {
		_, err := New(Options{RootDir: "/nonexistent/path/that/does/not/exist"})
		if err == nil {
			t.Error("expected error for non-existent RootDir")
		}
	})

	t.Run("file as RootDir returns error", func(t *testing.T) {
		// Create a temp file
		f, err := os.CreateTemp("", "test")
		if err != nil {
			t.Fatal(err)
		}
		defer os.Remove(f.Name())
		f.Close()

		_, err = New(Options{RootDir: f.Name()})
		if err == nil {
			t.Error("expected error when RootDir is a file")
		}
	})

	t.Run("valid directory succeeds", func(t *testing.T) {
		dir := t.TempDir()
		m, err := New(Options{RootDir: dir})
		if err != nil {
			t.Errorf("unexpected error: %v", err)
		}
		if m == nil {
			t.Error("expected non-nil matcher")
		}
	})
}

func TestMatcher_DefaultPatterns(t *testing.T) {
	dir := t.TempDir()
	m, err := New(Options{
		RootDir:         dir,
		IncludeDefaults: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		path     string
		isDir    bool
		expected bool
	}{
		// Version control
		{"git directory", ".git/config", false, true},
		{"git root", ".git", true, true},
		{"svn directory", ".svn/entries", false, true},

		// Security - credentials
		{"env file", ".env", false, true},
		{"env local", ".env.local", false, true},
		{"env production", ".env.production", false, true},
		{"env example allowed", ".env.example", false, false},
		{"env template allowed", ".env.template", false, false},
		{"pem file", "certs/server.pem", false, true},
		{"key file", "secrets/private.key", false, true},
		{"credentials json", "credentials.json", false, true},
		{"service account", "service-account-key.json", false, true},

		// IDE
		{"idea directory", ".idea/workspace.xml", false, true},
		{"vscode directory", ".vscode/settings.json", false, true},
		{"vim swap", "file.swp", false, true},

		// OS
		{"DS_Store", ".DS_Store", false, true},
		{"Thumbs.db", "Thumbs.db", false, true},

		// Build artifacts
		{"node_modules", "node_modules/lodash/index.js", false, true},
		{"pycache", "__pycache__/module.pyc", false, true},
		{"pyc file", "utils.pyc", false, true},
		{"venv", ".venv/lib/python3.11/site.py", false, true},

		// Regular files should pass
		{"normal python", "main.py", false, false},
		{"normal js", "index.js", false, false},
		{"config yaml", "config.yaml", false, false},
		{"readme", "README.md", false, false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := m.Match(tt.path, tt.isDir)
			if result != tt.expected {
				t.Errorf("Match(%q, %v) = %v, want %v", tt.path, tt.isDir, result, tt.expected)
			}
		})
	}
}

func TestMatcher_NoDefaults(t *testing.T) {
	dir := t.TempDir()
	m, err := New(Options{
		RootDir:         dir,
		IncludeDefaults: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Without defaults, security files should NOT be ignored
	tests := []struct {
		path     string
		expected bool
	}{
		{".env", false},
		{".git/config", false},
		{"node_modules/package.json", false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if m.Match(tt.path, false) != tt.expected {
				t.Errorf("Match(%q) should be %v without defaults", tt.path, tt.expected)
			}
		})
	}
}

func TestMatcher_Gitignore(t *testing.T) {
	dir := t.TempDir()

	// Create .gitignore
	gitignore := `
# Build output
build/
dist/

# Test coverage
*.coverage

# Custom pattern
secret_config.yaml
`
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte(gitignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:          dir,
		RespectGitignore: true,
		IncludeDefaults:  false,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		path     string
		isDir    bool
		expected bool
	}{
		{"build/output.js", false, true},
		{"dist/bundle.js", false, true},
		{"test.coverage", false, true},
		{"secret_config.yaml", false, true},
		{"src/main.go", false, false},
		{"config.yaml", false, false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if m.Match(tt.path, tt.isDir) != tt.expected {
				t.Errorf("Match(%q) = %v, want %v", tt.path, m.Match(tt.path, tt.isDir), tt.expected)
			}
		})
	}
}

func TestMatcher_Stigmerignore(t *testing.T) {
	dir := t.TempDir()

	// Create .stigmerignore
	stigmerignore := `
# Stigmer-specific ignores
*.test.ts
docs/internal/
`
	if err := os.WriteFile(filepath.Join(dir, ".stigmerignore"), []byte(stigmerignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:         dir,
		IncludeDefaults: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		path     string
		isDir    bool
		expected bool
	}{
		{"utils.test.ts", false, true},
		{"src/component.test.ts", false, true},
		{"docs/internal/secret.md", false, true},
		{"docs/public/readme.md", false, false},
		{"main.ts", false, false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if m.Match(tt.path, tt.isDir) != tt.expected {
				t.Errorf("Match(%q) = %v, want %v", tt.path, m.Match(tt.path, tt.isDir), tt.expected)
			}
		})
	}
}

func TestMatcher_Precedence(t *testing.T) {
	dir := t.TempDir()

	// .gitignore excludes build/
	gitignore := `build/`
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte(gitignore), 0644); err != nil {
		t.Fatal(err)
	}

	// .stigmerignore re-includes build/important.txt
	stigmerignore := `!build/important.txt`
	if err := os.WriteFile(filepath.Join(dir, ".stigmerignore"), []byte(stigmerignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:          dir,
		RespectGitignore: true,
		IncludeDefaults:  false,
	})
	if err != nil {
		t.Fatal(err)
	}

	// build/ is ignored by gitignore
	if !m.Match("build/output.js", false) {
		t.Error("build/output.js should be ignored by .gitignore")
	}

	// build/important.txt is re-included by stigmerignore
	if m.Match("build/important.txt", false) {
		t.Error("build/important.txt should be included by .stigmerignore negation")
	}
}

func TestMatcher_CLIOverrides(t *testing.T) {
	dir := t.TempDir()

	// .stigmerignore ignores tests/
	stigmerignore := `tests/`
	if err := os.WriteFile(filepath.Join(dir, ".stigmerignore"), []byte(stigmerignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:         dir,
		IncludeDefaults: false,
		ExtraIgnore:     []string{"*.tmp"},
		ExtraInclude:    []string{"tests/critical.py"},
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		name     string
		path     string
		expected bool
	}{
		{"cli ignore tmp", "cache.tmp", true},
		{"stigmerignore tests", "tests/unit.py", true},
		{"cli include overrides", "tests/critical.py", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if m.Match(tt.path, false) != tt.expected {
				t.Errorf("Match(%q) = %v, want %v", tt.path, m.Match(tt.path, false), tt.expected)
			}
		})
	}
}

func TestMatcher_MatchWithReason(t *testing.T) {
	dir := t.TempDir()

	gitignore := `build/`
	if err := os.WriteFile(filepath.Join(dir, ".gitignore"), []byte(gitignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:          dir,
		RespectGitignore: true,
		IncludeDefaults:  true,
	})
	if err != nil {
		t.Fatal(err)
	}

	t.Run("default deny", func(t *testing.T) {
		result := m.MatchWithReason(".env", false)
		if !result.Ignored {
			t.Error("expected .env to be ignored")
		}
		if result.Reason != ReasonDefaultDeny {
			t.Errorf("expected ReasonDefaultDeny, got %v", result.Reason)
		}
		if result.Source != SourceDefaults {
			t.Errorf("expected source 'defaults', got %q", result.Source)
		}
	})

	t.Run("gitignore exclude", func(t *testing.T) {
		result := m.MatchWithReason("build/output.js", false)
		if !result.Ignored {
			t.Error("expected build/output.js to be ignored")
		}
		if result.Reason != ReasonExcluded {
			t.Errorf("expected ReasonExcluded, got %v", result.Reason)
		}
		if result.Source != SourceGitignore {
			t.Errorf("expected source '.gitignore', got %q", result.Source)
		}
	})

	t.Run("no match", func(t *testing.T) {
		result := m.MatchWithReason("main.go", false)
		if result.Ignored {
			t.Error("expected main.go to not be ignored")
		}
		if result.Reason != ReasonNoMatch {
			t.Errorf("expected ReasonNoMatch, got %v", result.Reason)
		}
	})
}

func TestMatcher_NegationPatterns(t *testing.T) {
	dir := t.TempDir()

	// Ignore all .log files except important.log
	stigmerignore := `
*.log
!important.log
`
	if err := os.WriteFile(filepath.Join(dir, ".stigmerignore"), []byte(stigmerignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:         dir,
		IncludeDefaults: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		path     string
		expected bool
	}{
		{"debug.log", true},
		{"error.log", true},
		{"important.log", false},
		{"main.py", false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if m.Match(tt.path, false) != tt.expected {
				t.Errorf("Match(%q) = %v, want %v", tt.path, m.Match(tt.path, false), tt.expected)
			}
		})
	}
}

func TestMatcher_DirectoryPatterns(t *testing.T) {
	dir := t.TempDir()

	stigmerignore := `
# Only ignore 'logs' if it's a directory
logs/
`
	if err := os.WriteFile(filepath.Join(dir, ".stigmerignore"), []byte(stigmerignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:         dir,
		IncludeDefaults: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	// Directory should be ignored
	if !m.Match("logs", true) {
		t.Error("logs directory should be ignored")
	}

	// Files inside logs directory should be ignored
	if !m.Match("logs/app.log", false) {
		t.Error("logs/app.log should be ignored")
	}
}

func TestMatcher_DoubleStarPatterns(t *testing.T) {
	dir := t.TempDir()

	stigmerignore := `
# Ignore all .cache directories anywhere
**/.cache/
# Ignore all test files anywhere
**/test_*.py
`
	if err := os.WriteFile(filepath.Join(dir, ".stigmerignore"), []byte(stigmerignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:         dir,
		IncludeDefaults: false,
	})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		path     string
		isDir    bool
		expected bool
	}{
		{".cache/data", false, true},
		{"src/.cache/temp", false, true},
		{"deep/nested/.cache/file", false, true},
		{"test_utils.py", false, true},
		{"src/test_models.py", false, true},
		{"deep/nested/test_api.py", false, true},
		{"utils.py", false, false},
		{"models.py", false, false},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			if m.Match(tt.path, tt.isDir) != tt.expected {
				t.Errorf("Match(%q) = %v, want %v", tt.path, m.Match(tt.path, tt.isDir), tt.expected)
			}
		})
	}
}

func TestMatcher_EdgeCases(t *testing.T) {
	dir := t.TempDir()
	m, err := NewWithDefaults(dir)
	if err != nil {
		t.Fatal(err)
	}

	t.Run("empty path", func(t *testing.T) {
		if m.Match("", false) {
			t.Error("empty path should not be ignored")
		}
	})

	t.Run("dot path", func(t *testing.T) {
		if m.Match(".", true) {
			t.Error("current directory should not be ignored")
		}
	})

	t.Run("leading dot-slash", func(t *testing.T) {
		// Should normalize and match properly
		if !m.Match("./.env", false) {
			t.Error("./.env should be ignored")
		}
	})

	t.Run("path with spaces", func(t *testing.T) {
		if m.Match("path with spaces/file.txt", false) {
			t.Error("path with spaces should not be ignored")
		}
	})

	t.Run("unicode path", func(t *testing.T) {
		if m.Match("日本語/ファイル.txt", false) {
			t.Error("unicode path should not be ignored by default")
		}
	})
}

func TestNewWithDefaults(t *testing.T) {
	dir := t.TempDir()
	m, err := NewWithDefaults(dir)
	if err != nil {
		t.Fatal(err)
	}

	// Should have defaults enabled
	if !m.Match(".env", false) {
		t.Error("NewWithDefaults should include security defaults")
	}

	// Should have loaded some patterns
	if m.PatternCount() == 0 {
		t.Error("expected patterns to be loaded")
	}
}

func TestMatcher_Patterns(t *testing.T) {
	dir := t.TempDir()

	stigmerignore := `*.log`
	if err := os.WriteFile(filepath.Join(dir, ".stigmerignore"), []byte(stigmerignore), 0644); err != nil {
		t.Fatal(err)
	}

	m, err := New(Options{
		RootDir:         dir,
		IncludeDefaults: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	patterns := m.Patterns()
	if len(patterns) == 0 {
		t.Error("expected patterns to be returned")
	}

	// Check that patterns include source info
	found := false
	for _, p := range patterns {
		if p == "[.stigmerignore] *.log" {
			found = true
			break
		}
	}
	if !found {
		t.Error("expected to find stigmerignore pattern in output")
	}
}

func TestReason_String(t *testing.T) {
	tests := []struct {
		reason   Reason
		expected string
	}{
		{ReasonNoMatch, "no pattern matched"},
		{ReasonExcluded, "excluded by pattern"},
		{ReasonIncluded, "included by negation pattern"},
		{ReasonDefaultDeny, "excluded by security default"},
		{Reason(999), "unknown reason (999)"},
	}

	for _, tt := range tests {
		t.Run(tt.expected, func(t *testing.T) {
			if tt.reason.String() != tt.expected {
				t.Errorf("got %q, want %q", tt.reason.String(), tt.expected)
			}
		})
	}
}

func TestMatchResult_String(t *testing.T) {
	t.Run("included no match", func(t *testing.T) {
		r := MatchResult{
			Path:    "file.txt",
			Ignored: false,
			Reason:  ReasonNoMatch,
		}
		expected := "INCLUDE file.txt (no pattern matched)"
		if r.String() != expected {
			t.Errorf("got %q, want %q", r.String(), expected)
		}
	})

	t.Run("ignored with pattern", func(t *testing.T) {
		r := MatchResult{
			Path:    ".env",
			Ignored: true,
			Reason:  ReasonDefaultDeny,
			Source:  "defaults",
			Pattern: ".env",
		}
		expected := "IGNORE  .env (excluded by security default from defaults: .env)"
		if r.String() != expected {
			t.Errorf("got %q, want %q", r.String(), expected)
		}
	})
}

func TestPathToComponents(t *testing.T) {
	tests := []struct {
		path     string
		expected []string
	}{
		{"", nil},
		{".", nil},
		{"file.txt", []string{"file.txt"}},
		{"dir/file.txt", []string{"dir", "file.txt"}},
		{"a/b/c/d.txt", []string{"a", "b", "c", "d.txt"}},
		{"./file.txt", []string{"file.txt"}},
		{"./a/b", []string{"a", "b"}},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			result := pathToComponents(tt.path)
			if len(result) != len(tt.expected) {
				t.Errorf("pathToComponents(%q) = %v, want %v", tt.path, result, tt.expected)
				return
			}
			for i := range result {
				if result[i] != tt.expected[i] {
					t.Errorf("pathToComponents(%q)[%d] = %q, want %q", tt.path, i, result[i], tt.expected[i])
				}
			}
		})
	}
}
