package synthesis

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// TestTopologicalSort_NoDependen cies tests sorting when there are no dependencies.
func TestTopologicalSort_NoDependencies(t *testing.T) {
	result := &Result{
		Skills: []*skillv1.Skill{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "skill1"}},
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "skill2"}},
		},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
		},
		Workflows:    []*workflowv1.Workflow{},
		Dependencies: map[string][]string{},
	}

	ordered, err := result.GetOrderedResources()
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if len(ordered) != 3 {
		t.Fatalf("Expected 3 resources, got %d", len(ordered))
	}

	// All resources should be present (order doesn't matter when there are no deps)
	ids := make(map[string]bool)
	for _, res := range ordered {
		ids[res.ID] = true
	}

	expectedIDs := []string{"skill:skill1", "skill:skill2", "agent:agent1"}
	for _, expectedID := range expectedIDs {
		if !ids[expectedID] {
			t.Errorf("Expected resource %s not found in ordered list", expectedID)
		}
	}
}

// TestTopologicalSort_LinearChain tests a linear dependency chain.
func TestTopologicalSort_LinearChain(t *testing.T) {
	// skill1 → agent1 → workflow1
	result := &Result{
		Skills: []*skillv1.Skill{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "skill1"}},
		},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
		},
		Workflows: []*workflowv1.Workflow{
			{
				Metadata: &apiresource.ApiResourceMetadata{Slug: "workflow1"},
				Spec: &workflowv1.WorkflowSpec{
					Document: &workflowv1.WorkflowDocument{Name: "workflow1"},
				},
			},
		},
		Dependencies: map[string][]string{
			"agent:agent1":       {"skill:skill1"},
			"workflow:workflow1": {"agent:agent1"},
		},
	}

	ordered, err := result.GetOrderedResources()
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if len(ordered) != 3 {
		t.Fatalf("Expected 3 resources, got %d", len(ordered))
	}

	// Verify order: skill1 → agent1 → workflow1
	if ordered[0].ID != "skill:skill1" {
		t.Errorf("Expected skill:skill1 first, got %s", ordered[0].ID)
	}
	if ordered[1].ID != "agent:agent1" {
		t.Errorf("Expected agent:agent1 second, got %s", ordered[1].ID)
	}
	if ordered[2].ID != "workflow:workflow1" {
		t.Errorf("Expected workflow:workflow1 third, got %s", ordered[2].ID)
	}
}

// TestTopologicalSort_MultipleSkills tests agent with multiple skill dependencies.
func TestTopologicalSort_MultipleSkills(t *testing.T) {
	// skill1, skill2 → agent1
	result := &Result{
		Skills: []*skillv1.Skill{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "skill1"}},
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "skill2"}},
		},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
		},
		Workflows: []*workflowv1.Workflow{},
		Dependencies: map[string][]string{
			"agent:agent1": {"skill:skill1", "skill:skill2"},
		},
	}

	ordered, err := result.GetOrderedResources()
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if len(ordered) != 3 {
		t.Fatalf("Expected 3 resources, got %d", len(ordered))
	}

	// Verify skills come before agent
	agentIndex := -1
	skill1Index := -1
	skill2Index := -1

	for i, res := range ordered {
		switch res.ID {
		case "agent:agent1":
			agentIndex = i
		case "skill:skill1":
			skill1Index = i
		case "skill:skill2":
			skill2Index = i
		}
	}

	if skill1Index == -1 || skill2Index == -1 || agentIndex == -1 {
		t.Fatal("Not all resources found")
	}

	if skill1Index >= agentIndex || skill2Index >= agentIndex {
		t.Error("Skills should come before agent that depends on them")
	}
}

// TestTopologicalSort_DiamondDependency tests a diamond-shaped dependency graph.
func TestTopologicalSort_DiamondDependency(t *testing.T) {
	// skill1 → agent1, agent2 → workflow1
	result := &Result{
		Skills: []*skillv1.Skill{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "skill1"}},
		},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent2"}},
		},
		Workflows: []*workflowv1.Workflow{
			{
				Metadata: &apiresource.ApiResourceMetadata{Slug: "workflow1"},
				Spec: &workflowv1.WorkflowSpec{
					Document: &workflowv1.WorkflowDocument{Name: "workflow1"},
				},
			},
		},
		Dependencies: map[string][]string{
			"agent:agent1":       {"skill:skill1"},
			"agent:agent2":       {"skill:skill1"},
			"workflow:workflow1": {"agent:agent1", "agent:agent2"},
		},
	}

	ordered, err := result.GetOrderedResources()
	if err != nil {
		t.Fatalf("Expected no error, got: %v", err)
	}

	if len(ordered) != 4 {
		t.Fatalf("Expected 4 resources, got %d", len(ordered))
	}

	// Find indices
	skillIndex := -1
	agent1Index := -1
	agent2Index := -1
	workflowIndex := -1

	for i, res := range ordered {
		switch res.ID {
		case "skill:skill1":
			skillIndex = i
		case "agent:agent1":
			agent1Index = i
		case "agent:agent2":
			agent2Index = i
		case "workflow:workflow1":
			workflowIndex = i
		}
	}

	// Verify: skill < agents < workflow
	if skillIndex >= agent1Index || skillIndex >= agent2Index {
		t.Error("Skill should come before agents")
	}
	if agent1Index >= workflowIndex || agent2Index >= workflowIndex {
		t.Error("Agents should come before workflow")
	}
}

