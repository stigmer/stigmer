package stigmer

import (
	"fmt"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/skill"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// =============================================================================
// Context Creation Tests
// =============================================================================

func TestNewContext(t *testing.T) {
	ctx := newContext()

	if ctx == nil {
		t.Fatal("newContext() returned nil")
	}

	if ctx.variables == nil {
		t.Error("context variables map is nil")
	}

	if ctx.workflows == nil {
		t.Error("context workflows slice is nil")
	}

	if ctx.agents == nil {
		t.Error("context agents slice is nil")
	}

	if ctx.synthesized {
		t.Error("new context should not be synthesized")
	}
}

// =============================================================================
// Variable Management Tests
// =============================================================================

func TestContext_SetString(t *testing.T) {
	ctx := newContext()

	ref := ctx.SetString("apiURL", "https://api.example.com")

	if ref == nil {
		t.Fatal("SetString returned nil")
	}

	if ref.Name() != "apiURL" {
		t.Errorf("Name() = %q, want %q", ref.Name(), "apiURL")
	}

	if ref.Value() != "https://api.example.com" {
		t.Errorf("Value() = %q, want %q", ref.Value(), "https://api.example.com")
	}

	if ref.IsSecret() {
		t.Error("String should not be secret")
	}

	// Verify it's stored in context
	stored := ctx.Get("apiURL")
	if stored == nil {
		t.Error("Variable not stored in context")
	}
}

func TestContext_SetSecret(t *testing.T) {
	ctx := newContext()

	ref := ctx.SetSecret("apiKey", "secret-key-123")

	if ref == nil {
		t.Fatal("SetSecret returned nil")
	}

	if ref.Name() != "apiKey" {
		t.Errorf("Name() = %q, want %q", ref.Name(), "apiKey")
	}

	if ref.Value() != "secret-key-123" {
		t.Errorf("Value() = %q, want %q", ref.Value(), "secret-key-123")
	}

	if !ref.IsSecret() {
		t.Error("Secret should be marked as secret")
	}

	// Verify it's stored in context
	stored := ctx.Get("apiKey")
	if stored == nil {
		t.Error("Secret not stored in context")
	}
}

func TestContext_SetInt(t *testing.T) {
	ctx := newContext()

	ref := ctx.SetInt("retries", 3)

	if ref == nil {
		t.Fatal("SetInt returned nil")
	}

	if ref.Name() != "retries" {
		t.Errorf("Name() = %q, want %q", ref.Name(), "retries")
	}

	if ref.Value() != 3 {
		t.Errorf("Value() = %d, want %d", ref.Value(), 3)
	}

	// Verify it's stored in context
	stored := ctx.Get("retries")
	if stored == nil {
		t.Error("Variable not stored in context")
	}
}

func TestContext_SetBool(t *testing.T) {
	ctx := newContext()

	ref := ctx.SetBool("isProd", true)

	if ref == nil {
		t.Fatal("SetBool returned nil")
	}

	if ref.Name() != "isProd" {
		t.Errorf("Name() = %q, want %q", ref.Name(), "isProd")
	}

	if ref.Value() != true {
		t.Errorf("Value() = %v, want %v", ref.Value(), true)
	}

	// Verify it's stored in context
	stored := ctx.Get("isProd")
	if stored == nil {
		t.Error("Variable not stored in context")
	}
}

func TestContext_SetObject(t *testing.T) {
	ctx := newContext()

	value := map[string]interface{}{
		"host": "localhost",
		"port": 5432,
	}
	ref := ctx.SetObject("config", value)

	if ref == nil {
		t.Fatal("SetObject returned nil")
	}

	if ref.Name() != "config" {
		t.Errorf("Name() = %q, want %q", ref.Name(), "config")
	}

	if ref.Value()["host"] != "localhost" {
		t.Errorf("Value()[host] = %v, want %v", ref.Value()["host"], "localhost")
	}

	// Verify it's stored in context
	stored := ctx.Get("config")
	if stored == nil {
		t.Error("Variable not stored in context")
	}
}

// =============================================================================
// Variable Retrieval Tests
// =============================================================================

func TestContext_Get(t *testing.T) {
	ctx := newContext()

	// Set a variable
	ctx.SetString("apiURL", "https://api.example.com")

	// Retrieve it
	ref := ctx.Get("apiURL")
	if ref == nil {
		t.Fatal("Get returned nil for existing variable")
	}

	// Try to get non-existent variable
	missing := ctx.Get("nonexistent")
	if missing != nil {
		t.Error("Get should return nil for non-existent variable")
	}
}

func TestContext_GetString(t *testing.T) {
	ctx := newContext()

	// Set a string variable
	ctx.SetString("apiURL", "https://api.example.com")

	// Retrieve it
	ref := ctx.GetString("apiURL")
	if ref == nil {
		t.Fatal("GetString returned nil for existing string variable")
	}

	if ref.Value() != "https://api.example.com" {
		t.Errorf("GetString returned wrong value: %q", ref.Value())
	}

	// Try to get as string when it's not a string
	ctx.SetInt("count", 42)
	wrongType := ctx.GetString("count")
	if wrongType != nil {
		t.Error("GetString should return nil for non-string variable")
	}
}

func TestContext_GetInt(t *testing.T) {
	ctx := newContext()

	// Set an int variable
	ctx.SetInt("retries", 3)

	// Retrieve it
	ref := ctx.GetInt("retries")
	if ref == nil {
		t.Fatal("GetInt returned nil for existing int variable")
	}

	if ref.Value() != 3 {
		t.Errorf("GetInt returned wrong value: %d", ref.Value())
	}

	// Try to get as int when it's not an int
	ctx.SetString("name", "test")
	wrongType := ctx.GetInt("name")
	if wrongType != nil {
		t.Error("GetInt should return nil for non-int variable")
	}
}

func TestContext_GetBool(t *testing.T) {
	ctx := newContext()

	// Set a bool variable
	ctx.SetBool("isProd", true)

	// Retrieve it
	ref := ctx.GetBool("isProd")
	if ref == nil {
		t.Fatal("GetBool returned nil for existing bool variable")
	}

	if ref.Value() != true {
		t.Errorf("GetBool returned wrong value: %v", ref.Value())
	}

	// Try to get as bool when it's not a bool
	ctx.SetString("name", "test")
	wrongType := ctx.GetBool("name")
	if wrongType != nil {
		t.Error("GetBool should return nil for non-bool variable")
	}
}

func TestContext_GetObject(t *testing.T) {
	ctx := newContext()

	// Set an object variable
	value := map[string]interface{}{"key": "value"}
	ctx.SetObject("config", value)

	// Retrieve it
	ref := ctx.GetObject("config")
	if ref == nil {
		t.Fatal("GetObject returned nil for existing object variable")
	}

	if ref.Value()["key"] != "value" {
		t.Errorf("GetObject returned wrong value: %v", ref.Value())
	}

	// Try to get as object when it's not an object
	ctx.SetString("name", "test")
	wrongType := ctx.GetObject("name")
	if wrongType != nil {
		t.Error("GetObject should return nil for non-object variable")
	}
}

// =============================================================================
// Variable Overwrite Tests
// =============================================================================

func TestContext_OverwriteVariable(t *testing.T) {
	ctx := newContext()

	// Set initial value
	ref1 := ctx.SetString("apiURL", "https://api.example.com")
	if ref1.Value() != "https://api.example.com" {
		t.Errorf("Initial value incorrect: %q", ref1.Value())
	}

	// Overwrite with new value
	ref2 := ctx.SetString("apiURL", "https://api2.example.com")
	if ref2.Value() != "https://api2.example.com" {
		t.Errorf("Overwritten value incorrect: %q", ref2.Value())
	}

	// Verify the stored value is the new one
	stored := ctx.GetString("apiURL")
	if stored.Value() != "https://api2.example.com" {
		t.Errorf("Stored value not updated: %q", stored.Value())
	}
}

// =============================================================================
// Expression Generation Tests
// =============================================================================

func TestContext_VariableExpressions(t *testing.T) {
	ctx := newContext()

	// Create variables
	apiURL := ctx.SetString("apiURL", "https://api.example.com")
	retries := ctx.SetInt("retries", 3)
	isProd := ctx.SetBool("isProd", true)

	// Test expressions
	tests := []struct {
		name     string
		ref      Ref
		expected string
	}{
		{"string expression", apiURL, "${ $context.apiURL }"},
		{"int expression", retries, "${ $context.retries }"},
		{"bool expression", isProd, "${ $context.isProd }"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.ref.Expression(); got != tt.expected {
				t.Errorf("Expression() = %q, want %q", got, tt.expected)
			}
		})
	}
}

