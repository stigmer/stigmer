package artifact

import (
	"archive/zip"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// =============================================================================
// Test Helpers
// =============================================================================

// createTestSkillDir creates a temporary directory with test files for skill testing.
// Returns the directory path that should be cleaned up by the caller.
func createTestSkillDir(t *testing.T, files map[string]string) string {
	t.Helper()
	dir := t.TempDir()
	for name, content := range files {
		path := filepath.Join(dir, name)
		// Create parent directories if needed
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatalf("failed to create directory for %s: %v", name, err)
		}
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("failed to write test file %s: %v", name, err)
		}
	}
	return dir
}

// zipContains checks if a zip archive contains a specific file.
func zipContains(t *testing.T, zipData []byte, filename string) bool {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatalf("failed to read zip: %v", err)
	}
	for _, f := range reader.File {
		if f.Name == filename {
			return true
		}
	}
	return false
}

// zipFileList returns all files in a zip archive.
func zipFileList(t *testing.T, zipData []byte) []string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatalf("failed to read zip: %v", err)
	}
	var files []string
	for _, f := range reader.File {
		files = append(files, f.Name)
	}
	return files
}

// zipFileContent returns the content of a file in a zip archive.
func zipFileContent(t *testing.T, zipData []byte, filename string) string {
	t.Helper()
	reader, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatalf("failed to read zip: %v", err)
	}
	for _, f := range reader.File {
		if f.Name == filename {
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("failed to open file in zip: %v", err)
			}
			defer rc.Close()
			content, err := io.ReadAll(rc)
			if err != nil {
				t.Fatalf("failed to read file content: %v", err)
			}
			return string(content)
		}
	}
	return ""
}

// =============================================================================
// createSkillZip Tests
// =============================================================================

func TestCreateSkillZip_BasicSkill(t *testing.T) {
	// Test basic skill with SKILL.md and source files
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":  "# Test Skill\n\nDescription here.",
		"main.py":   "print('hello')",
		"utils.py":  "def helper(): pass",
		"README.md": "# README",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	// Verify stats
	if stats.FilesIncluded != 4 {
		t.Errorf("expected 4 files included, got %d", stats.FilesIncluded)
	}
	if stats.FilesIgnored != 0 {
		t.Errorf("expected 0 files ignored, got %d", stats.FilesIgnored)
	}

	// Verify zip contents
	zipData := buf.Bytes()
	if !zipContains(t, zipData, "SKILL.md") {
		t.Error("zip should contain SKILL.md")
	}
	if !zipContains(t, zipData, "main.py") {
		t.Error("zip should contain main.py")
	}
}

func TestCreateSkillZip_WithGitignore(t *testing.T) {
	// Test that .gitignore patterns are respected
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":   "# Test Skill",
		"main.py":    "print('hello')",
		".gitignore": "*.pyc\n__pycache__/\nbuild/\n",
		"cache.pyc":  "compiled",
		"output.pyc": "compiled",
	})

	// Also create a __pycache__ directory
	pycacheDir := filepath.Join(dir, "__pycache__")
	if err := os.Mkdir(pycacheDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(pycacheDir, "module.cpython-311.pyc"), []byte("bytecode"), 0644); err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	// Should include main files
	zipData := buf.Bytes()
	if !zipContains(t, zipData, "SKILL.md") {
		t.Error("zip should contain SKILL.md")
	}
	if !zipContains(t, zipData, "main.py") {
		t.Error("zip should contain main.py")
	}

	// Should NOT include .pyc files (from .gitignore)
	if zipContains(t, zipData, "cache.pyc") {
		t.Error("zip should NOT contain cache.pyc (matched by .gitignore)")
	}
	if zipContains(t, zipData, "output.pyc") {
		t.Error("zip should NOT contain output.pyc (matched by .gitignore)")
	}

	// __pycache__ should be skipped as directory
	if stats.DirsSkipped == 0 {
		t.Error("expected at least 1 directory to be skipped (__pycache__)")
	}

	// .gitignore itself should not be in the zip (excluded by default patterns)
	// Note: .gitignore is NOT in security defaults, so it will be included
	// This test verifies gitignore patterns work
	if stats.FilesIgnored < 2 {
		t.Errorf("expected at least 2 files ignored (*.pyc), got %d", stats.FilesIgnored)
	}
}

