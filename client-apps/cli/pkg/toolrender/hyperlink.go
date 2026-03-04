package toolrender

import (
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/term"
)

// OSC 8 escape sequence components for terminal hyperlinks.
//
// The OSC 8 protocol wraps display text in a start/end pair:
//
//	\033]8;;<URI>\a<display text>\033]8;;\a
//
// BEL (\a / \007) is used as the string terminator instead of ST (\033\\)
// for broader compatibility. While the spec allows both, BEL is handled
// more reliably by xterm.js-based terminals (VS Code, Cursor), older
// iTerm2 builds, and macOS Terminal.app.
//
// Supported by iTerm2, Wezterm, Kitty, Ghostty, Hyper, GNOME Terminal,
// and most modern terminal emulators. Terminals that don't support it
// render only the display text — the escape sequences are silently ignored.
//
// Reference: https://gist.github.com/egmontkob/eb114294efbcd5adb1944c9f3cb5feda
const (
	osc8Open  = "\033]8;;"     // OSC 8 start: ESC ] 8 ; <params> ;
	osc8Close = "\033]8;;\a"   // OSC 8 end: empty URI terminates the hyperlink
	st        = "\a"           // String Terminator: BEL (broader compat than ESC \)
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
// enabled is false or absolutePath is not an absolute path (graceful
// degradation — a relative path would produce a malformed file:// URI where
// the first path segment is misinterpreted as a hostname).
//
// The enabled parameter is intentionally explicit rather than auto-detected:
// callers should query HyperlinksEnabled once at initialization and thread
// the result through, avoiding per-call environment checks.
func FileHyperlink(displayPath, absolutePath string, enabled bool) string {
	if !enabled || !filepath.IsAbs(absolutePath) {
		return displayPath
	}
	return Hyperlink(displayPath, fileURI(absolutePath))
}

// fileURI converts an absolute filesystem path to a file:// URI with proper
// percent-encoding for spaces, unicode, and URI-significant characters.
//
// The caller must ensure absPath is absolute. Relative paths produce
// malformed URIs where the first segment becomes the host component
// (e.g., "src/main.go" → "file://src/main.go" where "src" is the host).
func fileURI(absPath string) string {
	return (&url.URL{Scheme: "file", Path: absPath}).String()
}

// osc8SupportedTerminals lists TERM_PROGRAM values for terminals known to
// handle OSC 8 hyperlinks correctly. Used by HyperlinksEnabled when no
// explicit override is set. An allowlist is intentionally conservative —
// plain text is always safe; broken hyperlinks that open a browser are not.
var osc8SupportedTerminals = map[string]bool{
	"iTerm.app": true,
	"WezTerm":   true,
	"ghostty":   true,
	"vscode":    true,
	"tmux":      true,
	"kitty":     true,
}

// HyperlinksEnabled reports whether the terminal attached to w supports
// OSC 8 hyperlinks. The detection is layered:
//
//  1. STIGMER_HYPERLINKS env var — explicit override. "on"/"1"/"true" forces
//     enable; "off"/"0"/"false" forces disable. Takes precedence over all
//     other checks.
//  2. TTY check — w must be an *os.File backed by a terminal.
//  3. TERM=dumb / NO_COLOR — environments that cannot handle escape sequences.
//  4. TERM_PROGRAM allowlist — only terminals known to support OSC 8 are
//     enabled. Unknown terminals degrade to plain text. Users can override
//     with STIGMER_HYPERLINKS=on.
//
// This function reads environment variables and should be called once per
// renderer lifecycle, not per tool call.
func HyperlinksEnabled(w io.Writer) bool {
	if v, set := os.LookupEnv("STIGMER_HYPERLINKS"); set {
		return isEnvTrue(v)
	}

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
	return osc8SupportedTerminals[os.Getenv("TERM_PROGRAM")]
}

// isEnvTrue interprets a boolean-ish environment variable value.
func isEnvTrue(v string) bool {
	switch strings.ToLower(v) {
	case "on", "1", "true", "yes":
		return true
	default:
		return false
	}
}