func TestContext_ComputedExpressions(t *testing.T) {
	ctx := newContext()

	// Create variables
	baseURL := ctx.SetString("baseURL", "https://api.example.com")
	path := ctx.SetString("path", "/users")

	// Create computed value - with compile-time resolution, this resolves immediately
	fullURL := baseURL.Concat(path)

	// Compile-time resolution: all values known, so result is the resolved value
	expected := "https://api.example.com/users"
	if got := fullURL.Value(); got != expected {
		t.Errorf("Resolved value = %q, want %q", got, expected)
	}
}

// =============================================================================
// Run Pattern Tests
// =============================================================================

func TestRun_Success(t *testing.T) {
	executed := false

	err := Run(func(ctx *Context) error {
		executed = true

		// Create some variables
		ctx.SetString("apiURL", "https://api.example.com")
		ctx.SetInt("retries", 3)

		return nil
	})

	if err != nil {
		t.Errorf("Run() returned error: %v", err)
	}

	if !executed {
		t.Error("Function was not executed")
	}
}

func TestRun_FunctionError(t *testing.T) {
	err := Run(func(ctx *Context) error {
		return fmt.Errorf("test error")
	})

	if err == nil {
		t.Error("Run() should return error when function fails")
	}

	if err.Error() != "context function failed: test error" {
		t.Errorf("Unexpected error message: %v", err)
	}
}