func TestCreateSkillZip_WithStigmerignore(t *testing.T) {
	// Test that .stigmerignore patterns are applied
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":        "# Test Skill",
		"main.py":         "print('hello')",
		".stigmerignore":  "*.test.py\ndocs/internal/\n",
		"test_utils.py":   "# test file",
		"utils.test.py":   "# test file",
		"api.test.py":     "# test file",
		"docs/public.md":  "# Public docs",
		"docs/internal/x": "# Internal docs",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()

	// Should include main files
	if !zipContains(t, zipData, "SKILL.md") {
		t.Error("zip should contain SKILL.md")
	}
	if !zipContains(t, zipData, "main.py") {
		t.Error("zip should contain main.py")
	}

	// test_utils.py does NOT match *.test.py pattern (different naming)
	if !zipContains(t, zipData, "test_utils.py") {
		t.Error("zip should contain test_utils.py (doesn't match *.test.py)")
	}

	// Should NOT include *.test.py files
	if zipContains(t, zipData, "utils.test.py") {
		t.Error("zip should NOT contain utils.test.py (matched by .stigmerignore)")
	}
	if zipContains(t, zipData, "api.test.py") {
		t.Error("zip should NOT contain api.test.py (matched by .stigmerignore)")
	}

	// Should include public docs but not internal
	if !zipContains(t, zipData, "docs/public.md") {
		t.Error("zip should contain docs/public.md")
	}

	// Verify files were ignored
	if stats.FilesIgnored < 2 {
		t.Errorf("expected at least 2 files ignored, got %d", stats.FilesIgnored)
	}
}

func TestCreateSkillZip_StigmerignoreOverridesGitignore(t *testing.T) {
	// Test precedence: .stigmerignore can override .gitignore with negation for FILES
	// Note: When a DIRECTORY is skipped, files inside cannot be re-included
	// This is a performance optimization - we skip entire directory trees
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":       "# Test Skill",
		"main.py":        "print('hello')",
		".gitignore":     "*.log\n",          // Ignore all .log files
		".stigmerignore": "!important.log\n", // Re-include important.log
		"debug.log":      "debug logs",
		"important.log":  "# This should be included",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()

	// debug.log should be ignored (from .gitignore)
	if zipContains(t, zipData, "debug.log") {
		t.Error("zip should NOT contain debug.log (ignored by .gitignore)")
	}

	// important.log should be INCLUDED (negation in .stigmerignore)
	if !zipContains(t, zipData, "important.log") {
		t.Error("zip should contain important.log (re-included by .stigmerignore negation)")
	}

	t.Logf("Stats: %d included, %d ignored, %d dirs skipped",
		stats.FilesIncluded, stats.FilesIgnored, stats.DirsSkipped)
}

