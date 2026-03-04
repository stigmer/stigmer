package toolrender

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

// =============================================================================
// Hyperlink — generic OSC 8 wrapper
// =============================================================================

func TestHyperlink_WrapsTextInOSC8(t *testing.T) {
	got := Hyperlink("click me", "https://example.com")
	want := "\033]8;;https://example.com\033\\click me\033]8;;\033\\"
	if got != want {
		t.Errorf("Hyperlink() =\n  %q\nwant:\n  %q", got, want)
	}
}

func TestHyperlink_EmptyDisplayText(t *testing.T) {
	got := Hyperlink("", "https://example.com")
	want := "\033]8;;https://example.com\033\\\033]8;;\033\\"
	if got != want {
		t.Errorf("Hyperlink(\"\", uri) =\n  %q\nwant:\n  %q", got, want)
	}
}

func TestHyperlink_EmptyURI(t *testing.T) {
	got := Hyperlink("some text", "")
	want := "\033]8;;\033\\some text\033]8;;\033\\"
	if got != want {
		t.Errorf("Hyperlink(text, \"\") =\n  %q\nwant:\n  %q", got, want)
	}
}

// =============================================================================
// FileHyperlink — file-specific with enabled toggle
// =============================================================================

func TestFileHyperlink_Enabled_WrapsInOSC8WithFileURI(t *testing.T) {
	got := FileHyperlink("render.go", "/Users/dev/project/render.go", true)

	if !strings.HasPrefix(got, osc8Open+"file:///Users/dev/project/render.go"+st) {
		t.Errorf("expected OSC 8 open with file URI, got %q", got)
	}
	if !strings.Contains(got, "render.go") {
		t.Errorf("expected display text 'render.go' in output, got %q", got)
	}
	if !strings.HasSuffix(got, osc8Close) {
		t.Errorf("expected OSC 8 close at end, got %q", got)
	}
}

func TestFileHyperlink_Disabled_ReturnsDisplayPathUnchanged(t *testing.T) {
	got := FileHyperlink("render.go", "/Users/dev/project/render.go", false)
	if got != "render.go" {
		t.Errorf("disabled FileHyperlink should return displayPath unchanged, got %q", got)
	}
}

func TestFileHyperlink_DisplayDiffersFromAbsolute(t *testing.T) {
	got := FileHyperlink("pkg/render.go", "/Users/dev/project/pkg/render.go", true)

	if !strings.Contains(got, "file:///Users/dev/project/pkg/render.go") {
		t.Errorf("URI should use absolutePath, got %q", got)
	}
	if !strings.Contains(got, st+"pkg/render.go"+osc8Close) {
		t.Errorf("display text should use displayPath, got %q", got)
	}
}

func TestFileHyperlink_PathWithSpaces(t *testing.T) {
	got := FileHyperlink("my file.go", "/Users/dev/my project/my file.go", true)

	if !strings.Contains(got, "my%20project/my%20file.go") {
		t.Errorf("spaces should be percent-encoded in URI, got %q", got)
	}
	if !strings.Contains(got, st+"my file.go"+osc8Close) {
		t.Errorf("display text should preserve literal spaces, got %q", got)
	}
}

func TestFileHyperlink_PathWithUnicode(t *testing.T) {
	got := FileHyperlink("日本語.go", "/Users/dev/プロジェクト/日本語.go", true)

	if !strings.Contains(got, st+"日本語.go"+osc8Close) {
		t.Errorf("display text should preserve unicode, got %q", got)
	}
	if !strings.HasPrefix(got, osc8Open+"file:///Users/dev/") {
		t.Errorf("URI should start with file scheme, got %q", got)
	}
}

func TestFileHyperlink_PathWithURISignificantChars(t *testing.T) {
	tests := []struct {
		name    string
		absPath string
		encoded string
	}{
		{"hash", "/path/to/file#1.go", "file%231.go"},
		{"percent", "/path/to/100%done.go", "100%25done.go"},
		{"question", "/path/to/what?.go", "what%3F.go"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := FileHyperlink("display", tt.absPath, true)
			if !strings.Contains(got, tt.encoded) {
				t.Errorf("URI-significant char should be encoded: %q not found in %q", tt.encoded, got)
			}
		})
	}
}

func TestFileHyperlink_EmptyPaths(t *testing.T) {
	t.Run("empty display", func(t *testing.T) {
		got := FileHyperlink("", "/some/path.go", true)
		if !strings.HasPrefix(got, osc8Open) {
			t.Errorf("should still produce OSC 8 wrapper, got %q", got)
		}
	})

	t.Run("empty absolute", func(t *testing.T) {
		got := FileHyperlink("file.go", "", true)
		if !strings.Contains(got, "file.go") {
			t.Errorf("should still contain display text, got %q", got)
		}
	})

	t.Run("both empty disabled", func(t *testing.T) {
		got := FileHyperlink("", "", false)
		if got != "" {
			t.Errorf("disabled with empty displayPath should return empty, got %q", got)
		}
	})
}

func TestFileHyperlink_RelativePath_DegradesToDisplayPath(t *testing.T) {
	got := FileHyperlink("src/main.go", "src/main.go", true)
	if got != "src/main.go" {
		t.Errorf("relative absolutePath should degrade to displayPath, got %q", got)
	}
}

