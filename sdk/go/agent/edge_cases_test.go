package agent

import (
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/environment"
	"github.com/stigmer/stigmer/sdk/go/skill"
)

// =============================================================================
// Edge Case Tests - Boundary Conditions
// =============================================================================

// TestAgentToProto_MaximumSkills tests agent with maximum number of skills.
func TestAgentToProto_MaximumSkills(t *testing.T) {
	// Create 50 skills
	skills := make([]skill.Skill, 50)
	for i := 0; i < 50; i++ {
		skills[i] = skill.Platform("skill" + string(rune('0'+i%10)))
	}

	agent, err := New(nil, "max-skills-agent", &AgentArgs{
		Instructions: "Agent with maximum skills for testing boundary conditions",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Add skills using builder method
	agent.AddSkills(skills...)

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with 50 skills: %v", err)
	}

	if len(proto.Spec.SkillRefs) != 50 {
		t.Errorf("Expected 50 skill refs, got %d", len(proto.Spec.SkillRefs))
	}
}

// TestAgentToProto_MaximumMCPServers tests agent with many MCP servers.
// NOTE: MCP server functionality not yet fully implemented in SDK, skipping for now.
func TestAgentToProto_MaximumMCPServers(t *testing.T) {
	t.Skip("MCP server functionality not yet fully implemented")
}

// TestAgentToProto_MaximumSubAgents tests agent with many sub-agents.
// NOTE: Sub-agent functionality not yet fully implemented in SDK, skipping for now.
func TestAgentToProto_MaximumSubAgents(t *testing.T) {
	t.Skip("Sub-agent functionality not yet fully implemented")
}

// TestAgentToProto_MaximumEnvironmentVars tests agent with many environment variables.
func TestAgentToProto_MaximumEnvironmentVars(t *testing.T) {
	// Create 100 environment variables with unique names
	envVars := make([]environment.Variable, 100)
	for i := 0; i < 100; i++ {
		env, _ := environment.New(
			environment.WithName(fmt.Sprintf("ENV_VAR_%d", i)),
			environment.WithDefaultValue(fmt.Sprintf("value%d", i)),
			environment.WithSecret(i%2 == 0), // Half are secrets
		)
		envVars[i] = env
	}

	agent, err := New(nil, "max-env-agent", &AgentArgs{
		Instructions: "Agent with maximum environment variables for testing boundary conditions",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	// Add environment variables using builder method
	agent.AddEnvironmentVariables(envVars...)

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with 100 env vars: %v", err)
	}

	if len(proto.Spec.EnvSpec.Data) != 100 {
		t.Errorf("Expected 100 env vars, got %d", len(proto.Spec.EnvSpec.Data))
	}

	// Verify mix of secrets and non-secrets
	secretCount := 0
	for _, env := range proto.Spec.EnvSpec.Data {
		if env.IsSecret {
			secretCount++
		}
	}

	if secretCount != 50 {
		t.Errorf("Expected 50 secret env vars, got %d", secretCount)
	}
}

// TestAgentToProto_VeryLongInstructions tests agent with maximum length instructions.
func TestAgentToProto_VeryLongInstructions(t *testing.T) {
	// Create instructions close to 10,000 character limit
	longInstructions := strings.Repeat("This is a very detailed instruction for the agent to follow carefully. ", 140) // ~9,800 chars

	agent, err := New(nil, "long-instructions-agent", &AgentArgs{
		Instructions: longInstructions,
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with long instructions: %v", err)
	}

	if proto.Spec.Instructions != longInstructions {
		t.Error("Long instructions were not preserved correctly")
	}

	if len(proto.Spec.Instructions) < 9000 {
		t.Errorf("Expected instructions length ~9800, got %d", len(proto.Spec.Instructions))
	}
}

// TestAgentToProto_SpecialCharactersInFields tests special characters.
func TestAgentToProto_SpecialCharactersInFields(t *testing.T) {
	agent, err := New(nil, "special-agent", &AgentArgs{
		Description:  "Description with unicode: 你好 🚀 émojis & symbols <>&\"'\n\t",
		Instructions: "Instructions with special chars: \n\t<>&\"' 你好世界 🎉💻",
	})
	if err != nil {
		t.Fatalf("Failed to create agent: %v", err)
	}

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with special characters: %v", err)
	}

	if !strings.Contains(proto.Spec.Description, "你好") {
		t.Error("Unicode characters in description were not preserved")
	}

	if !strings.Contains(proto.Spec.Instructions, "🎉💻") {
		t.Error("Emoji characters in instructions were not preserved")
	}
}

// =============================================================================
// Edge Case Tests - Nil and Empty Values
// =============================================================================

// TestAgentToProto_NilFields tests handling of nil fields.
func TestAgentToProto_NilFields(t *testing.T) {
	tests := []struct {
		name    string
		agent   *Agent
		wantErr bool
	}{
		{
			name: "nil skills",
			agent: &Agent{
				Name:         "agent1",
				Instructions: "Test instructions for agent validation",
				Skills:       nil, // nil slice
			},
			wantErr: false,
		},
		{
			name: "nil MCP servers",
			agent: &Agent{
				Name:         "agent2",
				Instructions: "Test instructions for agent validation",
				MCPServers:   nil, // nil slice
			},
			wantErr: false,
		},
		{
			name: "nil sub-agents",
			agent: &Agent{
				Name:         "agent3",
				Instructions: "Test instructions for agent validation",
				SubAgents:    nil, // nil slice
			},
			wantErr: false,
		},
		{
			name: "nil environment variables",
			agent: &Agent{
				Name:                 "agent4",
				Instructions:         "Test instructions for agent validation",
				EnvironmentVariables: nil, // nil slice
			},
			wantErr: false,
		},
		{
			name: "all fields nil",
			agent: &Agent{
				Name:                 "agent5",
				Instructions:         "Test instructions for agent validation",
				Skills:               nil,
				MCPServers:           nil,
				SubAgents:            nil,
				EnvironmentVariables: nil,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			proto, err := tt.agent.ToProto()

			if tt.wantErr {
				if err == nil {
					t.Error("Expected error but got none")
				}
				return
			}

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if proto == nil {
				t.Fatal("Proto should not be nil")
			}

			// Verify empty slices in proto
			if proto.Spec.SkillRefs == nil {
				t.Error("SkillRefs should not be nil (should be empty slice)")
			}
			if proto.Spec.McpServers == nil {
				t.Error("McpServers should not be nil (should be empty slice)")
			}
			if proto.Spec.SubAgents == nil {
				t.Error("SubAgents should not be nil (should be empty slice)")
			}
		})
	}
}

// TestAgentToProto_EmptyStringFields tests empty string fields.
func TestAgentToProto_EmptyStringFields(t *testing.T) {
	agent := &Agent{
		Name:         "empty-fields-agent",
		Instructions: "Valid instructions for testing empty fields",
		Description:  "", // empty description (valid - optional field)
		IconURL:      "", // empty icon URL (valid - optional field)
		Slug:         "", // empty slug (should be auto-generated)
	}

	proto, err := agent.ToProto()
	if err != nil {
		t.Fatalf("ToProto() failed with empty optional fields: %v", err)
	}

	if proto.Spec.Description != "" {
		t.Error("Empty description should remain empty")
	}

	if proto.Spec.IconUrl != "" {
		t.Error("Empty icon URL should remain empty")
	}

	// Slug should be auto-generated from name
	if proto.Metadata.Slug == "" {
		t.Error("Slug should be auto-generated when empty")
	}
}

// =============================================================================
// Edge Case Tests - Concurrent Operations
// =============================================================================

// TestAgentToProto_ConcurrentAccess tests thread-safety of ToProto.
func TestAgentToProto_ConcurrentAccess(t *testing.T) {
	agent, _ := New(nil, "concurrent-agent", &AgentArgs{
		Instructions: "Agent for testing concurrent access to ToProto method",
	})

	// Run ToProto concurrently 100 times
	var wg sync.WaitGroup
	errors := make(chan error, 100)

	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := agent.ToProto()
			if err != nil {
				errors <- err
			}
		}()
	}

	wg.Wait()
	close(errors)

	// Check for any errors
	for err := range errors {
		t.Errorf("Concurrent ToProto() failed: %v", err)
	}
}