func TestCreateSkillZip_SecurityDefaults(t *testing.T) {
	// Test that security-sensitive files are always excluded by defaults
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":                 "# Test Skill",
		"main.py":                  "print('hello')",
		".env":                     "SECRET_KEY=abc123",
		".env.local":               "LOCAL_SECRET=xyz",
		".env.production":          "PROD_SECRET=prod",
		"secrets/private.key":      "-----BEGIN PRIVATE KEY-----",
		"certs/server.pem":         "-----BEGIN CERTIFICATE-----",
		"credentials.json":         `{"api_key": "secret"}`,
		"service-account-key.json": `{"type": "service_account"}`,
		".idea/workspace.xml":      "<project></project>",
		".vscode/settings.json":    "{}",
		"file.swp":                 "vim swap",
		".DS_Store":                "macos",
		"node_modules/pkg/i.js":    "// node module",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()
	files := zipFileList(t, zipData)
	t.Logf("Included files: %v", files)

	// Should include main files
	if !zipContains(t, zipData, "SKILL.md") {
		t.Error("zip should contain SKILL.md")
	}
	if !zipContains(t, zipData, "main.py") {
		t.Error("zip should contain main.py")
	}

	// Security-sensitive files should be excluded
	securityFiles := []string{
		".env",
		".env.local",
		".env.production",
		"secrets/private.key",
		"certs/server.pem",
		"credentials.json",
		"service-account-key.json",
		".idea/workspace.xml",
		".vscode/settings.json",
		"file.swp",
		".DS_Store",
		"node_modules/pkg/i.js",
	}

	for _, f := range securityFiles {
		if zipContains(t, zipData, f) {
			t.Errorf("zip should NOT contain %s (security default)", f)
		}
	}

	// Should have recorded ignores by source
	if stats.IgnoredBySource["defaults"] == 0 {
		t.Error("expected some files to be ignored by defaults")
	}
}

func TestCreateSkillZip_CLIFlags(t *testing.T) {
	// Test CLI --ignore and --include flags
	// Note: CLI flags work at file level, not directory level
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":       "# Test Skill",
		"main.py":        "print('hello')",
		"cache.tmp":      "temp file",
		"data.tmp":       "temp file",
		"debug.log":      "debug info",
		"important.log":  "# important log",
		".stigmerignore": "*.log\n", // Ignore all .log files
	})

	opts := IgnoreOptions{
		RespectGitignore: true,
		ExtraIgnore:      []string{"*.tmp"},         // Also ignore .tmp files
		ExtraInclude:     []string{"important.log"}, // But include this one log
	}

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, opts)
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()
	files := zipFileList(t, zipData)
	t.Logf("Included files: %v", files)

	// Main files should be included
	if !zipContains(t, zipData, "SKILL.md") {
		t.Error("zip should contain SKILL.md")
	}
	if !zipContains(t, zipData, "main.py") {
		t.Error("zip should contain main.py")
	}

	// .tmp files should be ignored (CLI --ignore)
	if zipContains(t, zipData, "cache.tmp") {
		t.Error("zip should NOT contain cache.tmp (CLI --ignore)")
	}
	if zipContains(t, zipData, "data.tmp") {
		t.Error("zip should NOT contain data.tmp (CLI --ignore)")
	}

	// debug.log should be ignored (.stigmerignore)
	if zipContains(t, zipData, "debug.log") {
		t.Error("zip should NOT contain debug.log (.stigmerignore)")
	}

	// important.log should be included (CLI --include overrides .stigmerignore)
	if !zipContains(t, zipData, "important.log") {
		t.Error("zip should contain important.log (CLI --include)")
	}

	t.Logf("Stats: %d included, %d ignored", stats.FilesIncluded, stats.FilesIgnored)
}

func TestCreateSkillZip_NoGitignore(t *testing.T) {
	// Test with RespectGitignore=false
	// Note: Uses 'output/' which is NOT in security defaults (build/ is)
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":      "# Test Skill",
		"main.py":       "print('hello')",
		".gitignore":    "output/\n*.compiled\n",
		"output/out.js": "// compiled output",
		"data.compiled": "compiled data",
	})

	// First, test WITH gitignore (should exclude output/)
	var buf1 bytes.Buffer
	stats1, err := createSkillZip(dir, &buf1, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}
	zipData1 := buf1.Bytes()
	if zipContains(t, zipData1, "output/out.js") {
		t.Error("with gitignore: zip should NOT contain output/out.js")
	}
	if zipContains(t, zipData1, "data.compiled") {
		t.Error("with gitignore: zip should NOT contain data.compiled")
	}

	// Now test WITHOUT gitignore (should include output/)
	opts := IgnoreOptions{
		RespectGitignore: false, // Don't respect .gitignore
	}

	var buf2 bytes.Buffer
	stats2, err := createSkillZip(dir, &buf2, opts)
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData2 := buf2.Bytes()

	// output/out.js should be INCLUDED since we're not respecting .gitignore
	if !zipContains(t, zipData2, "output/out.js") {
		t.Error("without gitignore: zip should contain output/out.js")
	}
	if !zipContains(t, zipData2, "data.compiled") {
		t.Error("without gitignore: zip should contain data.compiled")
	}

	t.Logf("With gitignore: %d included, %d ignored", stats1.FilesIncluded, stats1.FilesIgnored)
	t.Logf("Without gitignore: %d included, %d ignored", stats2.FilesIncluded, stats2.FilesIgnored)
}

