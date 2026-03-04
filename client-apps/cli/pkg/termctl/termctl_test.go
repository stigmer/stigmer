package termctl

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"strings"
	"testing"
)

// =============================================================================
// EraseLines
// =============================================================================

func TestEraseLines_SingleLine(t *testing.T) {
	var buf bytes.Buffer
	EraseLines(&buf, 1)
	want := "\r\033[J"
	if got := buf.String(); got != want {
		t.Errorf("EraseLines(w, 1) wrote %q, want %q", got, want)
	}
}

func TestEraseLines_MultipleLines(t *testing.T) {
	tests := []struct {
		n    int
		want string
	}{
		{2, "\033[1A\r\033[J"},
		{5, "\033[4A\r\033[J"},
		{10, "\033[9A\r\033[J"},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("n=%d", tt.n), func(t *testing.T) {
			var buf bytes.Buffer
			EraseLines(&buf, tt.n)
			if got := buf.String(); got != tt.want {
				t.Errorf("EraseLines(w, %d) wrote %q, want %q", tt.n, got, tt.want)
			}
		})
	}
}

func TestEraseLines_ZeroIsNoop(t *testing.T) {
	var buf bytes.Buffer
	EraseLines(&buf, 0)
	if buf.Len() != 0 {
		t.Errorf("EraseLines(w, 0) wrote %q, want no output", buf.String())
	}
}

func TestEraseLines_NegativeIsNoop(t *testing.T) {
	var buf bytes.Buffer
	EraseLines(&buf, -3)
	if buf.Len() != 0 {
		t.Errorf("EraseLines(w, -3) wrote %q, want no output", buf.String())
	}
}

// writeCounter counts the number of Write calls made to the underlying writer.
type writeCounter struct {
	buf   bytes.Buffer
	calls int
}

func (wc *writeCounter) Write(p []byte) (int, error) {
	wc.calls++
	return wc.buf.Write(p)
}

func TestEraseLines_AtomicWrite_SingleLine(t *testing.T) {
	wc := &writeCounter{}
	EraseLines(wc, 1)
	if wc.calls != 1 {
		t.Errorf("EraseLines(w, 1) made %d Write calls, want 1", wc.calls)
	}
}

func TestEraseLines_AtomicWrite_MultipleLines(t *testing.T) {
	wc := &writeCounter{}
	EraseLines(wc, 5)
	if wc.calls != 1 {
		t.Errorf("EraseLines(w, 5) made %d Write calls, want 1", wc.calls)
	}
}

// =============================================================================
// Width
// =============================================================================

func TestWidth_BufferReturnsFallback(t *testing.T) {
	var buf bytes.Buffer
	got := Width(&buf, 120)
	if got != 120 {
		t.Errorf("Width(buffer, 120) = %d, want 120", got)
	}
}

func TestWidth_DevNullReturnsFallback(t *testing.T) {
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Skipf("cannot open %s: %v", os.DevNull, err)
	}
	defer f.Close()

	got := Width(f, 80)
	if got != 80 {
		t.Errorf("Width(/dev/null, 80) = %d, want 80", got)
	}
}

func TestWidth_DifferentDefaults(t *testing.T) {
	var buf bytes.Buffer
	for _, def := range []int{40, 80, 120, 200} {
		got := Width(&buf, def)
		if got != def {
			t.Errorf("Width(buffer, %d) = %d, want %d", def, got, def)
		}
	}
}

// =============================================================================
// IsSupported
// =============================================================================

func TestIsSupported_BufferReturnsFalse(t *testing.T) {
	var buf bytes.Buffer
	if IsSupported(&buf) {
		t.Error("IsSupported(bytes.Buffer) = true, want false")
	}
}

func TestIsSupported_DevNullReturnsFalse(t *testing.T) {
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Skipf("cannot open %s: %v", os.DevNull, err)
	}
	defer f.Close()

	if IsSupported(f) {
		t.Errorf("IsSupported(/dev/null) = true, want false")
	}
}

// =============================================================================
// unwrapFile / Wrapped writer support
// =============================================================================

// wrappedWriter implements Unwrap() to let termctl see through to the inner writer.
type wrappedWriter struct {
	inner io.Writer
}

func (w *wrappedWriter) Write(p []byte) (int, error) { return w.inner.Write(p) }
func (w *wrappedWriter) Unwrap() io.Writer            { return w.inner }

// doubleWrappedWriter wraps a wrappedWriter to test multi-level unwrapping.
type doubleWrappedWriter struct {
	inner io.Writer
}

func (w *doubleWrappedWriter) Write(p []byte) (int, error) { return w.inner.Write(p) }
func (w *doubleWrappedWriter) Unwrap() io.Writer            { return w.inner }