func TestRun_ContextAvailable(t *testing.T) {
	var capturedCtx *Context

	err := Run(func(ctx *Context) error {
		capturedCtx = ctx
		return nil
	})

	if err != nil {
		t.Fatalf("Run() returned error: %v", err)
	}

	if capturedCtx == nil {
		t.Fatal("Context was not provided to function")
	}

	if capturedCtx.variables == nil {
		t.Error("Context variables map is nil")
	}
}

// =============================================================================
// Inspection Methods Tests
// =============================================================================

func TestContext_Variables(t *testing.T) {
	ctx := newContext()

	// Add some variables
	ctx.SetString("apiURL", "https://api.example.com")
	ctx.SetInt("retries", 3)
	ctx.SetBool("isProd", true)

	// Get variables
	vars := ctx.Variables()

	if len(vars) != 3 {
		t.Errorf("Variables() returned %d items, want 3", len(vars))
	}

	if vars["apiURL"] == nil {
		t.Error("apiURL not in variables")
	}

	if vars["retries"] == nil {
		t.Error("retries not in variables")
	}

	if vars["isProd"] == nil {
		t.Error("isProd not in variables")
	}

	// Verify it's a copy (modifying it doesn't affect context)
	delete(vars, "apiURL")
	if ctx.Get("apiURL") == nil {
		t.Error("Deleting from returned map affected context")
	}
}

func TestContext_Workflows(t *testing.T) {
	ctx := newContext()

	// Initially empty
	workflows := ctx.Workflows()
	if len(workflows) != 0 {
		t.Errorf("New context should have 0 workflows, got %d", len(workflows))
	}

	// TODO: Add workflow registration test when workflow.New() accepts context
}

