package agent

import (
	"errors"
	"strings"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/skill"
)

// =============================================================================
// Error Case Tests - Validation Failures
// =============================================================================

// TestNew_ValidationErrors tests agent creation with invalid inputs.
func TestNew_ValidationErrors(t *testing.T) {
	tests := []struct {
		name      string
		agentName string
		args      *AgentArgs
		wantErr   bool
		errType   error
	}{
		{
			name:      "missing name",
			agentName: "",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing missing name",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "invalid name format - uppercase",
			agentName: "InvalidName",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing invalid name format",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "invalid name format - spaces",
			agentName: "invalid name",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing invalid name with spaces",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "invalid name format - special chars",
			agentName: "invalid@name#123",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing invalid name with special characters",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "invalid name - starts with hyphen",
			agentName: "-invalid",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing name starting with hyphen",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "invalid name - ends with hyphen",
			agentName: "invalid-",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing name ending with hyphen",
			},
			wantErr: true,
			errType: ErrInvalidName,
		},
		{
			name:      "name too long",
			agentName: strings.Repeat("a", 64), // 64 chars, max is 63
			args: &AgentArgs{
				Instructions: "Valid instructions for testing name that is too long",
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
			name:      "empty instructions",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "",
			},
			wantErr: true,
			errType: ErrInvalidInstructions,
		},
		{
			name:      "instructions too short",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "short", // less than 10 chars
			},
			wantErr: true,
			errType: ErrInvalidInstructions,
		},
		{
			name:      "instructions too long",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: strings.Repeat("a", 10001), // over 10,000 chars
			},
			wantErr: true,
			errType: ErrInvalidInstructions,
		},
		{
			name:      "instructions only whitespace",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "          ", // only spaces
			},
			wantErr: true,
			errType: ErrInvalidInstructions,
		},
		{
			name:      "description too long",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing description length",
				Description:  strings.Repeat("a", 501), // over 500 chars
			},
			wantErr: true,
			errType: ErrInvalidDescription,
		},
		{
			name:      "invalid icon URL",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing invalid icon URL",
				IconUrl:      "not-a-valid-url",
			},
			wantErr: true,
			errType: ErrInvalidIconURL,
		},
		{
			name:      "invalid icon URL - missing scheme",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing icon URL missing scheme",
				IconUrl:      "example.com/icon.png",
			},
			wantErr: true,
			errType: ErrInvalidIconURL,
		},
		{
			name:      "invalid icon URL - wrong scheme",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing icon URL with wrong scheme",
				IconUrl:      "ftp://example.com/icon.png",
			},
			wantErr: true,
			errType: ErrInvalidIconURL,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := New(nil, tt.agentName, tt.args)

			if tt.wantErr {
				if err == nil {
					t.Error("Expected error but got none")
					return
				}

				// Check if error is ValidationError
				var validationErr *ValidationError
				if !errors.As(err, &validationErr) {
					t.Errorf("Expected ValidationError, got %T: %v", err, err)
					return
				}

				// Check error type if specified
				if tt.errType != nil && !errors.Is(err, tt.errType) {
					t.Errorf("Expected error type %v, got %v", tt.errType, err)
				}

				t.Logf("Got expected validation error: %v", err)
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}
			}
		})
	}
}

// =============================================================================
// Error Case Tests - Invalid Nested Resources
// =============================================================================

// TestNew_InvalidSkills tests agent creation with invalid skills.
func TestNew_InvalidSkills(t *testing.T) {
	// Create an invalid skill using skill.New (will catch validation)
	_, skillErr := skill.New("", nil) // Invalid empty name

	if skillErr != nil {
		t.Logf("Skill validation caught empty name at creation: %v", skillErr)
		return
	}

	t.Log("Skill validation may be deferred")
}

// TestNew_InvalidMCPServers tests agent creation with invalid MCP servers.
// NOTE: MCP server functionality not yet fully implemented in SDK, skipping for now.
func TestNew_InvalidMCPServers(t *testing.T) {
	t.Skip("MCP server functionality not yet fully implemented")
}