// TestTopologicalSort_CircularDependency tests detection of circular dependencies.
func TestTopologicalSort_CircularDependency(t *testing.T) {
	// agent1 → agent2 → agent1 (circular!)
	result := &Result{
		Skills: []*skillv1.Skill{},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent2"}},
		},
		Workflows: []*workflowv1.Workflow{},
		Dependencies: map[string][]string{
			"agent:agent1": {"agent:agent2"},
			"agent:agent2": {"agent:agent1"},
		},
	}

	_, err := result.GetOrderedResources()
	if err == nil {
		t.Fatal("Expected circular dependency error, got nil")
	}

	// Error message should mention circular dependency
	errMsg := err.Error()
	t.Logf("Circular dependency error: %s", errMsg)
}

// TestValidateDependencies_ValidDeps tests validation with valid dependencies.
func TestValidateDependencies_ValidDeps(t *testing.T) {
	result := &Result{
		Skills: []*skillv1.Skill{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "skill1"}},
		},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
		},
		Workflows:    []*workflowv1.Workflow{},
		Dependencies: map[string][]string{
			"agent:agent1": {"skill:skill1"},
		},
	}

	err := result.ValidateDependencies()
	if err != nil {
		t.Errorf("Expected no error for valid dependencies, got: %v", err)
	}
}

// TestValidateDependencies_InvalidDep tests validation with non-existent dependency.
func TestValidateDependencies_InvalidDep(t *testing.T) {
	result := &Result{
		Skills: []*skillv1.Skill{},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
		},
		Workflows: []*workflowv1.Workflow{},
		Dependencies: map[string][]string{
			"agent:agent1": {"skill:nonexistent"},
		},
	}

	err := result.ValidateDependencies()
	if err == nil {
		t.Error("Expected error for non-existent dependency, got nil")
	}
}

// TestValidateDependencies_ExternalRef tests that external references are allowed.
func TestValidateDependencies_ExternalRef(t *testing.T) {
	result := &Result{
		Skills: []*skillv1.Skill{},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
		},
		Workflows: []*workflowv1.Workflow{},
		Dependencies: map[string][]string{
			"agent:agent1": {"skill:external:platform-security"},
		},
	}

	err := result.ValidateDependencies()
	if err != nil {
		t.Errorf("Expected no error for external reference, got: %v", err)
	}
}

// TestGetDependencyGraph tests the human-readable graph output.
func TestGetDependencyGraph(t *testing.T) {
	result := &Result{
		Skills: []*skillv1.Skill{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "skill1"}},
		},
		Agents: []*agentv1.Agent{
			{Metadata: &apiresource.ApiResourceMetadata{Slug: "agent1"}},
		},
		Workflows:    []*workflowv1.Workflow{},
		Dependencies: map[string][]string{
			"agent:agent1": {"skill:skill1"},
		},
	}

	graph := result.GetDependencyGraph()
	if len(graph) == 0 {
		t.Error("Expected non-empty dependency graph string")
	}

	// Should contain the resource IDs
	if len(graph) < 10 {
		t.Errorf("Dependency graph seems incomplete: %s", graph)
	}
}

// TestGetDependencyGraph_Empty tests graph output with no dependencies.
func TestGetDependencyGraph_Empty(t *testing.T) {
	result := &Result{
		Skills:       []*skillv1.Skill{},
		Agents:       []*agentv1.Agent{},
		Workflows:    []*workflowv1.Workflow{},
		Dependencies: map[string][]string{},
	}

	graph := result.GetDependencyGraph()
	if graph != "No dependencies" {
		t.Errorf("Expected 'No dependencies', got: %s", graph)
	}
}

// TestIsExternalReference tests external reference detection.
func TestIsExternalReference(t *testing.T) {
	tests := []struct {
		id       string
		expected bool
	}{
		{"skill:external:platform-security", true},
		{"agent:external:some-agent", true},
		{"skill:inline-skill", false},
		{"agent:my-agent", false},
		{"workflow:my-workflow", false},
		{"", false},
		{"external", false},
	}

	for _, tt := range tests {
		result := isExternalReference(tt.id)
		if result != tt.expected {
			t.Errorf("isExternalReference(%s) = %v, want %v", tt.id, result, tt.expected)
		}
	}
}
