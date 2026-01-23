package synthesis

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
)

// Test helper functions
func createTestSkill(slug string) *skillv1.Skill {
	return &skillv1.Skill{
		Metadata: &apiresource.ApiResourceMetadata{Slug: slug},
	}
}

func createTestAgent(slug string) *agentv1.Agent {
	return &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Slug: slug},
	}
}

func createTestWorkflow(name string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Slug: name},
		Spec: &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{Name: name},
		},
	}
}

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

func TestGetResourcesByDepth_NoDependencies(t *testing.T) {
	// All resources at depth 0 (can be created in parallel)
	skill1 := createTestSkill("skill1")
	skill2 := createTestSkill("skill2")
	agent1 := createTestAgent("agent1")

	result := &Result{
		Skills:       []*skillv1.Skill{skill1, skill2},
		Agents:       []*agentv1.Agent{agent1},
		Dependencies: map[string][]string{},
	}

	groups, err := result.GetResourcesByDepth()
	if err != nil {
		t.Fatalf("GetResourcesByDepth failed: %v", err)
	}

	// Should have 1 group with all resources
	if len(groups) != 1 {
		t.Fatalf("expected 1 depth group, got %d", len(groups))
	}

	// All resources should be at depth 0
	if len(groups[0]) != 3 {
		t.Errorf("expected 3 resources at depth 0, got %d", len(groups[0]))
	}
}

func TestGetResourcesByDepth_LinearChain(t *testing.T) {
	// skill → agent → workflow (linear dependency chain)
	skill := createTestSkill("coding")
	agent := createTestAgent("reviewer")
	workflow := createTestWorkflow("pr-review")

	result := &Result{
		Skills:    []*skillv1.Skill{skill},
		Agents:    []*agentv1.Agent{agent},
		Workflows: []*workflowv1.Workflow{workflow},
		Dependencies: map[string][]string{
			"agent:reviewer":     {"skill:coding"},
			"workflow:pr-review": {"agent:reviewer"},
		},
	}

	groups, err := result.GetResourcesByDepth()
	if err != nil {
		t.Fatalf("GetResourcesByDepth failed: %v", err)
	}

	// Should have 3 depth levels
	if len(groups) != 3 {
		t.Fatalf("expected 3 depth groups, got %d", len(groups))
	}

	// Depth 0: skill
	if len(groups[0]) != 1 {
		t.Errorf("expected 1 resource at depth 0, got %d", len(groups[0]))
	}
	if groups[0][0].ID != "skill:coding" {
		t.Errorf("expected skill:coding at depth 0, got %s", groups[0][0].ID)
	}

	// Depth 1: agent
	if len(groups[1]) != 1 {
		t.Errorf("expected 1 resource at depth 1, got %d", len(groups[1]))
	}
	if groups[1][0].ID != "agent:reviewer" {
		t.Errorf("expected agent:reviewer at depth 1, got %s", groups[1][0].ID)
	}

	// Depth 2: workflow
	if len(groups[2]) != 1 {
		t.Errorf("expected 1 resource at depth 2, got %d", len(groups[2]))
	}
	if groups[2][0].ID != "workflow:pr-review" {
		t.Errorf("expected workflow:pr-review at depth 2, got %s", groups[2][0].ID)
	}
}