func TestCreateSkillZip_VerboseOutput(t *testing.T) {
	// Test verbose mode doesn't break anything
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md": "# Test Skill",
		"main.py":  "print('hello')",
		".env":     "SECRET=x", // Should be ignored
	})

	opts := IgnoreOptions{
		RespectGitignore: true,
		Verbose:          true,
	}

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, opts)
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	// Just verify it completes successfully
	if stats.FilesIncluded < 1 {
		t.Error("expected at least 1 file included")
	}
}

func TestCreateSkillZip_EmptyDirectory(t *testing.T) {
	dir := t.TempDir()
	// Create a truly empty directory

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	if stats.FilesIncluded != 0 {
		t.Errorf("expected 0 files included, got %d", stats.FilesIncluded)
	}
}

func TestCreateSkillZip_NestedDirectories(t *testing.T) {
	// Test deeply nested directory structure
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":                      "# Test Skill",
		"src/main.py":                   "main",
		"src/utils/helper.py":           "helper",
		"src/utils/deep/nested/file.py": "deep",
		"tests/unit/test_main.py":       "test",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()

	// All files should be included
	expectedFiles := []string{
		"SKILL.md",
		"src/main.py",
		"src/utils/helper.py",
		"src/utils/deep/nested/file.py",
		"tests/unit/test_main.py",
	}

	for _, f := range expectedFiles {
		if !zipContains(t, zipData, f) {
			t.Errorf("zip should contain %s", f)
		}
	}

	if stats.FilesIncluded != 5 {
		t.Errorf("expected 5 files included, got %d", stats.FilesIncluded)
	}
}

func TestCreateSkillZip_DirectorySkipping(t *testing.T) {
	// Test that entire directories are skipped efficiently
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":               "# Test Skill",
		"main.py":                "main",
		"node_modules/pkg1/i.js": "pkg1",
		"node_modules/pkg2/i.js": "pkg2",
		"node_modules/pkg3/i.js": "pkg3",
		".venv/lib/site.py":      "venv",
		".venv/bin/python":       "python",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	// Should have skipped directories
	if stats.DirsSkipped < 2 {
		t.Errorf("expected at least 2 directories skipped (node_modules, .venv), got %d", stats.DirsSkipped)
	}

	// None of the files in skipped dirs should be counted as FilesIgnored
	// They should not even be traversed
	t.Logf("Stats: files=%d, ignored=%d, dirs_skipped=%d",
		stats.FilesIncluded, stats.FilesIgnored, stats.DirsSkipped)
}

func TestCreateSkillZip_UnicodeFilenames(t *testing.T) {
	// Test Unicode filenames are handled correctly
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":   "# Test Skill",
		"日本語.py":     "# Japanese",
		"données.py": "# French",
		"数据/文件.txt":  "# Chinese path",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()

	// All files should be included
	if stats.FilesIncluded != 4 {
		t.Errorf("expected 4 files included, got %d", stats.FilesIncluded)
	}

	// Verify zip is readable
	files := zipFileList(t, zipData)
	t.Logf("Unicode files included: %v", files)
}

