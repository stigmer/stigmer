package root

import (
	"archive/zip"
	"bytes"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

// =============================================================================
// TestZipDirectory
// =============================================================================

func TestZipDirectory(t *testing.T) {
	t.Run("multi-file directory", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "a.txt", "alpha")
		writeFile(t, dir, "b.txt", "beta")

		zipBytes, count, origSize, err := zipDirectory(dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if count != 2 {
			t.Errorf("file count = %d, want 2", count)
		}
		if origSize != int64(len("alpha")+len("beta")) {
			t.Errorf("original size = %d, want %d", origSize, len("alpha")+len("beta"))
		}

		entries := readZipEntries(t, zipBytes)
		if len(entries) != 2 {
			t.Fatalf("zip has %d entries, want 2", len(entries))
		}
		assertZipEntry(t, entries, "a.txt", "alpha")
		assertZipEntry(t, entries, "b.txt", "beta")
	})

	t.Run("hidden files skipped", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "visible.txt", "yes")
		writeFile(t, dir, ".hidden", "no")
		writeFile(t, dir, ".DS_Store", "no")

		_, count, _, err := zipDirectory(dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if count != 1 {
			t.Errorf("file count = %d, want 1 (hidden files should be skipped)", count)
		}
	})

	t.Run("hidden directories skipped entirely", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "keep.txt", "yes")
		gitDir := filepath.Join(dir, ".git", "objects")
		if err := os.MkdirAll(gitDir, 0o755); err != nil {
			t.Fatal(err)
		}
		writeFile(t, filepath.Join(dir, ".git"), "config", "skip-this")
		writeFile(t, filepath.Join(dir, ".git", "objects"), "pack", "skip-this-too")

		zipBytes, count, _, err := zipDirectory(dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if count != 1 {
			t.Errorf("file count = %d, want 1", count)
		}
		entries := readZipEntries(t, zipBytes)
		for name := range entries {
			if strings.Contains(name, ".git") {
				t.Errorf("zip contains .git entry: %s", name)
			}
		}
	})

	t.Run("nested directories preserve relative paths", func(t *testing.T) {
		dir := t.TempDir()
		subDir := filepath.Join(dir, "src", "lib")
		if err := os.MkdirAll(subDir, 0o755); err != nil {
			t.Fatal(err)
		}
		writeFile(t, dir, "README.md", "top-level")
		writeFile(t, subDir, "util.go", "package lib")

		zipBytes, count, _, err := zipDirectory(dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if count != 2 {
			t.Errorf("file count = %d, want 2", count)
		}
		entries := readZipEntries(t, zipBytes)
		assertZipEntry(t, entries, "README.md", "top-level")
		assertZipEntry(t, entries, "src/lib/util.go", "package lib")
	})

	t.Run("empty directory (all hidden) returns error", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, ".hidden", "x")

		_, _, _, err := zipDirectory(dir)
		if err == nil {
			t.Fatal("expected error for directory with only hidden files")
		}
		if !strings.Contains(err.Error(), "no attachable files") {
			t.Errorf("error = %q, want to contain 'no attachable files'", err.Error())
		}
	})

	t.Run("truly empty directory returns error", func(t *testing.T) {
		dir := t.TempDir()

		_, _, _, err := zipDirectory(dir)
		if err == nil {
			t.Fatal("expected error for empty directory")
		}
		if !strings.Contains(err.Error(), "no attachable files") {
			t.Errorf("error = %q, want to contain 'no attachable files'", err.Error())
		}
	})

	t.Run("non-existent directory returns error", func(t *testing.T) {
		_, _, _, err := zipDirectory("/tmp/does-not-exist-" + t.Name())
		if err == nil {
			t.Fatal("expected error for non-existent directory")
		}
	})

	t.Run("produced zip is valid", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "test.txt", "valid-zip-test")

		zipBytes, _, _, err := zipDirectory(dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		r, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
		if err != nil {
			t.Fatalf("produced bytes are not a valid zip: %v", err)
		}
		if len(r.File) != 1 {
			t.Errorf("zip has %d files, want 1", len(r.File))
		}
	})
}

// =============================================================================
// TestIsHiddenEntry
// =============================================================================