// opaqueWriter does NOT implement Unwrap — termctl should return nil / fallback.
type opaqueWriter struct {
	inner io.Writer
}

func (w *opaqueWriter) Write(p []byte) (int, error) { return w.inner.Write(p) }

func TestUnwrapFile_DirectFile(t *testing.T) {
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Skipf("cannot open %s: %v", os.DevNull, err)
	}
	defer f.Close()

	got := unwrapFile(f)
	if got != f {
		t.Errorf("unwrapFile(os.File) should return the same file, got %v", got)
	}
}

func TestUnwrapFile_SingleWrap(t *testing.T) {
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Skipf("cannot open %s: %v", os.DevNull, err)
	}
	defer f.Close()

	w := &wrappedWriter{inner: f}
	got := unwrapFile(w)
	if got != f {
		t.Errorf("unwrapFile(wrappedWriter{os.File}) should return the file, got %v", got)
	}
}

func TestUnwrapFile_DoubleWrap(t *testing.T) {
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Skipf("cannot open %s: %v", os.DevNull, err)
	}
	defer f.Close()

	inner := &wrappedWriter{inner: f}
	outer := &doubleWrappedWriter{inner: inner}
	got := unwrapFile(outer)
	if got != f {
		t.Errorf("unwrapFile(double-wrapped) should return the file, got %v", got)
	}
}

func TestUnwrapFile_OpaqueWrapper(t *testing.T) {
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Skipf("cannot open %s: %v", os.DevNull, err)
	}
	defer f.Close()

	w := &opaqueWriter{inner: f}
	got := unwrapFile(w)
	if got != nil {
		t.Errorf("unwrapFile(opaqueWriter) should return nil, got %v", got)
	}
}

func TestUnwrapFile_Buffer(t *testing.T) {
	var buf bytes.Buffer
	got := unwrapFile(&buf)
	if got != nil {
		t.Errorf("unwrapFile(bytes.Buffer) should return nil, got %v", got)
	}
}

func TestIsSupported_WrappedDevNull(t *testing.T) {
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Skipf("cannot open %s: %v", os.DevNull, err)
	}
	defer f.Close()

	w := &wrappedWriter{inner: f}
	// /dev/null is not a terminal, so IsSupported should still return false,
	// but it should reach the terminal check (not fail at the type assertion).
	if IsSupported(w) {
		t.Error("IsSupported(wrapped /dev/null) = true, want false")
	}
}

func TestIsSupported_OpaqueWrapper(t *testing.T) {
	w := &opaqueWriter{inner: os.Stderr}
	if IsSupported(w) {
		t.Error("IsSupported(opaqueWriter) should return false for non-unwrappable wrapper")
	}
}

func TestWidth_WrappedDevNull(t *testing.T) {
	f, err := os.Open(os.DevNull)
	if err != nil {
		t.Skipf("cannot open %s: %v", os.DevNull, err)
	}
	defer f.Close()

	w := &wrappedWriter{inner: f}
	got := Width(w, 120)
	// /dev/null won't report a terminal size, so fallback is expected.
	if got != 120 {
		t.Errorf("Width(wrapped /dev/null, 120) = %d, want 120", got)
	}
}

func TestWidth_OpaqueWrapper(t *testing.T) {
	w := &opaqueWriter{inner: os.Stderr}
	got := Width(w, 99)
	if got != 99 {
		t.Errorf("Width(opaqueWriter, 99) = %d, want 99", got)
	}
}

// =============================================================================
// DisplayRows — basic cases
// =============================================================================

func TestDisplayRows_EmptyString(t *testing.T) {
	if got := DisplayRows("", 80); got != 0 {
		t.Errorf("DisplayRows(\"\", 80) = %d, want 0", got)
	}
}

func TestDisplayRows_SingleLine(t *testing.T) {
	if got := DisplayRows("hello", 80); got != 1 {
		t.Errorf("DisplayRows(\"hello\", 80) = %d, want 1", got)
	}
}

func TestDisplayRows_MultiLine(t *testing.T) {
	if got := DisplayRows("hello\nworld", 80); got != 2 {
		t.Errorf("DisplayRows(\"hello\\nworld\", 80) = %d, want 2", got)
	}
}

func TestDisplayRows_ThreeLines(t *testing.T) {
	if got := DisplayRows("a\nb\nc", 80); got != 3 {
		t.Errorf("DisplayRows(\"a\\nb\\nc\", 80) = %d, want 3", got)
	}
}

// =============================================================================
// DisplayRows — trailing newline
// =============================================================================

func TestDisplayRows_TrailingNewline_SingleLine(t *testing.T) {
	if got := DisplayRows("hello\n", 80); got != 1 {
		t.Errorf("DisplayRows(\"hello\\n\", 80) = %d, want 1", got)
	}
}