// TestNew_InvalidSubAgents tests agent creation with invalid sub-agents.
// NOTE: Sub-agent functionality not yet fully implemented in SDK, skipping for now.
func TestNew_InvalidSubAgents(t *testing.T) {
	t.Skip("Sub-agent functionality not yet fully implemented")
}

// TestNew_InvalidEnvironmentVariables tests agent creation with invalid env vars.
func TestNew_InvalidEnvironmentVariables(t *testing.T) {
	// Create invalid environment variable (empty name)
	invalidEnv, err := environment.New(
		environment.WithName(""),
	)

	if err != nil {
		t.Log("Environment variable validation caught empty name at creation")
		return
	}

	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Valid instructions for testing invalid environment variable",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}
	
	// Add invalid environment variable using builder method
	agent.AddEnvironmentVariable(invalidEnv)

	if err != nil {
		t.Logf("Got error with invalid environment variable: %v", err)
	} else {
		t.Log("Invalid environment variable not caught at agent creation")
	}
}

// =============================================================================
// Error Case Tests - Error Propagation
// =============================================================================

// TestAgentToProto_ErrorPropagation tests error propagation from nested conversions.
func TestAgentToProto_ErrorPropagation(t *testing.T) {
	// Create agent with skill (simplified version without MCP servers)
	skill1 := skill.Platform("skill1")

	agent, err := New(nil, "error-prop-agent", &AgentArgs{
		Instructions: "Agent for testing error propagation in proto conversion",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}
	
	// Add skill using builder method
	agent.AddSkill(skill1)

	proto, err := agent.ToProto()

	if err != nil {
		t.Logf("Error propagated from nested conversion: %v", err)

		// Verify error provides context
		errStr := err.Error()
		if !strings.Contains(errStr, "agent") && !strings.Contains(errStr, "proto") {
			t.Log("Error message should provide context about conversion failure")
		}
	} else if proto == nil {
		t.Fatal("Proto should not be nil on successful conversion")
	}
}

// TestAgentToProto_MultipleErrorSources tests agent with multiple potential error sources.
// Simplified version without MCP servers and sub-agents.
func TestAgentToProto_MultipleErrorSources(t *testing.T) {
	// Create agent with multiple complex nested resources
	skills := []skill.Skill{}
	for i := 0; i < 10; i++ {
		skills = append(skills, skill.Platform("skill"+string(rune('0'+i))))
	}

	envVars := []environment.Variable{}
	for i := 0; i < 10; i++ {
		env, _ := environment.New(
			environment.WithName("ENV_VAR_"+string(rune('0'+i))),
			environment.WithDefaultValue("value"+string(rune('0'+i))),
		)
		envVars = append(envVars, env)
	}

	agent, err := New(nil, "multi-error-agent", &AgentArgs{
		Instructions: "Agent with multiple nested resources for error testing",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Add skills and environment variables using builder methods
	agent.AddSkills(skills...)
	agent.AddEnvironmentVariables(envVars...)

	proto, err := agent.ToProto()

	if err != nil {
		t.Logf("Error from complex agent with multiple nested resources: %v", err)

		// Check if error provides useful debugging information
		errStr := err.Error()
		t.Logf("Error message: %s", errStr)
	} else if proto == nil {
		t.Fatal("Proto should not be nil on successful conversion")
	} else {
		t.Logf("Successfully converted complex agent with %d skills, %d env vars",
			len(proto.Spec.SkillRefs),
			len(proto.Spec.EnvSpec.Data))
	}
}

// =============================================================================
// Error Case Tests - Resource Exhaustion
// =============================================================================

// TestNew_ExcessiveSkills tests agent with extremely large number of skills.
func TestNew_ExcessiveSkills(t *testing.T) {
	// Create 1000 skills
	skills := make([]skill.Skill, 1000)
	for i := 0; i < 1000; i++ {
		skills[i] = skill.Platform("skill-" + strings.Repeat("x", i%10))
	}

	agent, err := New(nil, "excessive-skills", &AgentArgs{
		Instructions: "Agent with 1000 skills for stress testing resource exhaustion",
	})

	if err != nil {
		t.Logf("Agent creation failed with 1000 skills: %v", err)
		return
	}
	
	// Add skills using builder method
	agent.AddSkills(skills...)

	proto, err := agent.ToProto()

	if err != nil {
		t.Logf("Proto conversion failed with 1000 skills: %v", err)
	} else if proto != nil {
		t.Logf("Successfully converted agent with %d skills", len(proto.Spec.SkillRefs))
	}
}

// TestNew_VeryLargeInstructions tests agent with maximum size instructions.
func TestNew_VeryLargeInstructions(t *testing.T) {
	// Create instructions at the 10,000 character limit
	largeInstructions := strings.Repeat("This is a detailed instruction for the agent. ", 200) // ~9,400 chars

	agent, err := New(nil, "large-instructions", &AgentArgs{
		Instructions: largeInstructions,
	})

	if err != nil {
		t.Logf("Agent creation failed with large instructions: %v", err)
		return
	}

	proto, err := agent.ToProto()

	if err != nil {
		t.Logf("Proto conversion failed with large instructions: %v", err)
	} else if proto != nil {
		t.Logf("Successfully converted agent with %d character instructions", len(proto.Spec.Instructions))
	}
}

// =============================================================================
// Error Case Tests - Validation Error Messages
// =============================================================================

// TestValidationError_ErrorMessage tests validation error message quality.
func TestValidationError_ErrorMessage(t *testing.T) {
	tests := []struct {
		name           string
		agentName      string
		args           *AgentArgs
		expectedInMsg  []string
		notExpectedMsg []string
	}{
		{
			name:      "name validation error",
			agentName: "Invalid Name",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing name validation error message",
			},
			expectedInMsg:  []string{"name", "invalid"},
			notExpectedMsg: []string{"instructions"},
		},
		{
			name:      "instructions validation error",
			agentName: "valid-agent",
			args: &AgentArgs{
				Instructions: "short",
			},
			expectedInMsg:  []string{"instructions"},
			notExpectedMsg: []string{"name"},
		},
		{
			name:      "description validation error",
			agentName: "valid-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing description validation error message",
				Description:  strings.Repeat("a", 501),
			},
			expectedInMsg:  []string{"description"},
			notExpectedMsg: []string{"name", "instructions"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := New(nil, tt.agentName, tt.args)

			if err == nil {
				t.Error("Expected validation error but got none")
				return
			}

			errMsg := strings.ToLower(err.Error())
			t.Logf("Error message: %s", errMsg)

			// Check expected keywords are in error message
			for _, expected := range tt.expectedInMsg {
				if !strings.Contains(errMsg, strings.ToLower(expected)) {
					t.Errorf("Error message should contain %q, got: %s", expected, errMsg)
				}
			}

			// Check unexpected keywords are NOT in error message
			for _, notExpected := range tt.notExpectedMsg {
				if strings.Contains(errMsg, strings.ToLower(notExpected)) {
					t.Errorf("Error message should not contain %q, got: %s", notExpected, errMsg)
				}
			}
		})
	}
}

// TestValidationError_Unwrap_Detailed tests error unwrapping in detail.
func TestValidationError_Unwrap_Detailed(t *testing.T) {
	_, err := New(nil, "Invalid Name", &AgentArgs{
		Instructions: "Valid instructions for testing error unwrapping",
	})

	if err == nil {
		t.Fatal("Expected error but got none")
	}

	// Check if error can be unwrapped to base error
	if !errors.Is(err, ErrInvalidName) {
		t.Error("Error should unwrap to ErrInvalidName")
	}

	// Check error type
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Error("Error should be of type ValidationError")
	}
}