func TestIsHiddenEntry(t *testing.T) {
	tests := []struct {
		name   string
		hidden bool
	}{
		{".hidden", true},
		{".git", true},
		{".DS_Store", true},
		{".env", true},
		{"normal.txt", false},
		{"file.go", false},
		{"Makefile", false},
		{"README", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := isHiddenEntry(tc.name)
			if got != tc.hidden {
				t.Errorf("isHiddenEntry(%q) = %v, want %v", tc.name, got, tc.hidden)
			}
		})
	}
}

// =============================================================================
// TestDetectContentType
// =============================================================================

func TestDetectContentType(t *testing.T) {
	// Extensions handled by our custom switch fallback (not in Go's
	// standard mime database). These are the cases we control.
	t.Run("custom switch cases", func(t *testing.T) {
		tests := []struct {
			filename string
			want     string
		}{
			{"config.yaml", "application/x-yaml"},
			{"config.yml", "application/x-yaml"},
			{"README.md", "text/markdown"},
			{"CHANGELOG.markdown", "text/markdown"},
			{"config.toml", "application/toml"},
			{"data.parquet", "application/vnd.apache.parquet"},
			{"data.avro", "application/avro"},
		}

		for _, tc := range tests {
			t.Run(tc.filename, func(t *testing.T) {
				got := detectContentType(tc.filename)
				if got != tc.want {
					t.Errorf("detectContentType(%q) = %q, want %q", tc.filename, got, tc.want)
				}
			})
		}
	})

	t.Run("no extension returns octet-stream", func(t *testing.T) {
		got := detectContentType("Makefile")
		if got != "application/octet-stream" {
			t.Errorf("detectContentType(%q) = %q, want %q", "Makefile", got, "application/octet-stream")
		}
	})

	t.Run("truly unknown extension returns octet-stream", func(t *testing.T) {
		got := detectContentType("data.stigmertest99")
		if got != "application/octet-stream" {
			t.Errorf("detectContentType(%q) = %q, want %q", "data.stigmertest99", got, "application/octet-stream")
		}
	})

	// Extensions that mime.TypeByExtension may handle (platform-dependent).
	// We just verify the function returns something non-empty.
	t.Run("standard extensions return non-empty", func(t *testing.T) {
		for _, filename := range []string{"data.csv", "data.tsv", "app.log", "schema.sql"} {
			got := detectContentType(filename)
			if got == "" {
				t.Errorf("detectContentType(%q) returned empty string", filename)
			}
		}
	})
}

// =============================================================================
// TestFormatFileSize
// =============================================================================

func TestFormatFileSize(t *testing.T) {
	tests := []struct {
		bytes int64
		want  string
	}{
		{0, "0 B"},
		{1, "1 B"},
		{512, "512 B"},
		{1023, "1023 B"},
		{1024, "1.0 KB"},
		{1536, "1.5 KB"},
		{1024 * 1024, "1.0 MB"},
		{1024*1024 + 512*1024, "1.5 MB"},
		{1024 * 1024 * 1024, "1.0 GB"},
		{1024*1024*1024 + 512*1024*1024, "1.5 GB"},
	}

	for _, tc := range tests {
		t.Run(tc.want, func(t *testing.T) {
			got := formatFileSize(tc.bytes)
			if got != tc.want {
				t.Errorf("formatFileSize(%d) = %q, want %q", tc.bytes, got, tc.want)
			}
		})
	}
}

// =============================================================================
// Test helpers
// =============================================================================

func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("failed to create parent dir for %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("failed to write test file %s: %v", path, err)
	}
}

func readZipEntries(t *testing.T, zipBytes []byte) map[string]string {
	t.Helper()
	r, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		t.Fatalf("failed to read zip: %v", err)
	}
	entries := make(map[string]string, len(r.File))
	for _, f := range r.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("failed to open zip entry %s: %v", f.Name, err)
		}
		var buf bytes.Buffer
		if _, err := buf.ReadFrom(rc); err != nil {
			t.Fatalf("failed to read zip entry %s: %v", f.Name, err)
		}
		rc.Close()
		entries[f.Name] = buf.String()
	}
	return entries
}

func assertZipEntry(t *testing.T, entries map[string]string, name, wantContent string) {
	t.Helper()
	content, ok := entries[name]
	if !ok {
		t.Errorf("zip missing entry %q; have: %v", name, mapKeys(entries))
		return
	}
	if content != wantContent {
		t.Errorf("zip entry %q = %q, want %q", name, content, wantContent)
	}
}

func mapKeys(m map[string]string) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

// =============================================================================
// TestUploadFile_SetsLocalPath
// =============================================================================