func TestGetResourcesByDepth_ParallelBranches(t *testing.T) {
	// Two parallel branches that can be created simultaneously
	// skill1, skill2 (depth 0)
	//   ↓       ↓
	// agent1, agent2 (depth 1)
	//   ↓       ↓
	//    workflow  (depth 2)

	skill1 := createTestSkill("coding")
	skill2 := createTestSkill("security")
	agent1 := createTestAgent("code-reviewer")
	agent2 := createTestAgent("sec-reviewer")
	workflow := createTestWorkflow("pr-review")

	result := &Result{
		Skills:    []*skillv1.Skill{skill1, skill2},
		Agents:    []*agentv1.Agent{agent1, agent2},
		Workflows: []*workflowv1.Workflow{workflow},
		Dependencies: map[string][]string{
			"agent:code-reviewer": {"skill:coding"},
			"agent:sec-reviewer":  {"skill:security"},
			"workflow:pr-review":  {"agent:code-reviewer", "agent:sec-reviewer"},
		},
	}

	groups, err := result.GetResourcesByDepth()
	if err != nil {
		t.Fatalf("GetResourcesByDepth failed: %v", err)
	}

	// Should have 3 depth levels
	if len(groups) != 3 {
		t.Fatalf("expected 3 depth groups, got %d", len(groups))
	}

	// Depth 0: 2 skills (can be created in parallel)
	if len(groups[0]) != 2 {
		t.Errorf("expected 2 resources at depth 0, got %d", len(groups[0]))
	}

	// Depth 1: 2 agents (can be created in parallel)
	if len(groups[1]) != 2 {
		t.Errorf("expected 2 resources at depth 1, got %d", len(groups[1]))
	}

	// Depth 2: 1 workflow
	if len(groups[2]) != 1 {
		t.Errorf("expected 1 resource at depth 2, got %d", len(groups[2]))
	}
}

func TestGetResourcesByDepth_DiamondDependency(t *testing.T) {
	// Diamond pattern with shared dependency
	//     skill
	//    ↙    ↘
	// agent1  agent2
	//    ↘    ↙
	//   workflow

	skill := createTestSkill("shared")
	agent1 := createTestAgent("reviewer1")
	agent2 := createTestAgent("reviewer2")
	workflow := createTestWorkflow("pr-review")

	result := &Result{
		Skills:    []*skillv1.Skill{skill},
		Agents:    []*agentv1.Agent{agent1, agent2},
		Workflows: []*workflowv1.Workflow{workflow},
		Dependencies: map[string][]string{
			"agent:reviewer1":    {"skill:shared"},
			"agent:reviewer2":    {"skill:shared"},
			"workflow:pr-review": {"agent:reviewer1", "agent:reviewer2"},
		},
	}

	groups, err := result.GetResourcesByDepth()
	if err != nil {
		t.Fatalf("GetResourcesByDepth failed: %v", err)
	}

	// Should have 3 depth levels
	if len(groups) != 3 {
		t.Fatalf("expected 3 depth groups, got %d", len(groups))
	}

	// Depth 0: skill
	if len(groups[0]) != 1 {
		t.Errorf("expected 1 resource at depth 0, got %d", len(groups[0]))
	}

	// Depth 1: 2 agents (can be created in parallel)
	if len(groups[1]) != 2 {
		t.Errorf("expected 2 resources at depth 1, got %d", len(groups[1]))
	}

	// Depth 2: workflow
	if len(groups[2]) != 1 {
		t.Errorf("expected 1 resource at depth 2, got %d", len(groups[2]))
	}
}

func TestGetResourcesByDepth_ComplexGraph(t *testing.T) {
	// Complex dependency graph with multiple depths
	// s1, s2, s3 (depth 0)
	//  ↓   ↓   ↓
	// a1  a2  a3 (depth 1, a2 depends on both s1 and s2)
	//  ↓   ↓   ↓
	// w1  w2     (depth 2, w1 depends on a1 and a3)

	s1 := createTestSkill("skill1")
	s2 := createTestSkill("skill2")
	s3 := createTestSkill("skill3")
	a1 := createTestAgent("agent1")
	a2 := createTestAgent("agent2")
	a3 := createTestAgent("agent3")
	w1 := createTestWorkflow("workflow1")
	w2 := createTestWorkflow("workflow2")

	result := &Result{
		Skills:    []*skillv1.Skill{s1, s2, s3},
		Agents:    []*agentv1.Agent{a1, a2, a3},
		Workflows: []*workflowv1.Workflow{w1, w2},
		Dependencies: map[string][]string{
			"agent:agent1":       {"skill:skill1"},
			"agent:agent2":       {"skill:skill1", "skill:skill2"},
			"agent:agent3":       {"skill:skill3"},
			"workflow:workflow1": {"agent:agent1", "agent:agent3"},
			"workflow:workflow2": {"agent:agent2"},
		},
	}

	groups, err := result.GetResourcesByDepth()
	if err != nil {
		t.Fatalf("GetResourcesByDepth failed: %v", err)
	}

	// Should have 3 depth levels
	if len(groups) != 3 {
		t.Fatalf("expected 3 depth groups, got %d", len(groups))
	}

	// Depth 0: 3 skills
	if len(groups[0]) != 3 {
		t.Errorf("expected 3 resources at depth 0, got %d", len(groups[0]))
	}

	// Depth 1: 3 agents
	if len(groups[1]) != 3 {
		t.Errorf("expected 3 resources at depth 1, got %d", len(groups[1]))
	}

	// Depth 2: 2 workflows
	if len(groups[2]) != 2 {
		t.Errorf("expected 2 resources at depth 2, got %d", len(groups[2]))
	}
}

