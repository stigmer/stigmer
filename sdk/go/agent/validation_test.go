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
			name: "invalid name - uppercase",
			agent: &Agent{
				Name:         "Invalid Name",
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: true,
		},
		{
			name: "invalid name - empty",
			agent: &Agent{
				Name:         "",
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: true,
		},
		{
			name: "invalid name - too long",
			agent: &Agent{
				Name:         strings.Repeat("a", 64),
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: true,
		},
		{
			name: "invalid name - starts with hyphen",
			agent: &Agent{
				Name:         "-invalid",
				Instructions: "This is a test agent with valid instructions",
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

// Note: Instructions, Description, and IconURL validation is now handled
// by protovalidate in ToProto(). SDK only validates the name format
// (lowercase alphanumeric with hyphens).