func TestUploadFile_SetsLocalPath(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "config.yaml", "key: value")
	filePath := filepath.Join(dir, "config.yaml")

	proc := newTestProcessor("attachments/abc/config.yaml")

	att, err := proc.uploadFile(filePath, "config.yaml", "application/x-yaml", 10)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	absPath, _ := filepath.Abs(filePath)
	if att.LocalPath != absPath {
		t.Errorf("LocalPath = %q, want %q", att.LocalPath, absPath)
	}
	if att.StorageKey != "attachments/abc/config.yaml" {
		t.Errorf("StorageKey = %q, want %q", att.StorageKey, "attachments/abc/config.yaml")
	}
}

func TestUploadFile_LocalPathIsAbsolute(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "data.csv", "a,b,c")

	proc := newTestProcessor("attachments/xyz/data.csv")

	att, err := proc.uploadFile(filepath.Join(dir, "data.csv"), "data.csv", "text/csv", 5)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !filepath.IsAbs(att.LocalPath) {
		t.Errorf("LocalPath %q is not absolute", att.LocalPath)
	}
}

// =============================================================================
// TestProcessDirectory_SetsLocalPath
// =============================================================================

func TestProcessDirectory_SetsLocalPath(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "file.txt", "content")

	proc := newTestProcessor("attachments/def/dir.zip")

	att, err := proc.processDirectory(dir)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	absDir, _ := filepath.Abs(dir)
	if att.LocalPath != absDir {
		t.Errorf("LocalPath = %q, want %q", att.LocalPath, absDir)
	}
	if !att.Extract {
		t.Error("Extract should be true for directory attachments")
	}
}

// =============================================================================
// fakeUploadConn — mock gRPC connection for UploadAttachment
// =============================================================================

type fakeUploader struct {
	storageKey string
}

func (f *fakeUploader) UploadAttachment(_ context.Context, req *agentexecutionv1.UploadAttachmentRequest) (*agentexecutionv1.UploadAttachmentResponse, error) {
	return &agentexecutionv1.UploadAttachmentResponse{StorageKey: f.storageKey}, nil
}

func newTestProcessor(storageKey string) *AttachmentProcessor {
	return &AttachmentProcessor{uploader: &fakeUploader{storageKey: storageKey}}
}

// =============================================================================
// TestWorkspaceRelativePath
// =============================================================================

func TestWorkspaceRelativePath(t *testing.T) {
	t.Run("file inside workspace", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "src/config.yaml", "key: value")

		rel, inside, err := workspaceRelativePath(filepath.Join(dir, "src", "config.yaml"), dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !inside {
			t.Fatal("expected file to be inside workspace")
		}
		if rel != "src/config.yaml" {
			t.Errorf("rel = %q, want %q", rel, "src/config.yaml")
		}
	})

	t.Run("file at workspace root", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "README.md", "hello")

		rel, inside, err := workspaceRelativePath(filepath.Join(dir, "README.md"), dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !inside {
			t.Fatal("expected file to be inside workspace")
		}
		if rel != "README.md" {
			t.Errorf("rel = %q, want %q", rel, "README.md")
		}
	})

	t.Run("file outside workspace", func(t *testing.T) {
		workspace := t.TempDir()
		outside := t.TempDir()
		writeFile(t, outside, "external.csv", "a,b,c")

		_, inside, err := workspaceRelativePath(filepath.Join(outside, "external.csv"), workspace)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if inside {
			t.Fatal("expected file to be outside workspace")
		}
	})

	t.Run("nested subdirectory", func(t *testing.T) {
		dir := t.TempDir()
		subDir := filepath.Join(dir, "a", "b", "c")
		if err := os.MkdirAll(subDir, 0o755); err != nil {
			t.Fatal(err)
		}
		writeFile(t, subDir, "deep.txt", "deep")

		rel, inside, err := workspaceRelativePath(filepath.Join(subDir, "deep.txt"), dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !inside {
			t.Fatal("expected file to be inside workspace")
		}
		if rel != "a/b/c/deep.txt" {
			t.Errorf("rel = %q, want %q", rel, "a/b/c/deep.txt")
		}
	})

	t.Run("path with dot-dot that stays inside", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "file.txt", "content")
		pathWithDotDot := filepath.Join(dir, "sub", "..", "file.txt")

		rel, inside, err := workspaceRelativePath(pathWithDotDot, dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !inside {
			t.Fatal("expected normalized path to be inside workspace")
		}
		if rel != "file.txt" {
			t.Errorf("rel = %q, want %q", rel, "file.txt")
		}
	})

	t.Run("path with dot-dot that escapes", func(t *testing.T) {
		dir := t.TempDir()
		escapePath := filepath.Join(dir, "..", "escape.txt")

		_, inside, _ := workspaceRelativePath(escapePath, dir)
		if inside {
			t.Fatal("expected path traversal to be detected as outside workspace")
		}
	})

	t.Run("returns forward slashes", func(t *testing.T) {
		dir := t.TempDir()
		subDir := filepath.Join(dir, "src", "lib")
		if err := os.MkdirAll(subDir, 0o755); err != nil {
			t.Fatal(err)
		}
		writeFile(t, subDir, "util.go", "package lib")

		rel, inside, err := workspaceRelativePath(filepath.Join(subDir, "util.go"), dir)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if !inside {
			t.Fatal("expected file to be inside workspace")
		}
		if strings.Contains(rel, "\\") {
			t.Errorf("rel = %q, expected forward slashes only", rel)
		}
	})
}