func TestContext_Agents(t *testing.T) {
	ctx := newContext()

	// Initially empty
	agents := ctx.Agents()
	if len(agents) != 0 {
		t.Errorf("New context should have 0 agents, got %d", len(agents))
	}

	// TODO: Add agent registration test when agent.New() accepts context
}

// =============================================================================
// Concurrency Tests
// =============================================================================

func TestContext_ConcurrentAccess(t *testing.T) {
	ctx := newContext()

	// Concurrent writes
	done := make(chan bool, 10)
	for i := 0; i < 10; i++ {
		go func(n int) {
			ctx.SetString(fmt.Sprintf("var%d", n), fmt.Sprintf("value%d", n))
			done <- true
		}(i)
	}

	// Wait for all goroutines
	for i := 0; i < 10; i++ {
		<-done
	}

	// Verify all variables were set
	vars := ctx.Variables()
	if len(vars) != 10 {
		t.Errorf("Expected 10 variables, got %d", len(vars))
	}
}

// =============================================================================
// Dependency Tracking Tests
// =============================================================================

func TestContext_RegisterSkill(t *testing.T) {
	ctx := newContext()

	// Create an inline skill
	skill := &skill.Skill{
		Name:            "test-skill",
		Description:     "Test skill",
		MarkdownContent: "# Test skill content",
		IsInline:        true,
	}

	ctx.RegisterSkill(skill)

	// Verify skill is registered
	skills := ctx.Skills()
	if len(skills) != 1 {
		t.Errorf("Expected 1 skill, got %d", len(skills))
	}

	if skills[0].Name != "test-skill" {
		t.Errorf("Skill name = %q, want %q", skills[0].Name, "test-skill")
	}

	// Skills have no dependencies (they're leaf resources)
	deps := ctx.Dependencies()
	if len(deps) != 0 {
		t.Errorf("Skills should have no dependencies, got %d", len(deps))
	}
}

func TestContext_RegisterSkill_ExternalSkillNotTracked(t *testing.T) {
	ctx := newContext()

	// Create an external skill reference
	externalSkill := &skill.Skill{
		Slug:     "platform-skill",
		Org:      "",
		IsInline: false,
	}

	ctx.RegisterSkill(externalSkill)

	// External skills should NOT be tracked
	skills := ctx.Skills()
	if len(skills) != 0 {
		t.Errorf("External skills should not be tracked, got %d", len(skills))
	}
}

func TestContext_RegisterAgent_TracksSkillDependencies(t *testing.T) {
	ctx := newContext()

	// Create an agent with inline skill
	ag := &agent.Agent{
		Name:         "test-agent",
		Instructions: "Test agent instructions",
		Skills: []skill.Skill{
			{
				Name:            "code-analysis",
				MarkdownContent: "# Code analysis skill",
				IsInline:        true,
			},
		},
	}

	ctx.RegisterAgent(ag)

	// Verify agent is registered
	agents := ctx.Agents()
	if len(agents) != 1 {
		t.Errorf("Expected 1 agent, got %d", len(agents))
	}

	// Verify dependency was tracked
	deps := ctx.Dependencies()
	agentID := "agent:test-agent"
	skillID := "skill:code-analysis"

	if deps[agentID] == nil {
		t.Fatal("Agent dependencies not tracked")
	}

	if len(deps[agentID]) != 1 {
		t.Errorf("Expected 1 dependency, got %d", len(deps[agentID]))
	}

	if deps[agentID][0] != skillID {
		t.Errorf("Dependency = %q, want %q", deps[agentID][0], skillID)
	}
}