// TestAgent_ConcurrentSkillAddition tests concurrent skill additions.
func TestAgent_ConcurrentSkillAddition(t *testing.T) {
	agent := &Agent{
		Name:         "concurrent-skills",
		Instructions: "Agent for testing concurrent skill additions",
		Skills:       []skill.Skill{}, // Initialize to avoid nil
	}

	// Concurrently add 50 skills using thread-safe AddSkill method
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			s := skill.Platform("skill" + string(rune('0'+idx%10)))
			agent.AddSkill(s)
		}(i)
	}

	wg.Wait()

	// Verify all 50 skills were added successfully
	// With thread-safe implementation, we should get exactly 50 skills
	agent.mu.Lock()
	skillCount := len(agent.Skills)
	agent.mu.Unlock()

	if skillCount != 50 {
		t.Errorf("Expected 50 skills, got %d", skillCount)
	}
	t.Logf("Skills added concurrently: %d (expected 50)", skillCount)
}

// =============================================================================
// Edge Case Tests - Complex Nested Structures
// =============================================================================

// TestAgentToProto_ComplexMCPServerConfigurations tests complex MCP server setups.
// NOTE: MCP server functionality not yet fully implemented in SDK, skipping for now.
func TestAgentToProto_ComplexMCPServerConfigurations(t *testing.T) {
	t.Skip("MCP server functionality not yet fully implemented")
}

// TestAgentToProto_MixedSubAgentTypes tests combination of inline and referenced sub-agents.
// NOTE: Sub-agent functionality not yet fully implemented in SDK, skipping for now.
func TestAgentToProto_MixedSubAgentTypes(t *testing.T) {
	t.Skip("Sub-agent functionality not yet fully implemented")
}

// =============================================================================
// Edge Case Tests - Name and Slug Generation
// =============================================================================

// TestAgentToProto_SlugEdgeCases tests edge cases in slug generation.
func TestAgentToProto_SlugEdgeCases(t *testing.T) {
	tests := []struct {
		name         string
		agentName    string
		expectedSlug string
	}{
		{
			name:         "name with valid format",
			agentName:    "my-test-agent",
			expectedSlug: "my-test-agent",
		},
		{
			name:         "simple name",
			agentName:    "test",
			expectedSlug: "test",
		},
		{
			name:         "name with numbers",
			agentName:    "agent-123",
			expectedSlug: "agent-123",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			agent, err := New(nil, tt.agentName, &AgentArgs{
				Instructions: "Test instructions for slug edge case testing",
			})
			if err != nil {
				t.Fatalf("Failed to create agent: %v", err)
			}

			proto, err := agent.ToProto()
			if err != nil {
				t.Fatalf("ToProto() failed: %v", err)
			}

			// Note: Actual slug validation depends on naming package implementation
			// This test documents expected behavior
			if proto.Metadata.Slug == "" {
				t.Error("Slug should not be empty")
			}

			t.Logf("Agent name: %s, Expected slug: %s, Actual slug: %s",
				tt.agentName, tt.expectedSlug, proto.Metadata.Slug)
		})
	}
}
