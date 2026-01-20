package agent_test

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/agent"
)

func TestAgent_NewWithContext(t *testing.T) {
	ctx := stigmer.NewContext()

	ag, err := agent.New(ctx,
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code and suggest improvements"),
		agent.WithDescription("AI code reviewer"),
	)

	if err != nil {
		t.Fatalf("NewWithContext() failed: %v", err)
	}

	if ag == nil {
		t.Fatal("NewWithContext() returned nil agent")
	}

	if ag.Name != "code-reviewer" {
		t.Errorf("Expected name 'code-reviewer', got '%s'", ag.Name)
	}

	// Verify agent was registered with context
	agents := ctx.Agents()
	if len(agents) != 1 {
		t.Errorf("Expected 1 agent registered, got %d", len(agents))
	}
}

func TestAgent_NewWithoutContext(t *testing.T) {
	// Test that old API still works (backward compatibility)
	ag, err := agent.New(
		nil, // No context needed for tests
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code and suggest improvements"),
		agent.WithDescription("AI code reviewer"),
	)

	if err != nil {
		t.Fatalf("New() without context failed: %v", err)
	}

	if ag == nil {
		t.Fatal("New() returned nil agent")
	}

	if ag.Name != "code-reviewer" {
		t.Errorf("Expected name 'code-reviewer', got '%s'", ag.Name)
	}
}

func TestAgentBuilder_WithNameStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	agentName := ctx.SetString("agentName", "code-reviewer")

	ag, err := agent.New(ctx,
		agent.WithName(agentName),
		agent.WithInstructions("Review code"),
	)

	if err != nil {
		t.Fatalf("NewWithContext() with StringRef name failed: %v", err)
	}

	// For synthesis, we use the actual value, not the expression
	expected := "code-reviewer"
	if ag.Name != expected {
		t.Errorf("Expected name '%s', got '%s'", expected, ag.Name)
	}
}

func TestAgentBuilder_WithNameString(t *testing.T) {
	// Test backward compatibility - plain string should still work
	ag, err := agent.New(
		nil, // No context needed for tests
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code"),
	)

	if err != nil {
		t.Fatalf("New() with string name failed: %v", err)
	}

	expected := "code-reviewer"
	if ag.Name != expected {
		t.Errorf("Expected name '%s', got '%s'", expected, ag.Name)
	}
}

func TestAgentBuilder_WithInstructionsStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	instructions := ctx.SetString("instructions", "Review code and suggest improvements based on best practices")

	ag, err := agent.New(ctx,
		agent.WithName("code-reviewer"),
		agent.WithInstructions(instructions),
	)

	if err != nil {
		t.Fatalf("NewWithContext() with StringRef instructions failed: %v", err)
	}

	expected := "Review code and suggest improvements based on best practices"
	if ag.Instructions != expected {
		t.Errorf("Expected instructions '%s', got '%s'", expected, ag.Instructions)
	}
}

func TestAgentBuilder_WithInstructionsString(t *testing.T) {
	// Test backward compatibility
	ag, err := agent.New(
		nil, // No context needed for tests
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code and suggest improvements"),
	)

	if err != nil {
		t.Fatalf("New() with string instructions failed: %v", err)
	}

	expected := "Review code and suggest improvements"
	if ag.Instructions != expected {
		t.Errorf("Expected instructions '%s', got '%s'", expected, ag.Instructions)
	}
}

func TestAgentBuilder_WithDescriptionStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	description := ctx.SetString("description", "AI-powered code reviewer")

	ag, err := agent.New(ctx,
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code"),
		agent.WithDescription(description),
	)

	if err != nil {
		t.Fatalf("NewWithContext() with StringRef description failed: %v", err)
	}

	expected := "AI-powered code reviewer"
	if ag.Description != expected {
		t.Errorf("Expected description '%s', got '%s'", expected, ag.Description)
	}
}

func TestAgentBuilder_WithDescriptionString(t *testing.T) {
	// Test backward compatibility
	ag, err := agent.New(
		nil, // No context needed for tests
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code"),
		agent.WithDescription("AI code reviewer"),
	)

	if err != nil {
		t.Fatalf("New() with string description failed: %v", err)
	}

	expected := "AI code reviewer"
	if ag.Description != expected {
		t.Errorf("Expected description '%s', got '%s'", expected, ag.Description)
	}
}

