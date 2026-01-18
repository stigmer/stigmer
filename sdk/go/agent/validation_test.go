package agent

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateName(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		errType error
	}{
		// Valid names
		{name: "valid lowercase", input: "test-agent", wantErr: false},
		{name: "valid single char", input: "a", wantErr: false},
		{name: "valid with numbers", input: "agent-123", wantErr: false},
		{name: "valid max length", input: strings.Repeat("a", 63), wantErr: false},
		{name: "valid hyphen middle", input: "test-agent-v2", wantErr: false},

		// Invalid names
		{name: "empty", input: "", wantErr: true, errType: ErrInvalidName},
		{name: "too long", input: strings.Repeat("a", 64), wantErr: true, errType: ErrInvalidName},
		{name: "uppercase", input: "TestAgent", wantErr: true, errType: ErrInvalidName},
		{name: "underscore", input: "test_agent", wantErr: true, errType: ErrInvalidName},
		{name: "space", input: "test agent", wantErr: true, errType: ErrInvalidName},
		{name: "special chars", input: "test@agent", wantErr: true, errType: ErrInvalidName},
		{name: "start with hyphen", input: "-test", wantErr: true, errType: ErrInvalidName},
		{name: "end with hyphen", input: "test-", wantErr: true, errType: ErrInvalidName},
		{name: "only hyphen", input: "-", wantErr: true, errType: ErrInvalidName},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateName(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Errorf("validateName(%q) expected error but got none", tt.input)
					return
				}

				var validationErr *ValidationError
				if !errors.As(err, &validationErr) {
					t.Errorf("validateName(%q) error is not ValidationError: %v", tt.input, err)
					return
				}

				if tt.errType != nil && !errors.Is(validationErr, tt.errType) {
					t.Errorf("validateName(%q) error type = %v, want %v", tt.input, err, tt.errType)
				}
			} else {
				if err != nil {
					t.Errorf("validateName(%q) unexpected error = %v", tt.input, err)
				}
			}
		})
	}
}

func TestValidateInstructions(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		errType error
	}{
		// Valid instructions
		{name: "valid min length", input: "1234567890", wantErr: false},
		{name: "valid typical", input: "This is a test agent with valid instructions", wantErr: false},
		{name: "valid max length", input: strings.Repeat("a", 10000), wantErr: false},
		{name: "valid with whitespace", input: "  Valid instructions  ", wantErr: false},

		// Invalid instructions
		{name: "empty", input: "", wantErr: true, errType: ErrInvalidInstructions},
		{name: "too short", input: "short", wantErr: true, errType: ErrInvalidInstructions},
		{name: "too long", input: strings.Repeat("a", 10001), wantErr: true, errType: ErrInvalidInstructions},
		{name: "only whitespace", input: "         ", wantErr: true, errType: ErrInvalidInstructions},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateInstructions(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Errorf("validateInstructions(%q) expected error but got none", tt.input)
					return
				}

				var validationErr *ValidationError
				if !errors.As(err, &validationErr) {
					t.Errorf("validateInstructions(%q) error is not ValidationError: %v", tt.input, err)
					return
				}

				if tt.errType != nil && !errors.Is(validationErr, tt.errType) {
					t.Errorf("validateInstructions(%q) error type = %v, want %v", tt.input, err, tt.errType)
				}
			} else {
				if err != nil {
					t.Errorf("validateInstructions(%q) unexpected error = %v", tt.input, err)
				}
			}
		})
	}
}

func TestValidateDescription(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		errType error
	}{
		// Valid descriptions
		{name: "empty (optional)", input: "", wantErr: false},
		{name: "valid short", input: "Test agent", wantErr: false},
		{name: "valid max length", input: strings.Repeat("a", 500), wantErr: false},

		// Invalid descriptions
		{name: "too long", input: strings.Repeat("a", 501), wantErr: true, errType: ErrInvalidDescription},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateDescription(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Errorf("validateDescription(%q) expected error but got none", tt.input)
					return
				}

				var validationErr *ValidationError
				if !errors.As(err, &validationErr) {
					t.Errorf("validateDescription(%q) error is not ValidationError: %v", tt.input, err)
					return
				}

				if tt.errType != nil && !errors.Is(validationErr, tt.errType) {
					t.Errorf("validateDescription(%q) error type = %v, want %v", tt.input, err, tt.errType)
				}
			} else {
				if err != nil {
					t.Errorf("validateDescription(%q) unexpected error = %v", tt.input, err)
				}
			}
		})
	}
}

func TestValidateIconURL(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		wantErr bool
		errType error
	}{
		// Valid URLs
		{name: "valid http", input: "http://example.com/icon.png", wantErr: false},
		{name: "valid https", input: "https://example.com/icon.png", wantErr: false},
		{name: "valid with path", input: "https://example.com/path/to/icon.png", wantErr: false},
		{name: "valid with query", input: "https://example.com/icon.png?size=large", wantErr: false},

		// Invalid URLs
		{name: "empty (optional)", input: "", wantErr: false}, // Empty is valid (optional field)
		{name: "invalid format", input: "not-a-url", wantErr: true, errType: ErrInvalidIconURL},
		{name: "missing scheme", input: "example.com/icon.png", wantErr: true, errType: ErrInvalidIconURL},
		{name: "ftp scheme", input: "ftp://example.com/icon.png", wantErr: true, errType: ErrInvalidIconURL},
		{name: "no host", input: "https:///icon.png", wantErr: true, errType: ErrInvalidIconURL},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateIconURL(tt.input)

			if tt.wantErr {
				if err == nil {
					t.Errorf("validateIconURL(%q) expected error but got none", tt.input)
					return
				}

				var validationErr *ValidationError
				if !errors.As(err, &validationErr) {
					t.Errorf("validateIconURL(%q) error is not ValidationError: %v", tt.input, err)
					return
				}

				if tt.errType != nil && !errors.Is(validationErr, tt.errType) {
					t.Errorf("validateIconURL(%q) error type = %v, want %v", tt.input, err, tt.errType)
				}
			} else {
				if err != nil {
					t.Errorf("validateIconURL(%q) unexpected error = %v", tt.input, err)
				}
			}
		})
	}
}

func TestValidate(t *testing.T) {
	tests := []struct {
		name    string
		agent   *Agent
		wantErr bool
	}{
		{
			name: "valid minimal agent",
			agent: &Agent{
				Name:         "test-agent",
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: false,
		},
		{
			name: "valid complete agent",
			agent: &Agent{
				Name:         "test-agent",
				Instructions: "This is a test agent with valid instructions",
				Description:  "Test description",
				IconURL:      "https://example.com/icon.png",
				Org:          "test-org",
			},
			wantErr: false,
		},
		{
			name: "invalid name",
			agent: &Agent{
				Name:         "Invalid Name",
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: true,
		},
		{
			name: "invalid instructions",
			agent: &Agent{
				Name:         "test-agent",
				Instructions: "short",
			},
			wantErr: true,
		},
		{
			name: "invalid description",
			agent: &Agent{
				Name:         "test-agent",
				Instructions: "This is a test agent with valid instructions",
				Description:  strings.Repeat("a", 501),
			},
			wantErr: true,
		},
		{
			name: "invalid icon URL",
			agent: &Agent{
				Name:         "test-agent",
				Instructions: "This is a test agent with valid instructions",
				IconURL:      "not-a-url",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validate(tt.agent)

			if tt.wantErr {
				if err == nil {
					t.Error("validate() expected error but got none")
				}
			} else {
				if err != nil {
					t.Errorf("validate() unexpected error = %v", err)
				}
			}
		})
	}
}
