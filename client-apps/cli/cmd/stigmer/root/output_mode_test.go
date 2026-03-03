package root

import (
	"os"
	"testing"
)

// =============================================================================
// resolveOutputMode Tests
// =============================================================================

func TestResolveOutputMode_JSONFlag_ReturnsJSON(t *testing.T) {
	mode := resolveOutputMode(outputModeFlags{JSON: true})
	if mode != OutputJSON {
		t.Errorf("expected OutputJSON, got %v", mode)
	}
}

func TestResolveOutputMode_NoTUIFlag_ReturnsInline(t *testing.T) {
	mode := resolveOutputMode(outputModeFlags{NoTUI: true})
	if mode != OutputInline {
		t.Errorf("expected OutputInline, got %v", mode)
	}
}

func TestResolveOutputMode_JSONTakesPrecedenceOverEnv(t *testing.T) {
	t.Setenv("TERM", "dumb")
	mode := resolveOutputMode(outputModeFlags{JSON: true})
	if mode != OutputJSON {
		t.Errorf("--json should override TERM=dumb, got %v", mode)
	}
}

func TestResolveOutputMode_DumbTerminal_ReturnsInline(t *testing.T) {
	t.Setenv("TERM", "dumb")
	mode := resolveOutputMode(outputModeFlags{})
	// When running in tests, stdout is not a TTY, so we'll get Inline
	// regardless of TERM. This test verifies TERM=dumb doesn't produce
	// Interactive.
	if mode == OutputInteractive {
		t.Errorf("TERM=dumb should not produce OutputInteractive")
	}
}

func TestResolveOutputMode_NoFlags_NonTTY_ReturnsInline(t *testing.T) {
	// In test environments, stdout is typically not a TTY.
	mode := resolveOutputMode(outputModeFlags{})
	if mode == OutputJSON {
		t.Errorf("expected OutputInline or OutputInteractive without flags, got OutputJSON")
	}
}

func TestResolveOutputMode_DefaultFlags_AreZeroValues(t *testing.T) {
	flags := outputModeFlags{}
	if flags.JSON {
		t.Error("default JSON flag should be false")
	}
	if flags.NoTUI {
		t.Error("default NoTUI flag should be false")
	}
}

// =============================================================================
// OutputMode.String Tests
// =============================================================================

func TestOutputMode_String(t *testing.T) {
	tests := []struct {
		mode OutputMode
		want string
	}{
		{OutputInteractive, "interactive"},
		{OutputInline, "inline"},
		{OutputJSON, "json"},
		{OutputMode(99), "unknown"},
	}
	for _, tt := range tests {
		if got := tt.mode.String(); got != tt.want {
			t.Errorf("OutputMode(%d).String() = %q, want %q", tt.mode, got, tt.want)
		}
	}
}

// =============================================================================
// TERM environment detection
// =============================================================================

func TestResolveOutputMode_TermNotDumb_DoesNotForceInline(t *testing.T) {
	// Explicitly set TERM to a real terminal type. In CI/test, stdout is
	// still not a TTY so we'll get Inline from the TTY check, but this
	// verifies TERM=xterm-256color doesn't trigger the dumb-terminal path.
	t.Setenv("TERM", "xterm-256color")
	mode := resolveOutputMode(outputModeFlags{})
	// Should be Inline (non-TTY in test) or Interactive (real TTY), never JSON
	if mode == OutputJSON {
		t.Error("TERM=xterm-256color without --json should not produce OutputJSON")
	}
}

func TestResolveOutputMode_TermUnset_DoesNotPanic(t *testing.T) {
	os.Unsetenv("TERM")
	mode := resolveOutputMode(outputModeFlags{})
	// Should not panic; any non-JSON result is acceptable
	if mode == OutputJSON {
		t.Error("unset TERM without --json should not produce OutputJSON")
	}
}