func TestAgentBuilder_WithIconURLStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	iconURL := ctx.SetString("iconURL", "https://example.com/icon.png")

	ag, err := agent.New(ctx,
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code"),
		agent.WithIconURL(iconURL),
	)

	if err != nil {
		t.Fatalf("NewWithContext() with StringRef iconURL failed: %v", err)
	}

	expected := "https://example.com/icon.png"
	if ag.IconURL != expected {
		t.Errorf("Expected iconURL '%s', got '%s'", expected, ag.IconURL)
	}
}

func TestAgentBuilder_WithIconURLString(t *testing.T) {
	// Test backward compatibility
	ag, err := agent.New(
		nil, // No context needed for tests
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code"),
		agent.WithIconURL("https://example.com/icon.png"),
	)

	if err != nil {
		t.Fatalf("New() with string iconURL failed: %v", err)
	}

	expected := "https://example.com/icon.png"
	if ag.IconURL != expected {
		t.Errorf("Expected iconURL '%s', got '%s'", expected, ag.IconURL)
	}
}

func TestAgentBuilder_WithOrgStringRef(t *testing.T) {
	ctx := stigmer.NewContext()
	org := ctx.SetString("org", "my-organization")

	ag, err := agent.New(ctx,
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code"),
		agent.WithOrg(org),
	)

	if err != nil {
		t.Fatalf("NewWithContext() with StringRef org failed: %v", err)
	}

	expected := "my-organization"
	if ag.Org != expected {
		t.Errorf("Expected org '%s', got '%s'", expected, ag.Org)
	}
}

func TestAgentBuilder_WithOrgString(t *testing.T) {
	// Test backward compatibility
	ag, err := agent.New(
		nil, // No context needed for tests
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code"),
		agent.WithOrg("my-org"),
	)

	if err != nil {
		t.Fatalf("New() with string org failed: %v", err)
	}

	expected := "my-org"
	if ag.Org != expected {
		t.Errorf("Expected org '%s', got '%s'", expected, ag.Org)
	}
}

func TestAgentBuilder_MixedTypedAndLegacy(t *testing.T) {
	ctx := stigmer.NewContext()
	agentName := ctx.SetString("agentName", "code-reviewer")
	description := ctx.SetString("description", "AI reviewer")

	// Mix typed context variables with legacy strings
	ag, err := agent.New(ctx,
		agent.WithName(agentName),                              // Typed
		agent.WithInstructions("Review code and suggest fixes"), // Legacy string
		agent.WithDescription(description),                      // Typed
		agent.WithOrg("my-org"),                                // Legacy string
	)

	if err != nil {
		t.Fatalf("NewWithContext() with mixed types failed: %v", err)
	}

	if ag.Name != "code-reviewer" {
		t.Errorf("Expected name 'code-reviewer', got '%s'", ag.Name)
	}
	if ag.Instructions != "Review code and suggest fixes" {
		t.Errorf("Expected instructions 'Review code and suggest fixes', got '%s'", ag.Instructions)
	}
	if ag.Description != "AI reviewer" {
		t.Errorf("Expected description 'AI reviewer', got '%s'", ag.Description)
	}
	if ag.Org != "my-org" {
		t.Errorf("Expected org 'my-org', got '%s'", ag.Org)
	}
}

func TestAgentBuilder_StringRefConcat(t *testing.T) {
	ctx := stigmer.NewContext()
	baseURL := ctx.SetString("baseURL", "https://example.com")
	iconPath := baseURL.Concat("/icons/reviewer.png")

	ag, err := agent.New(ctx,
		agent.WithName("code-reviewer"),
		agent.WithInstructions("Review code"),
		agent.WithIconURL(iconPath),
	)

	if err != nil {
		t.Fatalf("NewWithContext() with StringRef concat failed: %v", err)
	}

	// Note: For synthesis, we get the expression, not the computed value
	// This is expected behavior - the actual concatenation happens at runtime
	// For now, we just verify the agent was created successfully
	if ag == nil {
		t.Fatal("Agent should not be nil")
	}
}

func TestRefHelpers_toExpression(t *testing.T) {
	// This is tested indirectly through all the agent builder tests above,
	// but we can add explicit tests if needed
}