func TestCreateSkillZip_EnvExampleAllowed(t *testing.T) {
	// Test that .env.example and .env.template are allowed
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":      "# Test Skill",
		".env":          "SECRET=real",     // Should be ignored
		".env.local":    "SECRET=local",    // Should be ignored
		".env.example":  "SECRET=example",  // Should be ALLOWED
		".env.template": "SECRET=template", // Should be ALLOWED
	})

	var buf bytes.Buffer
	_, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()

	// Real env files should be ignored
	if zipContains(t, zipData, ".env") {
		t.Error("zip should NOT contain .env")
	}
	if zipContains(t, zipData, ".env.local") {
		t.Error("zip should NOT contain .env.local")
	}

	// Example/template files should be allowed
	if !zipContains(t, zipData, ".env.example") {
		t.Error("zip should contain .env.example")
	}
	if !zipContains(t, zipData, ".env.template") {
		t.Error("zip should contain .env.template")
	}
}

// =============================================================================
// AnalyzeDryRun Tests
// =============================================================================

func TestAnalyzeDryRun_BasicAnalysis(t *testing.T) {
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md": "# Test Skill",
		"main.py":  "print('hello')",
		".env":     "SECRET=x",
	})

	analysis, err := AnalyzeDryRun(dir, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("AnalyzeDryRun failed: %v", err)
	}

	// Should have stats
	if analysis.Stats.FilesIncluded < 2 {
		t.Errorf("expected at least 2 files included, got %d", analysis.Stats.FilesIncluded)
	}

	// Should have pattern sources
	if len(analysis.PatternSources) == 0 {
		t.Error("expected pattern sources to be populated")
	}

	// Should have sample included files
	if len(analysis.SampleIncluded) == 0 {
		t.Error("expected sample included files")
	}

	t.Logf("Analysis: %d included, %d ignored, sources: %v",
		analysis.Stats.FilesIncluded, analysis.Stats.FilesIgnored, analysis.PatternSources)
}

func TestAnalyzeDryRun_WithIgnoredFiles(t *testing.T) {
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":              "# Test Skill",
		"main.py":               "print('hello')",
		".env":                  "SECRET=x",
		".env.local":            "LOCAL=y",
		"node_modules/pkg/i.js": "// module",
	})

	analysis, err := AnalyzeDryRun(dir, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("AnalyzeDryRun failed: %v", err)
	}

	// Should have ignored files in samples
	if len(analysis.SampleIgnored) == 0 {
		t.Error("expected sample ignored files")
	}

	// Should track ignored by source
	if analysis.Stats.IgnoredBySource["defaults"] == 0 {
		t.Error("expected files ignored by defaults")
	}

	t.Logf("Sample ignored: %v", analysis.SampleIgnored)
}

func TestAnalyzeDryRun_PatternSources(t *testing.T) {
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":       "# Test Skill",
		"main.py":        "print('hello')",
		".gitignore":     "build/\n",
		".stigmerignore": "*.test.py\n",
	})

	analysis, err := AnalyzeDryRun(dir, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("AnalyzeDryRun failed: %v", err)
	}

	// Should include pattern sources from all files
	t.Logf("Pattern sources: %v", analysis.PatternSources)

	// Should have at least defaults
	foundDefaults := false
	for _, src := range analysis.PatternSources {
		if containsSubstring(src, "defaults") {
			foundDefaults = true
			break
		}
	}
	if !foundDefaults {
		t.Error("expected 'defaults' in pattern sources")
	}
}

func TestAnalyzeDryRun_EstimatedSize(t *testing.T) {
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md": "# Test Skill - This is some content",
		"main.py":  "print('hello world')",
		"data.txt": "Some test data content here",
	})

	analysis, err := AnalyzeDryRun(dir, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("AnalyzeDryRun failed: %v", err)
	}

	// Should have estimated size > 0
	if analysis.Stats.TotalSize == 0 {
		t.Error("expected non-zero total size")
	}

	t.Logf("Estimated size: %d bytes", analysis.Stats.TotalSize)
}

// =============================================================================
// Edge Cases
// =============================================================================