func TestFileHyperlink_RelativePath_WithWorkspacePrefix_DegradesToDisplayPath(t *testing.T) {
	got := FileHyperlink("my-repo/README.md", "my-repo/README.md", true)
	if got != "my-repo/README.md" {
		t.Errorf("relative absolutePath should degrade to displayPath, got %q", got)
	}
	if strings.Contains(got, osc8Open) {
		t.Error("should not produce OSC 8 sequence for relative path")
	}
}

// =============================================================================
// fileURI — file path to file:// URI conversion
// =============================================================================

func TestFileURI_SimpleAbsolutePath(t *testing.T) {
	got := fileURI("/Users/foo/bar.go")
	want := "file:///Users/foo/bar.go"
	if got != want {
		t.Errorf("fileURI() = %q, want %q", got, want)
	}
}

func TestFileURI_RootPath(t *testing.T) {
	got := fileURI("/")
	want := "file:///"
	if got != want {
		t.Errorf("fileURI(\"/\") = %q, want %q", got, want)
	}
}

func TestFileURI_PathWithSpaces(t *testing.T) {
	got := fileURI("/Users/foo/My Documents/file.go")
	if !strings.Contains(got, "My%20Documents") {
		t.Errorf("spaces should be percent-encoded, got %q", got)
	}
	if !strings.HasPrefix(got, "file:///") {
		t.Errorf("should start with file:///, got %q", got)
	}
}

func TestFileURI_PathWithSpecialChars(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{"hash", "/path/file#1.go", "file%231.go"},
		{"percent", "/path/100%25.go", "100%2525.go"},
		{"question mark", "/path/what?.go", "what%3F.go"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := fileURI(tt.path)
			if !strings.Contains(got, tt.want) {
				t.Errorf("fileURI(%q): expected %q in result, got %q", tt.path, tt.want, got)
			}
		})
	}
}

func TestFileURI_DeepNestedPath(t *testing.T) {
	got := fileURI("/a/b/c/d/e/f/g.go")
	want := "file:///a/b/c/d/e/f/g.go"
	if got != want {
		t.Errorf("fileURI() = %q, want %q", got, want)
	}
}

// =============================================================================
// HyperlinksEnabled — terminal capability detection
// =============================================================================

func TestHyperlinksEnabled_NonFileWriter_ReturnsFalse(t *testing.T) {
	var buf bytes.Buffer
	if HyperlinksEnabled(&buf) {
		t.Error("HyperlinksEnabled(bytes.Buffer) should be false")
	}
}

func TestHyperlinksEnabled_PipeWriter_ReturnsFalse(t *testing.T) {
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() failed: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if HyperlinksEnabled(w) {
		t.Error("HyperlinksEnabled(pipe) should be false (pipe is not a TTY)")
	}
}

func TestHyperlinksEnabled_TermDumb_ReturnsFalse(t *testing.T) {
	t.Setenv("TERM", "dumb")
	t.Setenv("NO_COLOR", "")
	os.Unsetenv("NO_COLOR")

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() failed: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if HyperlinksEnabled(w) {
		t.Error("HyperlinksEnabled should be false when TERM=dumb")
	}
}

func TestHyperlinksEnabled_NoColor_ReturnsFalse(t *testing.T) {
	t.Setenv("NO_COLOR", "1")
	t.Setenv("TERM", "xterm-256color")

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() failed: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if HyperlinksEnabled(w) {
		t.Error("HyperlinksEnabled should be false when NO_COLOR is set")
	}
}

func TestHyperlinksEnabled_NoColorEmpty_ReturnsFalse(t *testing.T) {
	t.Setenv("NO_COLOR", "")

	r, w, err := os.Pipe()
	if err != nil {
		t.Fatalf("os.Pipe() failed: %v", err)
	}
	defer r.Close()
	defer w.Close()

	if HyperlinksEnabled(w) {
		t.Error("HyperlinksEnabled should be false when NO_COLOR is set (even empty value)")
	}
}

func TestHyperlinksEnabled_NilWriter_ReturnsFalse(t *testing.T) {
	if HyperlinksEnabled(nil) {
		t.Error("HyperlinksEnabled(nil) should be false")
	}
}

// =============================================================================
// OSC 8 structure verification
// =============================================================================

func TestOSC8_SequenceStructure(t *testing.T) {
	link := Hyperlink("text", "file:///path")

	esc := "\033"

	if !strings.HasPrefix(link, esc+"]8;;") {
		t.Error("OSC 8 should start with ESC ] 8 ;;")
	}

	if !strings.Contains(link, esc+"\\") {
		t.Error("OSC 8 should contain String Terminator (ESC + backslash)")
	}

	parts := strings.Split(link, esc+"\\")
	if len(parts) < 3 {
		t.Errorf("expected at least 3 segments split by ST, got %d: %q", len(parts), parts)
	}
}

func TestOSC8_Constants_WellFormed(t *testing.T) {
	if osc8Open != "\033]8;;" {
		t.Errorf("osc8Open = %q, want %q", osc8Open, "\033]8;;")
	}
	if st != "\033\\" {
		t.Errorf("st = %q, want %q", st, "\033\\")
	}
	if osc8Close != "\033]8;;\033\\" {
		t.Errorf("osc8Close = %q, want %q", osc8Close, "\033]8;;\033\\")
	}
}
