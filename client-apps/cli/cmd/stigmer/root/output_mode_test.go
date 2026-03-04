package root

import (
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

func TestResolveOutputMode_NoFlags_AlwaysInline(t *testing.T) {
	mode := resolveOutputMode(outputModeFlags{})
	if mode != OutputInline {
		t.Errorf("expected OutputInline without flags, got %v", mode)
	}
}

func TestResolveOutputMode_DefaultFlags_AreZeroValues(t *testing.T) {
	flags := outputModeFlags{}
	if flags.JSON {
		t.Error("default JSON flag should be false")
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