func TestGetResourcesByDepth_WithExternalReferences(t *testing.T) {
	// Resources with external dependencies should not affect depth calculation
	skill := createTestSkill("internal")
	agent := createTestAgent("reviewer")
	workflow := createTestWorkflow("pr-review")

	result := &Result{
		Skills:    []*skillv1.Skill{skill},
		Agents:    []*agentv1.Agent{agent},
		Workflows: []*workflowv1.Workflow{workflow},
		Dependencies: map[string][]string{
			"agent:reviewer":     {"skill:internal", "skill:external:platform-skill"},
			"workflow:pr-review": {"agent:reviewer", "agent:external:platform-agent"},
		},
	}

	groups, err := result.GetResourcesByDepth()
	if err != nil {
		t.Fatalf("GetResourcesByDepth failed: %v", err)
	}

	// External references should be ignored in depth calculation
	// Should have 3 depth levels
	if len(groups) != 3 {
		t.Fatalf("expected 3 depth groups, got %d", len(groups))
	}

	// Depth 0: skill
	if len(groups[0]) != 1 {
		t.Errorf("expected 1 resource at depth 0, got %d", len(groups[0]))
	}

	// Depth 1: agent
	if len(groups[1]) != 1 {
		t.Errorf("expected 1 resource at depth 1, got %d", len(groups[1]))
	}

	// Depth 2: workflow
	if len(groups[2]) != 1 {
		t.Errorf("expected 1 resource at depth 2, got %d", len(groups[2]))
	}
}

func TestGetResourcesByDepth_Empty(t *testing.T) {
	result := &Result{
		Skills:       []*skillv1.Skill{},
		Agents:       []*agentv1.Agent{},
		Workflows:    []*workflowv1.Workflow{},
		Dependencies: map[string][]string{},
	}

	groups, err := result.GetResourcesByDepth()
	if err != nil {
		t.Fatalf("GetResourcesByDepth failed: %v", err)
	}

	// Should return empty slice
	if len(groups) != 0 {
		t.Errorf("expected 0 depth groups, got %d", len(groups))
	}
}

// Visualization Tests

func TestGetDependencyGraphMermaid_Empty(t *testing.T) {
	result := &Result{
		Skills:       []*skillv1.Skill{},
		Agents:       []*agentv1.Agent{},
		Workflows:    []*workflowv1.Workflow{},
		Dependencies: map[string][]string{},
	}

	mermaid := result.GetDependencyGraphMermaid()
	if mermaid == "" {
		t.Error("expected non-empty Mermaid diagram")
	}
	
	// Should contain empty state
	if !containsString(mermaid, "empty") {
		t.Error("expected Mermaid diagram to indicate empty state")
	}
}