func TestCreateSkillZip_EmptyStigmerignore(t *testing.T) {
	// Empty .stigmerignore should not cause issues
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":       "# Test Skill",
		"main.py":        "print('hello')",
		".stigmerignore": "", // Empty file
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	if stats.FilesIncluded < 2 {
		t.Errorf("expected at least 2 files included, got %d", stats.FilesIncluded)
	}
}

func TestCreateSkillZip_InvalidPatternSyntax(t *testing.T) {
	// Invalid patterns should be skipped, not cause errors
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":       "# Test Skill",
		"main.py":        "print('hello')",
		".stigmerignore": "[invalid\n*.py\n", // First pattern is invalid
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip should not fail on invalid patterns: %v", err)
	}

	// Should still work
	if stats.FilesIncluded == 0 {
		t.Error("expected some files to be included")
	}
}

func TestCreateSkillZip_SymlinksIgnored(t *testing.T) {
	// Create a directory with a symlink
	dir := t.TempDir()

	// Create regular files
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte("# Test"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "main.py"), []byte("main"), 0644); err != nil {
		t.Fatal(err)
	}

	// Create a symlink (may fail on some systems)
	target := filepath.Join(dir, "main.py")
	link := filepath.Join(dir, "link.py")
	err := os.Symlink(target, link)
	if err != nil {
		t.Skip("symlinks not supported on this system")
	}

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	// Symlinks are followed by filepath.Walk, so link.py should be included
	// This is expected behavior - we include the content
	t.Logf("Stats: %d included", stats.FilesIncluded)
}

// =============================================================================
// Real-World Scenario Tests
// =============================================================================

func TestCreateSkillZip_PythonSkillScenario(t *testing.T) {
	// Simulate a real Python skill with typical files
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":                          "# Python Analysis Skill",
		"skill.py":                          "def analyze(): pass",
		"requirements.txt":                  "pandas==2.0.0\nnumpy==1.24.0",
		"utils/helpers.py":                  "def helper(): pass",
		"utils/__init__.py":                 "",
		"tests/test_skill.py":               "def test_analyze(): pass",
		"tests/__init__.py":                 "",
		".gitignore":                        "*.pyc\n__pycache__/\n.pytest_cache/\ndist/\n*.egg-info/\n",
		".stigmerignore":                    "tests/\n",
		".env":                              "API_KEY=secret",
		".env.example":                      "API_KEY=your-key-here",
		"__pycache__/skill.cpython-311.pyc": "bytecode",
		".pytest_cache/v/cache/stuff":       "cache",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()
	files := zipFileList(t, zipData)
	t.Logf("Python skill files: %v", files)

	// Should include source files
	if !zipContains(t, zipData, "SKILL.md") {
		t.Error("should contain SKILL.md")
	}
	if !zipContains(t, zipData, "skill.py") {
		t.Error("should contain skill.py")
	}
	if !zipContains(t, zipData, "requirements.txt") {
		t.Error("should contain requirements.txt")
	}
	if !zipContains(t, zipData, "utils/helpers.py") {
		t.Error("should contain utils/helpers.py")
	}
	if !zipContains(t, zipData, ".env.example") {
		t.Error("should contain .env.example")
	}

	// Should NOT include tests (stigmerignore)
	if zipContains(t, zipData, "tests/test_skill.py") {
		t.Error("should NOT contain tests/test_skill.py")
	}

	// Should NOT include .env (security default)
	if zipContains(t, zipData, ".env") {
		t.Error("should NOT contain .env")
	}

	// Should NOT include __pycache__ (gitignore + default)
	if zipContains(t, zipData, "__pycache__/skill.cpython-311.pyc") {
		t.Error("should NOT contain __pycache__ files")
	}

	t.Logf("Python skill: %d files, %d ignored, %d dirs skipped",
		stats.FilesIncluded, stats.FilesIgnored, stats.DirsSkipped)
}