func TestContext_RegisterAgent_MultipleSkills(t *testing.T) {
	ctx := newContext()

	// Create an agent with multiple inline skills
	ag := &agent.Agent{
		Name:         "test-agent",
		Instructions: "Test agent instructions",
		Skills: []skill.Skill{
			{Name: "skill1", MarkdownContent: "content1", IsInline: true},
			{Name: "skill2", MarkdownContent: "content2", IsInline: true},
			{Slug: "platform-skill", IsInline: false}, // External - should be skipped
		},
	}

	ctx.RegisterAgent(ag)

	// Verify dependencies
	deps := ctx.GetDependencies("agent:test-agent")
	if len(deps) != 2 {
		t.Errorf("Expected 2 dependencies (only inline skills), got %d", len(deps))
	}

	// Verify both inline skills are tracked
	hasSkill1 := false
	hasSkill2 := false
	for _, dep := range deps {
		if dep == "skill:skill1" {
			hasSkill1 = true
		}
		if dep == "skill:skill2" {
			hasSkill2 = true
		}
	}

	if !hasSkill1 {
		t.Error("skill1 dependency not tracked")
	}
	if !hasSkill2 {
		t.Error("skill2 dependency not tracked")
	}
}

func TestContext_GetDependencies(t *testing.T) {
	ctx := newContext()

	// Manually add some dependencies for testing
	ctx.mu.Lock()
	ctx.addDependency("agent:test", "skill:skill1")
	ctx.addDependency("agent:test", "skill:skill2")
	ctx.mu.Unlock()

	// Get dependencies
	deps := ctx.GetDependencies("agent:test")
	if len(deps) != 2 {
		t.Errorf("Expected 2 dependencies, got %d", len(deps))
	}

	// Get non-existent resource
	noDeps := ctx.GetDependencies("agent:nonexistent")
	if noDeps != nil {
		t.Errorf("Expected nil for non-existent resource, got %v", noDeps)
	}

	// Verify returned slice is a copy (modifying it doesn't affect context)
	deps[0] = "modified"
	originalDeps := ctx.GetDependencies("agent:test")
	if originalDeps[0] == "modified" {
		t.Error("Modifying returned slice affected context")
	}
}

func TestContext_Dependencies(t *testing.T) {
	ctx := newContext()

	// Create agent with skills
	ag := &agent.Agent{
		Name:         "test-agent",
		Instructions: "Test instructions",
		Skills: []skill.Skill{
			{Name: "skill1", MarkdownContent: "content", IsInline: true},
		},
	}
	ctx.RegisterAgent(ag)

	// Get full dependency graph
	deps := ctx.Dependencies()

	if len(deps) != 1 {
		t.Errorf("Expected 1 entry in dependency graph, got %d", len(deps))
	}

	if deps["agent:test-agent"] == nil {
		t.Error("Agent not in dependency graph")
	}

	// Verify returned map is a deep copy
	delete(deps, "agent:test-agent")
	originalDeps := ctx.Dependencies()
	if originalDeps["agent:test-agent"] == nil {
		t.Error("Deleting from returned map affected context")
	}
}

func TestContext_Skills(t *testing.T) {
	ctx := newContext()

	// Initially empty
	skills := ctx.Skills()
	if len(skills) != 0 {
		t.Errorf("New context should have 0 skills, got %d", len(skills))
	}

	// Register a skill
	skill := &skill.Skill{
		Name:            "test-skill",
		MarkdownContent: "content",
		IsInline:        true,
	}
	ctx.RegisterSkill(skill)

	// Verify it's tracked
	skills = ctx.Skills()
	if len(skills) != 1 {
		t.Errorf("Expected 1 skill, got %d", len(skills))
	}

	// Verify returned slice is a copy
	skills[0] = nil
	if ctx.Skills()[0] == nil {
		t.Error("Modifying returned slice affected context")
	}
}

func TestResourceIDGeneration(t *testing.T) {
	tests := []struct {
		name     string
		genFunc  func() string
		expected string
	}{
		{
			name: "agent ID",
			genFunc: func() string {
				return agentResourceID(&agent.Agent{Name: "my-agent"})
			},
			expected: "agent:my-agent",
		},
		{
			name: "workflow ID",
			genFunc: func() string {
				return workflowResourceID(&workflow.Workflow{
					Document: workflow.Document{Name: "my-workflow"},
				})
			},
			expected: "workflow:my-workflow",
		},
		{
			name: "inline skill ID",
			genFunc: func() string {
				return skillResourceID(&skill.Skill{Name: "my-skill", IsInline: true})
			},
			expected: "skill:my-skill",
		},
		{
			name: "external skill ID",
			genFunc: func() string {
				return skillResourceID(&skill.Skill{Slug: "platform-skill", IsInline: false})
			},
			expected: "skill:external:platform-skill",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.genFunc()
			if got != tt.expected {
				t.Errorf("Resource ID = %q, want %q", got, tt.expected)
			}
		})
	}
}

