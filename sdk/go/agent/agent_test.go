package agent

import (
	"errors"
	"testing"
)

func TestNew(t *testing.T) {
	tests := []struct {
		name      string
		agentName string
		args      *AgentArgs
		wantErr   bool
		errType   error
	}{
		{
			name:      "valid agent with required fields",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: false,
		},
		{
			name:      "valid agent with all fields",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "This is a test agent with valid instructions",
				Description:  "A test agent",
				IconUrl:      "https://example.com/icon.png",
			},
			wantErr: false,
		},
		{
			name:      "missing name",
			agentName: "",
			args: &AgentArgs{
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "missing instructions",
			agentName: "test-agent",
			args:      &AgentArgs{},
			wantErr:   true,
			errType:   ErrInvalidInstructions,
		},
		{
			name:      "invalid name - uppercase",
			agentName: "TestAgent",
			args: &AgentArgs{
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "invalid name - special chars",
			agentName: "test_agent!",
			args: &AgentArgs{
				Instructions: "This is a test agent with valid instructions",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "invalid instructions - too short",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "short",
			},
			wantErr: true,
			errType: ErrInvalidInstructions,
		},
		{
			name:      "invalid description - too long",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "This is a test agent with valid instructions",
				Description:  string(make([]byte, 501)),
			},
			wantErr: true,
			errType: ErrInvalidDescription,
		},
		{
			name:      "invalid icon URL",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "This is a test agent with valid instructions",
				IconUrl:      "not-a-url",
			},
			wantErr: true,
			errType: ErrInvalidIconURL,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent, err := New(nil, tt.agentName, tt.args)

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