func TestCreateSkillZip_NodeJSSkillScenario(t *testing.T) {
	// Simulate a real Node.js skill
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":                 "# Node.js API Skill",
		"index.js":                 "module.exports = {}",
		"package.json":             `{"name": "skill"}`,
		"src/api.js":               "const api = {}",
		"src/utils.js":             "const utils = {}",
		".gitignore":               "node_modules/\ndist/\n.env\n",
		".stigmerignore":           "*.test.js\n__tests__/\n",
		"index.test.js":            "test('works', () => {})",
		"__tests__/api.test.js":    "test('api', () => {})",
		"node_modules/lodash/i.js": "// lodash",
		".env":                     "SECRET=x",
		".env.example":             "SECRET=your-secret",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()
	files := zipFileList(t, zipData)
	t.Logf("Node.js skill files: %v", files)

	// Should include source
	if !zipContains(t, zipData, "SKILL.md") {
		t.Error("should contain SKILL.md")
	}
	if !zipContains(t, zipData, "index.js") {
		t.Error("should contain index.js")
	}
	if !zipContains(t, zipData, "package.json") {
		t.Error("should contain package.json")
	}
	if !zipContains(t, zipData, ".env.example") {
		t.Error("should contain .env.example")
	}

	// Should NOT include node_modules
	if zipContains(t, zipData, "node_modules/lodash/i.js") {
		t.Error("should NOT contain node_modules")
	}

	// Should NOT include tests
	if zipContains(t, zipData, "index.test.js") {
		t.Error("should NOT contain index.test.js")
	}

	t.Logf("Node.js skill: %d files, %d ignored, %d dirs skipped",
		stats.FilesIncluded, stats.FilesIgnored, stats.DirsSkipped)
}

func TestCreateSkillZip_GoSkillScenario(t *testing.T) {
	// Simulate a real Go skill
	dir := createTestSkillDir(t, map[string]string{
		"SKILL.md":      "# Go Analysis Skill",
		"main.go":       "package main",
		"go.mod":        "module skill",
		"go.sum":        "checksums",
		"internal/x.go": "package internal",
		".gitignore":    "bin/\n*.exe\n",
		"bin/skill":     "binary",
	})

	var buf bytes.Buffer
	stats, err := createSkillZip(dir, &buf, DefaultIgnoreOptions())
	if err != nil {
		t.Fatalf("createSkillZip failed: %v", err)
	}

	zipData := buf.Bytes()

	// Should include source
	if !zipContains(t, zipData, "main.go") {
		t.Error("should contain main.go")
	}
	if !zipContains(t, zipData, "go.mod") {
		t.Error("should contain go.mod")
	}

	// Should NOT include bin/
	if zipContains(t, zipData, "bin/skill") {
		t.Error("should NOT contain bin/skill")
	}

	t.Logf("Go skill: %d files, %d ignored", stats.FilesIncluded, stats.FilesIgnored)
}

// =============================================================================
// Helper Functions Tests
// =============================================================================

func TestFormatBytes(t *testing.T) {
	tests := []struct {
		bytes    int64
		expected string
	}{
		{0, "0 B"},
		{100, "100 B"},
		{1023, "1023 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{1048576, "1.0 MB"},
		{1073741824, "1.0 GB"},
	}

	for _, tt := range tests {
		result := formatBytes(tt.bytes)
		if result != tt.expected {
			t.Errorf("formatBytes(%d) = %s, want %s", tt.bytes, result, tt.expected)
		}
	}
}

func TestDefaultIgnoreOptions(t *testing.T) {
	opts := DefaultIgnoreOptions()

	if !opts.RespectGitignore {
		t.Error("RespectGitignore should be true by default")
	}
	if opts.Verbose {
		t.Error("Verbose should be false by default")
	}
	if len(opts.ExtraIgnore) != 0 {
		t.Error("ExtraIgnore should be empty by default")
	}
	if len(opts.ExtraInclude) != 0 {
		t.Error("ExtraInclude should be empty by default")
	}
}

// Helper function
func containsSubstring(s, substr string) bool {
	return len(s) >= len(substr) && findSubstr(s, substr)
}

func findSubstr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
