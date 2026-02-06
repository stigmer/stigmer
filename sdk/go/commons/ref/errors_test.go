package ref

import (
	"errors"
	"testing"
)

func TestParseError_Error(t *testing.T) {
	tests := []struct {
		name string
		err  *ParseError
		want string
	}{
		{
			name: "skill error with input",
			err: &ParseError{
				Kind:    "skill",
				Input:   "bad-input",
				Message: "something went wrong",
				Err:     ErrInvalidFormat,
			},
			want: `ref: skill: something went wrong (input: "bad-input")`,
		},
		{
			name: "mcp_server error with input",
			err: &ParseError{
				Kind:    "mcp_server",
				Input:   "/invalid",
				Message: "organization is empty",
				Err:     ErrEmptyOrg,
			},
			want: `ref: mcp_server: organization is empty (input: "/invalid")`,
		},
		{
			name: "error without input",
			err: &ParseError{
				Kind:    "skill",
				Input:   "",
				Message: "reference string is empty",
				Err:     ErrInvalidFormat,
			},
			want: `ref: skill: reference string is empty`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.want {
				t.Errorf("Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestParseError_Unwrap(t *testing.T) {
	tests := []struct {
		name       string
		parseErr   *ParseError
		wantSentinel error
	}{
		{
			name: "unwrap ErrInvalidFormat",
			parseErr: &ParseError{
				Kind:    "skill",
				Input:   "test",
				Message: "test message",
				Err:     ErrInvalidFormat,
			},
			wantSentinel: ErrInvalidFormat,
		},
		{
			name: "unwrap ErrEmptyOrg",
			parseErr: &ParseError{
				Kind:    "skill",
				Input:   "/slug",
				Message: "organization is empty",
				Err:     ErrEmptyOrg,
			},
			wantSentinel: ErrEmptyOrg,
		},
		{
			name: "unwrap ErrEmptySlug",
			parseErr: &ParseError{
				Kind:    "mcp_server",
				Input:   "org/",
				Message: "slug is empty",
				Err:     ErrEmptySlug,
			},
			wantSentinel: ErrEmptySlug,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if !errors.Is(tt.parseErr, tt.wantSentinel) {
				t.Errorf("errors.Is(%v, %v) = false, want true", tt.parseErr, tt.wantSentinel)
			}

			// Verify Unwrap returns the correct error
			if got := tt.parseErr.Unwrap(); got != tt.wantSentinel {
				t.Errorf("Unwrap() = %v, want %v", got, tt.wantSentinel)
			}
		})
	}
}

func TestParseError_ErrorsAs(t *testing.T) {
	// Test that errors.As works correctly with ParseError
	t.Run("errors.As with ParseSkill error", func(t *testing.T) {
		_, err := ParseSkill("/invalid")
		
		var parseErr *ParseError
		if !errors.As(err, &parseErr) {
			t.Fatal("errors.As should return true for ParseError")
		}
		
		if parseErr.Kind != "skill" {
			t.Errorf("ParseError.Kind = %q, want %q", parseErr.Kind, "skill")
		}
		if parseErr.Input != "/invalid" {
			t.Errorf("ParseError.Input = %q, want %q", parseErr.Input, "/invalid")
		}
	})

	t.Run("errors.As with ParseMcpServer error", func(t *testing.T) {
		_, err := ParseMcpServer("no-slash")
		
		var parseErr *ParseError
		if !errors.As(err, &parseErr) {
			t.Fatal("errors.As should return true for ParseError")
		}
		
		if parseErr.Kind != "mcp_server" {
			t.Errorf("ParseError.Kind = %q, want %q", parseErr.Kind, "mcp_server")
		}
		if parseErr.Input != "no-slash" {
			t.Errorf("ParseError.Input = %q, want %q", parseErr.Input, "no-slash")
		}
	})
}

func TestSentinelErrors(t *testing.T) {
	// Verify sentinel errors are distinct
	if errors.Is(ErrInvalidFormat, ErrEmptyOrg) {
		t.Error("ErrInvalidFormat should not match ErrEmptyOrg")
	}
	if errors.Is(ErrInvalidFormat, ErrEmptySlug) {
		t.Error("ErrInvalidFormat should not match ErrEmptySlug")
	}
	if errors.Is(ErrEmptyOrg, ErrEmptySlug) {
		t.Error("ErrEmptyOrg should not match ErrEmptySlug")
	}

	// Verify error messages
	if ErrInvalidFormat.Error() != "invalid reference format" {
		t.Errorf("ErrInvalidFormat.Error() = %q", ErrInvalidFormat.Error())
	}
	if ErrEmptyOrg.Error() != "organization cannot be empty" {
		t.Errorf("ErrEmptyOrg.Error() = %q", ErrEmptyOrg.Error())
	}
	if ErrEmptySlug.Error() != "slug cannot be empty" {
		t.Errorf("ErrEmptySlug.Error() = %q", ErrEmptySlug.Error())
	}
}

func TestNewParseError(t *testing.T) {
	err := newParseError("skill", "test-input", "test message", ErrInvalidFormat)

	if err.Kind != "skill" {
		t.Errorf("Kind = %q, want %q", err.Kind, "skill")
	}
	if err.Input != "test-input" {
		t.Errorf("Input = %q, want %q", err.Input, "test-input")
	}
	if err.Message != "test message" {
		t.Errorf("Message = %q, want %q", err.Message, "test message")
	}
	if err.Err != ErrInvalidFormat {
		t.Errorf("Err = %v, want %v", err.Err, ErrInvalidFormat)
	}
}