func TestGetDependencyGraphMermaid_SimpleChain(t *testing.T) {
	skill := createTestSkill("coding")
	agent := createTestAgent("reviewer")
	workflow := createTestWorkflow("pr-review")

	result := &Result{
		Skills:    []*skillv1.Skill{skill},
		Agents:    []*agentv1.Agent{agent},
		Workflows: []*workflowv1.Workflow{workflow},
		Dependencies: map[string][]string{
			"agent:reviewer":     {"skill:coding"},
			"workflow:pr-review": {"agent:reviewer"},
		},
	}

	mermaid := result.GetDependencyGraphMermaid()
	
	// Should contain Mermaid header
	if !containsString(mermaid, "```mermaid") {
		t.Error("expected Mermaid code block opening")
	}
	
	if !containsString(mermaid, "flowchart LR") {
		t.Error("expected flowchart LR directive")
	}
	
	// Should contain all resources
	if !containsString(mermaid, "skill:coding") {
		t.Error("expected skill:coding in diagram")
	}
	if !containsString(mermaid, "agent:reviewer") {
		t.Error("expected agent:reviewer in diagram")
	}
	if !containsString(mermaid, "workflow:pr-review") {
		t.Error("expected workflow:pr-review in diagram")
	}
	
	// Should contain arrows
	if !containsString(mermaid, "-->") {
		t.Error("expected --> arrows in diagram")
	}
	
	// Should contain styling
	if !containsString(mermaid, "classDef skill") {
		t.Error("expected skill styling")
	}
	if !containsString(mermaid, "classDef agent") {
		t.Error("expected agent styling")
	}
	if !containsString(mermaid, "classDef workflow") {
		t.Error("expected workflow styling")
	}
}

func TestGetDependencyGraphMermaid_ParallelBranches(t *testing.T) {
	skill1 := createTestSkill("coding")
	skill2 := createTestSkill("security")
	agent1 := createTestAgent("code-reviewer")
	agent2 := createTestAgent("sec-reviewer")
	workflow := createTestWorkflow("pr-review")

	result := &Result{
		Skills:    []*skillv1.Skill{skill1, skill2},
		Agents:    []*agentv1.Agent{agent1, agent2},
		Workflows: []*workflowv1.Workflow{workflow},
		Dependencies: map[string][]string{
			"agent:code-reviewer": {"skill:coding"},
			"agent:sec-reviewer":  {"skill:security"},
			"workflow:pr-review":  {"agent:code-reviewer", "agent:sec-reviewer"},
		},
	}

	mermaid := result.GetDependencyGraphMermaid()
	
	// Should contain all resources
	if !containsString(mermaid, "skill:coding") {
		t.Error("expected skill:coding in diagram")
	}
	if !containsString(mermaid, "skill:security") {
		t.Error("expected skill:security in diagram")
	}
	if !containsString(mermaid, "agent:code-reviewer") {
		t.Error("expected agent:code-reviewer in diagram")
	}
	if !containsString(mermaid, "agent:sec-reviewer") {
		t.Error("expected agent:sec-reviewer in diagram")
	}
	if !containsString(mermaid, "workflow:pr-review") {
		t.Error("expected workflow:pr-review in diagram")
	}
}

func TestGetDependencyGraphDot_Empty(t *testing.T) {
	result := &Result{
		Skills:       []*skillv1.Skill{},
		Agents:       []*agentv1.Agent{},
		Workflows:    []*workflowv1.Workflow{},
		Dependencies: map[string][]string{},
	}

	dot := result.GetDependencyGraphDot()
	if dot == "" {
		t.Error("expected non-empty DOT diagram")
	}
	
	// Should contain DOT header
	if !containsString(dot, "digraph dependencies") {
		t.Error("expected digraph dependencies directive")
	}
	
	// Should contain empty state
	if !containsString(dot, "empty") {
		t.Error("expected DOT diagram to indicate empty state")
	}
}

func TestGetDependencyGraphDot_SimpleChain(t *testing.T) {
	skill := createTestSkill("coding")
	agent := createTestAgent("reviewer")
	workflow := createTestWorkflow("pr-review")

	result := &Result{
		Skills:    []*skillv1.Skill{skill},
		Agents:    []*agentv1.Agent{agent},
		Workflows: []*workflowv1.Workflow{workflow},
		Dependencies: map[string][]string{
			"agent:reviewer":     {"skill:coding"},
			"workflow:pr-review": {"agent:reviewer"},
		},
	}

	dot := result.GetDependencyGraphDot()
	
	// Should contain DOT header
	if !containsString(dot, "digraph dependencies") {
		t.Error("expected digraph dependencies directive")
	}
	
	if !containsString(dot, "rankdir=LR") {
		t.Error("expected left-to-right layout")
	}
	
	// Should contain all resources
	if !containsString(dot, "\"skill:coding\"") {
		t.Error("expected skill:coding in diagram")
	}
	if !containsString(dot, "\"agent:reviewer\"") {
		t.Error("expected agent:reviewer in diagram")
	}
	if !containsString(dot, "\"workflow:pr-review\"") {
		t.Error("expected workflow:pr-review in diagram")
	}
	
	// Should contain arrows
	if !containsString(dot, "->") {
		t.Error("expected -> arrows in diagram")
	}
	
	// Should contain shapes
	if !containsString(dot, "shape=") {
		t.Error("expected shape definitions")
	}
	
	// Should contain colors
	if !containsString(dot, "fillcolor=") {
		t.Error("expected fillcolor definitions")
	}
}

