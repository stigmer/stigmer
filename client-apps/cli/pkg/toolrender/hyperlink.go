package toolrender

import (
	"io"
	"net/url"
	"os"

	"golang.org/x/term"
)

// OSC 8 escape sequence components for terminal hyperlinks.
//
// The OSC 8 protocol wraps display text in a start/end pair:
//
//	\033]8;;<URI>\033\\<display text>\033]8;;\033\\
//
// Supported by iTerm2, Wezterm, Kitty, Ghostty, Hyper, GNOME Terminal,
// and most modern terminal emulators. Terminals that don't support it
// render only the display text — the escape sequences are silently ignored.
//
// Reference: https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
const (
	osc8Open  = "\033]8;;"       // OSC 8 start: ESC ] 8 ; <params> ;
	osc8Close = "\033]8;;\033\\" // OSC 8 end: empty URI terminates the hyperlink
	st        = "\033\\"         // String Terminator: ESC backslash
)

// Hyperlink wraps displayText in an OSC 8 terminal hyperlink pointing to uri.
// The display text is what the user sees; the URI is revealed on click or hover,
// depending on the terminal emulator.
//
// This is the generic building block — callers that need file:// links should
// prefer FileHyperlink, which handles URI construction and graceful degradation.
func Hyperlink(displayText, uri string) string {
	return osc8Open + uri + st + displayText + osc8Close
}

// FileHyperlink wraps displayPath in an OSC 8 terminal hyperlink that opens
// the file at absolutePath when clicked. Returns displayPath unchanged when
// enabled is false (graceful degradation for non-supporting terminals).
//
// The enabled parameter is intentionally explicit rather than auto-detected:
// callers should query HyperlinksEnabled once at initialization and thread
// the result through, avoiding per-call environment checks.
func FileHyperlink(displayPath, absolutePath string, enabled bool) string {
	if !enabled {
		return displayPath
	}
	return Hyperlink(displayPath, fileURI(absolutePath))
}

// fileURI converts an absolute filesystem path to a file:// URI with proper
// percent-encoding for spaces, unicode, and URI-significant characters.
func fileURI(absPath string) string {
	return (&url.URL{Scheme: "file", Path: absPath}).String()
}

// HyperlinksEnabled reports whether the terminal attached to w supports
// OSC 8 hyperlinks. The check is conservative — it returns false for any
// environment where escape sequences might produce garbled output:
//
//   - w is not an *os.File or its fd is not a TTY (pipes, buffers)
//   - TERM=dumb (minimal terminal that cannot interpret escape sequences)
//   - NO_COLOR is set (user explicitly wants plain, undecorated output)
//
// This function reads environment variables and should be called once per
// renderer lifecycle, not per tool call.
func HyperlinksEnabled(w io.Writer) bool {
	f, ok := w.(*os.File)
	if !ok || !term.IsTerminal(int(f.Fd())) {
		return false
	}
	if os.Getenv("TERM") == "dumb" {
		return false
	}
	if _, set := os.LookupEnv("NO_COLOR"); set {
		return false
	}
	return true
}