// =============================================================================
// Integration Tests
// =============================================================================

func TestContext_CompleteWorkflow(t *testing.T) {
	err := Run(func(ctx *Context) error {
		// Set up configuration
		baseURL := ctx.SetString("baseURL", "https://api.example.com")
		apiKey := ctx.SetSecret("apiKey", "secret-key")
		retries := ctx.SetInt("retries", 3)
		isProd := ctx.SetBool("isProd", true)

		// Create computed values
		usersEndpoint := baseURL.Append("/users")
		authHeader := apiKey.Prepend("Bearer ")
		maxRetries := retries.Add(ctx.SetInt("extra", 2))

		// Verify expressions
		if usersEndpoint.Expression() == "" {
			return fmt.Errorf("usersEndpoint expression is empty")
		}

		if authHeader.Expression() == "" {
			return fmt.Errorf("authHeader expression is empty")
		}

		if maxRetries.Expression() == "" {
			return fmt.Errorf("maxRetries expression is empty")
		}

		// Verify base values are accessible
		if baseURL.Value() != "https://api.example.com" {
			return fmt.Errorf("baseURL value incorrect")
		}

		if !apiKey.IsSecret() {
			return fmt.Errorf("apiKey should be secret")
		}

		if !isProd.Value() {
			return fmt.Errorf("isProd value incorrect")
		}

		return nil
	})

	if err != nil {
		t.Errorf("Complete workflow failed: %v", err)
	}
}

func TestContext_DependencyTrackingIntegration(t *testing.T) {
	ctx := newContext()

	// Create skills
	skill1 := &skill.Skill{
		Name:            "coding",
		MarkdownContent: "# Coding standards",
		IsInline:        true,
	}
	skill2 := &skill.Skill{
		Name:            "security",
		MarkdownContent: "# Security guidelines",
		IsInline:        true,
	}

	ctx.RegisterSkill(skill1)
	ctx.RegisterSkill(skill2)

	// Create agents with skills
	agent1 := &agent.Agent{
		Name:         "code-reviewer",
		Instructions: "Review code quality",
		Skills:       []skill.Skill{*skill1},
	}
	agent2 := &agent.Agent{
		Name:         "sec-reviewer",
		Instructions: "Review security",
		Skills:       []skill.Skill{*skill2},
	}

	ctx.RegisterAgent(agent1)
	ctx.RegisterAgent(agent2)

	// Verify dependency graph
	deps := ctx.Dependencies()

	// Should have 2 agents with dependencies
	if len(deps) != 2 {
		t.Errorf("Expected 2 entries in dependency graph, got %d", len(deps))
	}

	// Verify agent1 depends on skill1
	agent1Deps := deps["agent:code-reviewer"]
	if len(agent1Deps) != 1 {
		t.Errorf("agent1 should have 1 dependency, got %d", len(agent1Deps))
	}
	if agent1Deps[0] != "skill:coding" {
		t.Errorf("agent1 dependency = %q, want %q", agent1Deps[0], "skill:coding")
	}

	// Verify agent2 depends on skill2
	agent2Deps := deps["agent:sec-reviewer"]
	if len(agent2Deps) != 1 {
		t.Errorf("agent2 should have 1 dependency, got %d", len(agent2Deps))
	}
	if agent2Deps[0] != "skill:security" {
		t.Errorf("agent2 dependency = %q, want %q", agent2Deps[0], "skill:security")
	}

	// Verify skills are tracked
	skills := ctx.Skills()
	if len(skills) != 2 {
		t.Errorf("Expected 2 skills tracked, got %d", len(skills))
	}
}