func TestDisplayRows_TrailingNewline_MultiLine(t *testing.T) {
	if got := DisplayRows("hello\nworld\n", 80); got != 2 {
		t.Errorf("DisplayRows(\"hello\\nworld\\n\", 80) = %d, want 2", got)
	}
}

func TestDisplayRows_OnlyNewline(t *testing.T) {
	if got := DisplayRows("\n", 80); got != 1 {
		t.Errorf("DisplayRows(\"\\n\", 80) = %d, want 1", got)
	}
}

func TestDisplayRows_TwoNewlines(t *testing.T) {
	if got := DisplayRows("\n\n", 80); got != 2 {
		t.Errorf("DisplayRows(\"\\n\\n\", 80) = %d, want 2", got)
	}
}

// =============================================================================
// DisplayRows — line wrapping
// =============================================================================

func TestDisplayRows_ExactWidth(t *testing.T) {
	line := strings.Repeat("x", 80)
	if got := DisplayRows(line, 80); got != 1 {
		t.Errorf("DisplayRows(80 chars, 80) = %d, want 1", got)
	}
}

func TestDisplayRows_WidthPlusOne(t *testing.T) {
	line := strings.Repeat("x", 81)
	if got := DisplayRows(line, 80); got != 2 {
		t.Errorf("DisplayRows(81 chars, 80) = %d, want 2", got)
	}
}

func TestDisplayRows_DoubleWidth(t *testing.T) {
	line := strings.Repeat("x", 160)
	if got := DisplayRows(line, 80); got != 2 {
		t.Errorf("DisplayRows(160 chars, 80) = %d, want 2", got)
	}
}

func TestDisplayRows_TripleWidthPlusPartial(t *testing.T) {
	line := strings.Repeat("x", 250)
	if got := DisplayRows(line, 80); got != 4 {
		t.Errorf("DisplayRows(250 chars, 80) = %d, want 4 (ceil(250/80)=4)", got)
	}
}

func TestDisplayRows_MixedWrappingAndShort(t *testing.T) {
	long := strings.Repeat("x", 160)
	text := long + "\nshort"
	if got := DisplayRows(text, 80); got != 3 {
		t.Errorf("DisplayRows(160-char line + short, 80) = %d, want 3", got)
	}
}

// =============================================================================
// DisplayRows — empty lines in middle
// =============================================================================

func TestDisplayRows_EmptyLineInMiddle(t *testing.T) {
	if got := DisplayRows("hello\n\nworld", 80); got != 3 {
		t.Errorf("DisplayRows(\"hello\\n\\nworld\", 80) = %d, want 3", got)
	}
}

func TestDisplayRows_MultipleEmptyLines(t *testing.T) {
	if got := DisplayRows("a\n\n\n\nb", 80); got != 5 {
		t.Errorf("DisplayRows(\"a\\n\\n\\n\\nb\", 80) = %d, want 5", got)
	}
}

// =============================================================================
// DisplayRows — ANSI escape sequences
// =============================================================================

func TestDisplayRows_ANSIColor(t *testing.T) {
	colored := "\033[31mhello\033[0m"
	if got := DisplayRows(colored, 80); got != 1 {
		t.Errorf("DisplayRows(red \"hello\", 80) = %d, want 1", got)
	}
}

func TestDisplayRows_OSC8Hyperlink(t *testing.T) {
	link := "\033]8;;file:///tmp/test.go\033\\test.go\033]8;;\033\\"
	if got := DisplayRows(link, 80); got != 1 {
		t.Errorf("DisplayRows(OSC8 hyperlink \"test.go\", 80) = %d, want 1", got)
	}
}

func TestDisplayRows_ANSIDoesNotAffectWrapping(t *testing.T) {
	// 80 visible chars wrapped in color codes — should be 1 row, not 2.
	visible := strings.Repeat("x", 80)
	colored := "\033[1;32m" + visible + "\033[0m"
	if got := DisplayRows(colored, 80); got != 1 {
		t.Errorf("DisplayRows(colored 80-char line, 80) = %d, want 1", got)
	}
}

// =============================================================================
// DisplayRows — width edge cases
// =============================================================================

func TestDisplayRows_ZeroWidth(t *testing.T) {
	if got := DisplayRows("hello", 0); got != 0 {
		t.Errorf("DisplayRows(\"hello\", 0) = %d, want 0", got)
	}
}

func TestDisplayRows_NegativeWidth(t *testing.T) {
	if got := DisplayRows("hello", -1); got != 0 {
		t.Errorf("DisplayRows(\"hello\", -1) = %d, want 0", got)
	}
}

func TestDisplayRows_WidthOne(t *testing.T) {
	if got := DisplayRows("abc", 1); got != 3 {
		t.Errorf("DisplayRows(\"abc\", 1) = %d, want 3", got)
	}
}
