package agent

import (
	"errors"
	"testing"
)

func TestNew(t *testing.T) {
	tests := []struct {
		name    string
		opts    []Option
		wantErr bool
		errType error
	}{
		{
			name: "valid agent with required fields",
			opts: []Option{
				WithName("test-agent"),
				WithInstructions("This is a test agent with valid instructions"),
			},
			wantErr: false,
		},
		{
			name: "valid agent with all fields",
			opts: []Option{
				WithName("test-agent"),
				WithInstructions("This is a test agent with valid instructions"),
				WithDescription("A test agent"),
				WithIconURL("https://example.com/icon.png"),
				WithOrg("test-org"),
			},
			wantErr: false,
		},
		{
			name: "missing name",
			opts: []Option{
				WithInstructions("This is a test agent with valid instructions"),
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name: "missing instructions",
			opts: []Option{
				WithName("test-agent"),
			},
			wantErr: true,
			errType: ErrInvalidInstructions,
		},
		{
			name: "invalid name - uppercase",
			opts: []Option{
				WithName("TestAgent"),
				WithInstructions("This is a test agent with valid instructions"),
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name: "invalid name - special chars",
			opts: []Option{
				WithName("test_agent!"),
				WithInstructions("This is a test agent with valid instructions"),
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name: "invalid instructions - too short",
			opts: []Option{
				WithName("test-agent"),
				WithInstructions("short"),
			},
			wantErr: true,
			errType: ErrInvalidInstructions,
		},
		{
			name: "invalid description - too long",
			opts: []Option{
				WithName("test-agent"),
				WithInstructions("This is a test agent with valid instructions"),
				WithDescription(string(make([]byte, 501))),
			},
			wantErr: true,
			errType: ErrInvalidDescription,
		},
		{
			name: "invalid icon URL",
			opts: []Option{
				WithName("test-agent"),
				WithInstructions("This is a test agent with valid instructions"),
				WithIconURL("not-a-url"),
			},
			wantErr: true,
			errType: ErrInvalidIconURL,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent, err := New(tt.opts...)

			if tt.wantErr {
				if err == nil {
					t.Errorf("New() expected error but got none")
					return
				}

				// Check if error is of expected type
				if tt.errType != nil {
					var validationErr *ValidationError
					if errors.As(err, &validationErr) {
						if !errors.Is(validationErr, tt.errType) {
							t.Errorf("New() error type = %v, want %v", err, tt.errType)
						}
					}
				}
			} else {
				if err != nil {
					t.Errorf("New() unexpected error = %v", err)
					return
				}
				if agent == nil {
					t.Error("New() returned nil agent")
				}
			}
		})
	}
}

func TestAgent_String(t *testing.T) {
	agent := &Agent{
		Name:         "test-agent",
		Instructions: "Test instructions",
	}

	result := agent.String()
	expected := "Agent(name=test-agent)"

	if result != expected {
		t.Errorf("String() = %v, want %v", result, expected)
	}
}

func TestWithName(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "valid name",
			input:    "test-agent",
			expected: "test-agent",
		},
		{
			name:     "empty name",
			input:    "",
			expected: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent := &Agent{}
			opt := WithName(tt.input)
			err := opt(agent)

			if err != nil {
				t.Errorf("WithName() unexpected error = %v", err)
			}
			if agent.Name != tt.expected {
				t.Errorf("WithName() name = %v, want %v", agent.Name, tt.expected)
			}
		})
	}
}

func TestWithInstructions(t *testing.T) {
	instructions := "Test instructions for the agent"
	agent := &Agent{}
	opt := WithInstructions(instructions)
	err := opt(agent)

	if err != nil {
		t.Errorf("WithInstructions() unexpected error = %v", err)
	}
	if agent.Instructions != instructions {
		t.Errorf("WithInstructions() instructions = %v, want %v", agent.Instructions, instructions)
	}
}

func TestWithDescription(t *testing.T) {
	description := "Test description"
	agent := &Agent{}
	opt := WithDescription(description)
	err := opt(agent)

	if err != nil {
		t.Errorf("WithDescription() unexpected error = %v", err)
	}
	if agent.Description != description {
		t.Errorf("WithDescription() description = %v, want %v", agent.Description, description)
	}
}

func TestWithIconURL(t *testing.T) {
	url := "https://example.com/icon.png"
	agent := &Agent{}
	opt := WithIconURL(url)
	err := opt(agent)

	if err != nil {
		t.Errorf("WithIconURL() unexpected error = %v", err)
	}
	if agent.IconURL != url {
		t.Errorf("WithIconURL() icon_url = %v, want %v", agent.IconURL, url)
	}
}

func TestWithOrg(t *testing.T) {
	org := "test-org"
	agent := &Agent{}
	opt := WithOrg(org)
	err := opt(agent)

	if err != nil {
		t.Errorf("WithOrg() unexpected error = %v", err)
	}
	if agent.Org != org {
		t.Errorf("WithOrg() org = %v, want %v", agent.Org, org)
	}
}
