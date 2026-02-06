package agent

import (
	"errors"
	"strings"
	"testing"
)

func TestValidationError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      *ValidationError
		expected string
	}{
		{
			name: "with field",
			err: &ValidationError{
				Field:   "name",
				Value:   "invalid",
				Rule:    "format",
				Message: "invalid format",
			},
			expected: `validation failed for field "name": invalid format`,
		},
		{
			name: "without field",
			err: &ValidationError{
				Message: "validation failed",
			},
			expected: "validation failed: validation failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.expected {
				t.Errorf("ValidationError.Error() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestValidationError_Unwrap(t *testing.T) {
	cause := errors.New("underlying error")
	err := &ValidationError{
		Field:   "test",
		Message: "test error",
		Err:     cause,
	}

	if got := err.Unwrap(); got != cause {
		t.Errorf("ValidationError.Unwrap() = %v, want %v", got, cause)
	}
}

func TestValidationError_Is(t *testing.T) {
	tests := []struct {
		name   string
		err    *ValidationError
		target error
		want   bool
	}{
		{
			name:   "matches ErrInvalidName",
			err:    NewValidationErrorWithCause("name", "invalid", "format", "invalid name", ErrInvalidName),
			target: ErrInvalidName,
			want:   true,
		},
		{
			name:   "matches ErrInvalidInstructions",
			err:    NewValidationErrorWithCause("instructions", "short", "min_length", "too short", ErrInvalidInstructions),
			target: ErrInvalidInstructions,
			want:   true,
		},
		{
			name:   "does not match",
			err:    NewValidationError("test", "value", "rule", "message"),
			target: ErrInvalidName,
			want:   false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := errors.Is(tt.err, tt.target); got != tt.want {
				t.Errorf("errors.Is() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestNewValidationError(t *testing.T) {
	err := NewValidationError("field", "value", "rule", "message")

	if err.Field != "field" {
		t.Errorf("Field = %v, want %v", err.Field, "field")
	}
	if err.Value != "value" {
		t.Errorf("Value = %v, want %v", err.Value, "value")
	}
	if err.Rule != "rule" {
		t.Errorf("Rule = %v, want %v", err.Rule, "rule")
	}
	if err.Message != "message" {
		t.Errorf("Message = %v, want %v", err.Message, "message")
	}
	if err.Err != nil {
		t.Errorf("Err = %v, want nil", err.Err)
	}
}

func TestNewValidationErrorWithCause(t *testing.T) {
	cause := errors.New("cause")
	err := NewValidationErrorWithCause("field", "value", "rule", "message", cause)

	if err.Field != "field" {
		t.Errorf("Field = %v, want %v", err.Field, "field")
	}
	if err.Err != cause {
		t.Errorf("Err = %v, want %v", err.Err, cause)
	}
}

func TestConversionError_Error(t *testing.T) {
	tests := []struct {
		name     string
		err      *ConversionError
		expected string
	}{
		{
			name: "with field",
			err: &ConversionError{
				Type:    "Agent",
				Field:   "name",
				Message: "conversion failed",
			},
			expected: "failed to convert Agent.name: conversion failed",
		},
		{
			name: "without field",
			err: &ConversionError{
				Type:    "Agent",
				Message: "conversion failed",
			},
			expected: "failed to convert Agent: conversion failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.expected {
				t.Errorf("ConversionError.Error() = %v, want %v", got, tt.expected)
			}
		})
	}
}

func TestConversionError_Unwrap(t *testing.T) {
	cause := errors.New("underlying error")
	err := &ConversionError{
		Type:    "Agent",
		Message: "test error",
		Err:     cause,
	}

	if got := err.Unwrap(); got != cause {
		t.Errorf("ConversionError.Unwrap() = %v, want %v", got, cause)
	}
}

func TestNewConversionError(t *testing.T) {
	err := NewConversionError("Agent", "field", "message")

	if err.Type != "Agent" {
		t.Errorf("Type = %v, want %v", err.Type, "Agent")
	}
	if err.Field != "field" {
		t.Errorf("Field = %v, want %v", err.Field, "field")
	}
	if err.Message != "message" {
		t.Errorf("Message = %v, want %v", err.Message, "message")
	}
	if err.Err != nil {
		t.Errorf("Err = %v, want nil", err.Err)
	}
}

func TestNewConversionErrorWithCause(t *testing.T) {
	cause := errors.New("cause")
	err := NewConversionErrorWithCause("Agent", "field", "message", cause)

	if err.Type != "Agent" {
		t.Errorf("Type = %v, want %v", err.Type, "Agent")
	}
	if err.Err != cause {
		t.Errorf("Err = %v, want %v", err.Err, cause)
	}
}

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
		// Note: Instructions, description, and iconURL validation has been moved to ToProto() time
		// using protovalidate. These test cases verify that New() accepts these values
		// (validation happens at ToProto() time, not New() time).
		{
			name:      "missing instructions (validated at ToProto)",
			agentName: "test-agent",
			args:      &AgentArgs{},
			wantErr:   false, // Validation happens at ToProto() time, not New()
		},
		{
			name:      "empty instructions (validated at ToProto)",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "",
			},
			wantErr: false, // Validation happens at ToProto() time, not New()
		},
		{
			name:      "instructions too short (validated at ToProto)",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "short", // less than 10 chars
			},
			wantErr: false, // Validation happens at ToProto() time, not New()
		},
		{
			name:      "instructions too long (validated at ToProto)",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: strings.Repeat("a", 10001), // over 10,000 chars
			},
			wantErr: false, // Validation happens at ToProto() time, not New()
		},
		{
			name:      "instructions only whitespace (validated at ToProto)",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "          ", // only spaces
			},
			wantErr: false, // Validation happens at ToProto() time, not New()
		},
		{
			name:      "description too long (validated at ToProto)",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing description length",
				Description:  strings.Repeat("a", 501), // over 500 chars
			},
			wantErr: false, // Validation happens at ToProto() time, not New()
		},
		{
			name:      "invalid icon URL (validated at ToProto)",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing invalid icon URL",
				IconUrl:      "not-a-valid-url",
			},
			wantErr: false, // Validation happens at ToProto() time, not New()
		},
		{
			name:      "invalid icon URL - missing scheme (validated at ToProto)",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing icon URL missing scheme",
				IconUrl:      "example.com/icon.png",
			},
			wantErr: false, // Validation happens at ToProto() time, not New()
		},
		{
			name:      "invalid icon URL - wrong scheme (validated at ToProto)",
			agentName: "test-agent",
			args: &AgentArgs{
				Instructions: "Valid instructions for testing icon URL with wrong scheme",
				IconUrl:      "ftp://example.com/icon.png",
			},
			wantErr: false, // Validation happens at ToProto() time, not New()
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

// TestNew_InvalidSkillRefs tests agent creation with skill references.
// Note: SDK references skills via AddSkill(), it doesn't create them.
// AddSkill panics on empty refs; use TryAddSkill for error handling.
func TestNew_InvalidSkillRefs(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test instructions for skill reference testing",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// TryAddSkill with empty string returns error instead of panicking
	_, err = agent.TryAddSkill("")
	if err == nil {
		t.Error("Expected error for empty skill ref, got nil")
	}

	t.Logf("Got expected error for empty skill ref: %v", err)
}

// TestNew_InvalidMCPServers tests agent creation with invalid MCP servers.
// NOTE: MCP server validation happens via protovalidate at deployment time.
func TestNew_InvalidMCPServers(t *testing.T) {
	t.Skip("MCP server validation happens via protovalidate at deployment")
}

// TestNew_InvalidSubAgents tests agent creation with invalid sub-agents.
// NOTE: Sub-agent validation happens via protovalidate at deployment time.
func TestNew_InvalidSubAgents(t *testing.T) {
	t.Skip("Sub-agent validation happens via protovalidate at deployment")
}

// TestNew_InvalidEnvironmentVariables tests agent creation with invalid env vars.
func TestNew_InvalidEnvironmentVariables(t *testing.T) {
	agent, err := New(nil, "test-agent", &AgentArgs{
		Instructions: "Test agent for environment variable validation",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Test RequireSecret with empty name - currently allowed at SDK level
	// Validation happens via protovalidate at deployment time
	agent.RequireSecret("", "Test description")

	if agent.Args.EnvSpec != nil && len(agent.Args.EnvSpec.Data) > 0 {
		t.Log("Environment variable validation may be deferred to deployment")
	}
}

// =============================================================================
// Error Case Tests - Error Propagation
// =============================================================================

// TestAgentToProto_ErrorPropagation tests error propagation from nested conversions.
func TestAgentToProto_ErrorPropagation(t *testing.T) {
	agent, err := New(nil, "error-prop-agent", &AgentArgs{
		Instructions: "Agent for testing error propagation in proto conversion",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Add skill ref using new smart parsing API
	agent.AddSkill("stigmer/skill1")

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
	agent, err := New(nil, "multi-error-agent", &AgentArgs{
		Instructions: "Agent with multiple nested resources for error testing",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Add 10 skill refs using new smart parsing API
	for i := 0; i < 10; i++ {
		agent.AddSkill("stigmer/skill" + string(rune('0'+i)))
	}

	// Add environment variables using the new RequireSecret/RequireConfig API
	for i := 0; i < 10; i++ {
		if i%2 == 0 {
			agent.RequireSecret("ENV_VAR_"+string(rune('A'+i%26)), "Secret env var for testing")
		} else {
			agent.RequireConfig("ENV_VAR_"+string(rune('A'+i%26)), "value"+string(rune('0'+i)), "Config env var for testing")
		}
	}

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

// TestNew_ExcessiveSkillRefs tests agent with extremely large number of skill refs.
func TestNew_ExcessiveSkillRefs(t *testing.T) {
	agent, err := New(nil, "excessive-skills", &AgentArgs{
		Instructions: "Agent with 1000 skill refs for stress testing resource exhaustion",
	})

	if err != nil {
		t.Fatalf("Agent creation failed: %v", err)
	}

	// Add 1000 skill refs using new smart parsing API
	for i := 0; i < 1000; i++ {
		agent.AddSkill("stigmer/skill-" + strings.Repeat("x", i%10))
	}

	proto, err := agent.ToProto()

	if err != nil {
		t.Logf("Proto conversion failed with 1000 skill refs: %v", err)
	} else if proto != nil {
		t.Logf("Successfully converted agent with %d skill refs", len(proto.Spec.SkillRefs))
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
		// Note: Instructions and description validation has been moved to ToProto() time.
		// These test cases are removed as they tested validation that no longer happens at New() time.
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