// =============================================================================
// TestProcessFiles_WorkspaceAware
// =============================================================================

func TestProcessFiles_WorkspaceAware(t *testing.T) {
	t.Run("no workspace — all files uploaded", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "a.txt", "alpha")
		writeFile(t, dir, "b.txt", "beta")

		proc := newTestProcessor("attachments/test/file.txt")

		result, err := proc.ProcessFiles([]string{
			filepath.Join(dir, "a.txt"),
			filepath.Join(dir, "b.txt"),
		}, nil)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(result.Attachments) != 2 {
			t.Errorf("Attachments = %d, want 2", len(result.Attachments))
		}
		if len(result.WorkspaceFileRefs) != 0 {
			t.Errorf("WorkspaceFileRefs = %d, want 0", len(result.WorkspaceFileRefs))
		}
	})

	t.Run("all files inside workspace — all become refs", func(t *testing.T) {
		dir := t.TempDir()
		writeFile(t, dir, "src/config.yaml", "key: value")
		writeFile(t, dir, "README.md", "hello")

		proc := newTestProcessor("attachments/test/file.txt")

		result, err := proc.ProcessFiles([]string{
			filepath.Join(dir, "src", "config.yaml"),
			filepath.Join(dir, "README.md"),
		}, []string{dir})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(result.Attachments) != 0 {
			t.Errorf("Attachments = %d, want 0 (all inside workspace)", len(result.Attachments))
		}
		if len(result.WorkspaceFileRefs) != 2 {
			t.Errorf("WorkspaceFileRefs = %d, want 2", len(result.WorkspaceFileRefs))
		}

		wantRefs := map[string]bool{"src/config.yaml": true, "README.md": true}
		for _, ref := range result.WorkspaceFileRefs {
			if !wantRefs[ref] {
				t.Errorf("unexpected workspace ref: %q", ref)
			}
		}
	})

	t.Run("mixed — split between refs and uploads", func(t *testing.T) {
		workspace := t.TempDir()
		external := t.TempDir()
		writeFile(t, workspace, "schema.sql", "CREATE TABLE t")
		writeFile(t, external, "data.csv", "a,b,c")

		proc := newTestProcessor("attachments/test/data.csv")

		result, err := proc.ProcessFiles([]string{
			filepath.Join(workspace, "schema.sql"),
			filepath.Join(external, "data.csv"),
		}, []string{workspace})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(result.WorkspaceFileRefs) != 1 {
			t.Fatalf("WorkspaceFileRefs = %d, want 1", len(result.WorkspaceFileRefs))
		}
		if result.WorkspaceFileRefs[0] != "schema.sql" {
			t.Errorf("WorkspaceFileRefs[0] = %q, want %q", result.WorkspaceFileRefs[0], "schema.sql")
		}
		if len(result.Attachments) != 1 {
			t.Fatalf("Attachments = %d, want 1", len(result.Attachments))
		}
	})

	t.Run("empty paths returns empty result", func(t *testing.T) {
		proc := newTestProcessor("")

		result, err := proc.ProcessFiles([]string{}, []string{"/some/workspace"})
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(result.Attachments) != 0 || len(result.WorkspaceFileRefs) != 0 {
			t.Errorf("expected empty result, got %d attachments and %d refs",
				len(result.Attachments), len(result.WorkspaceFileRefs))
		}
	})
}