func TestGetDependencyGraphDot_ParallelBranches(t *testing.T) {
	skill1 := createTestSkill("coding")
	skill2 := createTestSkill("security")
	agent1 := createTestAgent("code-reviewer")
	agent2 := createTestAgent("sec-reviewer")
	workflow := createTestWorkflow("pr-review")

	result := &Result{
		Skills:    []*skillv1.Skill{skill1, skill2},
		Agents:    []*agentv1.Agent{agent1, agent2},
		Workflows: []*workflowv1.Workflow{workflow},
		Dependencies: map[string][]string{
			"agent:code-reviewer": {"skill:coding"},
			"agent:sec-reviewer":  {"skill:security"},
			"workflow:pr-review":  {"agent:code-reviewer", "agent:sec-reviewer"},
		},
	}

	dot := result.GetDependencyGraphDot()
	
	// Should contain all resources
	if !containsString(dot, "\"skill:coding\"") {
		t.Error("expected skill:coding in diagram")
	}
	if !containsString(dot, "\"skill:security\"") {
		t.Error("expected skill:security in diagram")
	}
	if !containsString(dot, "\"agent:code-reviewer\"") {
		t.Error("expected agent:code-reviewer in diagram")
	}
	if !containsString(dot, "\"agent:sec-reviewer\"") {
		t.Error("expected agent:sec-reviewer in diagram")
	}
	if !containsString(dot, "\"workflow:pr-review\"") {
		t.Error("expected workflow:pr-review in diagram")
	}
}

func TestSanitizeMermaidID(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"skill:coding", "skill_coding"},
		{"agent:code-reviewer", "agent_code_reviewer"},
		{"workflow:pr-review", "workflow_pr_review"},
		{"test-name", "test_name"},
		{"normal", "normal"},
	}

	for _, tt := range tests {
		result := sanitizeMermaidID(tt.input)
		if result != tt.expected {
			t.Errorf("sanitizeMermaidID(%s) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestGetResourceType(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"skill:coding", "skill"},
		{"agent:reviewer", "agent"},
		{"workflow:pr-review", "workflow"},
		{"invalid", "unknown"},
		{"", "unknown"},
	}

	for _, tt := range tests {
		result := getResourceType(tt.input)
		if result != tt.expected {
			t.Errorf("getResourceType(%s) = %s, want %s", tt.input, result, tt.expected)
		}
	}
}

func TestGetNodeStyle(t *testing.T) {
	tests := []struct {
		input         string
		expectedShape string
		expectedColor string
	}{
		{"skill:coding", "box", "#e1f5e1"},
		{"agent:reviewer", "ellipse", "#e3f2fd"},
		{"workflow:pr-review", "hexagon", "#fff3e0"},
		{"unknown:test", "ellipse", "#f5f5f5"},
	}

	for _, tt := range tests {
		shape, color := getNodeStyle(tt.input)
		if shape != tt.expectedShape || color != tt.expectedColor {
			t.Errorf("getNodeStyle(%s) = (%s, %s), want (%s, %s)", 
				tt.input, shape, color, tt.expectedShape, tt.expectedColor)
		}
	}
}

// Helper function to check if string contains substring
func containsString(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || findSubstring(s, substr))
}

func findSubstring(s, substr string) bool {
	if len(substr) == 0 {
		return true
	}
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
