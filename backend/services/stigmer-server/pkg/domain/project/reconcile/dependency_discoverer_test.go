package reconcile

import (
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// =============================================================================
// Test Helpers
// =============================================================================

// skillRef creates an ApiResourceReference for a skill.
func skillRef(org, slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_skill,
		Slug: slug,
	}
}

// skillRefWithVersion creates an ApiResourceReference for a skill with version.
func skillRefWithVersion(org, slug, version string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:     org,
		Kind:    apiresourcekind.ApiResourceKind_skill,
		Slug:    slug,
		Version: version,
	}
}

// mcpServerRef creates an ApiResourceReference for an MCP server.
func mcpServerRef(org, slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:  org,
		Kind: apiresourcekind.ApiResourceKind_mcp_server,
		Slug: slug,
	}
}

// mcpUsage creates an McpServerUsage with the given reference.
func mcpUsage(org, slug string) *agentv1.McpServerUsage {
	return &agentv1.McpServerUsage{
		McpServerRef: mcpServerRef(org, slug),
	}
}

// createAgent creates a basic Agent with given name.
func createAgent(name string) *agentv1.Agent {
	return &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Test agent",
			Instructions: "You are a test agent.",
		},
	}
}

// createWorkflow creates a basic Workflow with given name.
func createWorkflow(name string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
		},
		Spec: &workflowv1.WorkflowSpec{
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test",
				Name:      name,
				Version:   "1.0.0",
			},
		},
	}
}

// createMcpServer creates a basic McpServer with given name.
func createMcpServer(name string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
		},
	}
}

// createSkill creates a basic Skill with given name.
func createSkill(name string) *skillv1.Skill {
	return &skillv1.Skill{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
		},
	}
}

// hasRef checks if a reference with the given kind and slug exists in the slice.
func hasRef(refs []*apiresource.ApiResourceReference, kind apiresourcekind.ApiResourceKind, slug string) bool {
	for _, ref := range refs {
		if ref.GetKind() == kind && ref.GetSlug() == slug {
			return true
		}
	}
	return false
}

// countByKind counts references of a specific kind.
func countByKind(refs []*apiresource.ApiResourceReference, kind apiresourcekind.ApiResourceKind) int {
	count := 0
	for _, ref := range refs {
		if ref.GetKind() == kind {
			count++
		}
	}
	return count
}

// =============================================================================
// Basic Functionality Tests
// =============================================================================

func TestDiscoverDependencies_NilResource(t *testing.T) {
	refs := DiscoverDependencies(nil)

	if refs == nil {
		t.Error("expected non-nil slice for nil resource")
	}
	if len(refs) != 0 {
		t.Errorf("expected empty slice, got %d references", len(refs))
	}
}

func TestDiscoverDependencies_ResourceWithNoReferences(t *testing.T) {
	agent := createAgent("simple-agent")

	refs := DiscoverDependencies(agent)

	if len(refs) != 0 {
		t.Errorf("expected empty slice for agent with no refs, got %d", len(refs))
	}
}

func TestDiscoverDependencies_ReturnsNewSliceEachCall(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			SkillRefs:    []*apiresource.ApiResourceReference{skillRef("stigmer", "web-search")},
		},
	}

	refs1 := DiscoverDependencies(agent)
	refs2 := DiscoverDependencies(agent)

	// Modify refs1 - should not affect refs2
	if len(refs1) > 0 {
		refs1[0] = nil
	}

	if len(refs2) != 1 || refs2[0] == nil {
		t.Error("expected independent slices on each call")
	}
}

// =============================================================================
// Agent Skill References Tests
// =============================================================================

func TestDiscoverDependencies_SingleSkillRef(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			SkillRefs:    []*apiresource.ApiResourceReference{skillRef("stigmer", "web-search")},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 1 {
		t.Fatalf("expected 1 reference, got %d", len(refs))
	}

	ref := refs[0]
	if ref.GetOrg() != "stigmer" {
		t.Errorf("expected org 'stigmer', got %q", ref.GetOrg())
	}
	if ref.GetSlug() != "web-search" {
		t.Errorf("expected slug 'web-search', got %q", ref.GetSlug())
	}
	if ref.GetKind() != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("expected kind skill, got %v", ref.GetKind())
	}
}

func TestDiscoverDependencies_MultipleSkillRefs(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			SkillRefs: []*apiresource.ApiResourceReference{
				skillRef("stigmer", "web-search"),
				skillRef("stigmer", "code-review"),
				skillRef("acme", "custom-skill"),
			},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 3 {
		t.Fatalf("expected 3 references, got %d", len(refs))
	}

	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "web-search") {
		t.Error("missing web-search reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "code-review") {
		t.Error("missing code-review reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "custom-skill") {
		t.Error("missing custom-skill reference")
	}
}

func TestDiscoverDependencies_DeduplicatesIdenticalRefs(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			SkillRefs: []*apiresource.ApiResourceReference{
				skillRef("stigmer", "web-search"),
				skillRef("stigmer", "web-search"), // Duplicate
			},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 1 {
		t.Errorf("expected 1 reference after deduplication, got %d", len(refs))
	}
}

// =============================================================================
// Agent MCP Server References Tests
// =============================================================================

func TestDiscoverDependencies_McpServerRefInUsage(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions:    "Test instructions",
			McpServerUsages: []*agentv1.McpServerUsage{mcpUsage("stigmer", "github")},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 1 {
		t.Fatalf("expected 1 reference, got %d", len(refs))
	}

	ref := refs[0]
	if ref.GetOrg() != "stigmer" {
		t.Errorf("expected org 'stigmer', got %q", ref.GetOrg())
	}
	if ref.GetSlug() != "github" {
		t.Errorf("expected slug 'github', got %q", ref.GetSlug())
	}
	if ref.GetKind() != apiresourcekind.ApiResourceKind_mcp_server {
		t.Errorf("expected kind mcp_server, got %v", ref.GetKind())
	}
}

func TestDiscoverDependencies_MultipleMcpServerRefs(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			McpServerUsages: []*agentv1.McpServerUsage{
				mcpUsage("stigmer", "github"),
				mcpUsage("stigmer", "slack"),
				mcpUsage("acme", "internal-api"),
			},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 3 {
		t.Fatalf("expected 3 references, got %d", len(refs))
	}

	if !hasRef(refs, apiresourcekind.ApiResourceKind_mcp_server, "github") {
		t.Error("missing github reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_mcp_server, "slack") {
		t.Error("missing slack reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_mcp_server, "internal-api") {
		t.Error("missing internal-api reference")
	}
}

// =============================================================================
// Mixed References Tests
// =============================================================================

func TestDiscoverDependencies_BothSkillAndMcpServerRefs(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			SkillRefs: []*apiresource.ApiResourceReference{
				skillRef("stigmer", "web-search"),
				skillRef("stigmer", "code-review"),
			},
			McpServerUsages: []*agentv1.McpServerUsage{
				mcpUsage("stigmer", "github"),
				mcpUsage("stigmer", "postgres"),
			},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 4 {
		t.Fatalf("expected 4 references, got %d", len(refs))
	}

	// Check skills
	skillCount := countByKind(refs, apiresourcekind.ApiResourceKind_skill)
	if skillCount != 2 {
		t.Errorf("expected 2 skill refs, got %d", skillCount)
	}

	// Check MCP servers
	mcpCount := countByKind(refs, apiresourcekind.ApiResourceKind_mcp_server)
	if mcpCount != 2 {
		t.Errorf("expected 2 mcp_server refs, got %d", mcpCount)
	}
}

// =============================================================================
// SubAgent References Tests
// =============================================================================

func TestDiscoverDependencies_SkillRefsInSubAgents(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Parent agent",
			SubAgents: []*agentv1.SubAgent{
				{
					Name:         "code-reviewer",
					Instructions: "Sub-agent instructions",
					SkillRefs:    []*apiresource.ApiResourceReference{skillRef("stigmer", "code-review-skill")},
				},
			},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 1 {
		t.Fatalf("expected 1 reference, got %d", len(refs))
	}

	if refs[0].GetSlug() != "code-review-skill" {
		t.Errorf("expected slug 'code-review-skill', got %q", refs[0].GetSlug())
	}
}

func TestDiscoverDependencies_RefsInMultipleSubAgents(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Parent agent",
			SubAgents: []*agentv1.SubAgent{
				{
					Name:         "sub1",
					Instructions: "Sub-agent 1",
					SkillRefs:    []*apiresource.ApiResourceReference{skillRef("stigmer", "skill-1")},
				},
				{
					Name:         "sub2",
					Instructions: "Sub-agent 2",
					SkillRefs: []*apiresource.ApiResourceReference{
						skillRef("stigmer", "skill-2"),
						skillRef("stigmer", "skill-3"),
					},
				},
			},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 3 {
		t.Fatalf("expected 3 references, got %d", len(refs))
	}

	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "skill-1") {
		t.Error("missing skill-1 reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "skill-2") {
		t.Error("missing skill-2 reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "skill-3") {
		t.Error("missing skill-3 reference")
	}
}

func TestDiscoverDependencies_RefsAtAllNestingLevels(t *testing.T) {
	// Agent with: top-level skills, MCP servers, and sub-agent skills
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions:    "Parent agent",
			SkillRefs:       []*apiresource.ApiResourceReference{skillRef("stigmer", "parent-skill")},
			McpServerUsages: []*agentv1.McpServerUsage{mcpUsage("stigmer", "parent-mcp")},
			SubAgents: []*agentv1.SubAgent{
				{
					Name:         "sub1",
					Instructions: "Sub-agent",
					SkillRefs:    []*apiresource.ApiResourceReference{skillRef("stigmer", "sub-skill")},
				},
			},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 3 {
		t.Fatalf("expected 3 references, got %d", len(refs))
	}

	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "parent-skill") {
		t.Error("missing parent-skill reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_mcp_server, "parent-mcp") {
		t.Error("missing parent-mcp reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "sub-skill") {
		t.Error("missing sub-skill reference")
	}
}

// =============================================================================
// Non-Agent Resources Tests
// =============================================================================

func TestDiscoverDependencies_WorkflowHasNoDependencies(t *testing.T) {
	workflow := createWorkflow("test-workflow")

	refs := DiscoverDependencies(workflow)

	if len(refs) != 0 {
		t.Errorf("expected 0 references for workflow, got %d", len(refs))
	}
}

func TestDiscoverDependencies_McpServerHasNoDependencies(t *testing.T) {
	mcpServer := createMcpServer("test-mcp")

	refs := DiscoverDependencies(mcpServer)

	if len(refs) != 0 {
		t.Errorf("expected 0 references for mcp_server, got %d", len(refs))
	}
}

func TestDiscoverDependencies_SkillHasNoDependencies(t *testing.T) {
	skill := createSkill("test-skill")

	refs := DiscoverDependencies(skill)

	if len(refs) != 0 {
		t.Errorf("expected 0 references for skill, got %d", len(refs))
	}
}

// =============================================================================
// Edge Cases Tests
// =============================================================================

func TestDiscoverDependencies_EmptyRepeatedFields(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions:    "Test instructions",
			SkillRefs:       []*apiresource.ApiResourceReference{}, // Empty
			McpServerUsages: []*agentv1.McpServerUsage{},           // Empty
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 0 {
		t.Errorf("expected 0 references for empty repeated fields, got %d", len(refs))
	}
}

func TestDiscoverDependencies_RefWithVersionField(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			SkillRefs:    []*apiresource.ApiResourceReference{skillRefWithVersion("stigmer", "versioned-skill", "v1.0.0")},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 1 {
		t.Fatalf("expected 1 reference, got %d", len(refs))
	}

	if refs[0].GetVersion() != "v1.0.0" {
		t.Errorf("expected version 'v1.0.0', got %q", refs[0].GetVersion())
	}
}

func TestDiscoverDependencies_RefWithEmptyOrg(t *testing.T) {
	// Empty org is valid - defaults to project's org during resolution
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			SkillRefs: []*apiresource.ApiResourceReference{
				{
					Org:  "", // Empty org
					Kind: apiresourcekind.ApiResourceKind_skill,
					Slug: "local-skill",
				},
			},
		},
	}

	refs := DiscoverDependencies(agent)

	if len(refs) != 1 {
		t.Fatalf("expected 1 reference with empty org, got %d", len(refs))
	}

	if refs[0].GetSlug() != "local-skill" {
		t.Errorf("expected slug 'local-skill', got %q", refs[0].GetSlug())
	}
}

func TestDiscoverDependencies_SkipsRefWithBlankSlug(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Test instructions",
			SkillRefs: []*apiresource.ApiResourceReference{
				{
					Org:  "stigmer",
					Kind: apiresourcekind.ApiResourceKind_skill,
					Slug: "", // Invalid - should be skipped
				},
				skillRef("stigmer", "valid-skill"),
			},
		},
	}

	refs := DiscoverDependencies(agent)

	// Only valid reference should be included
	if len(refs) != 1 {
		t.Fatalf("expected 1 reference after filtering invalid, got %d", len(refs))
	}

	if refs[0].GetSlug() != "valid-skill" {
		t.Errorf("expected slug 'valid-skill', got %q", refs[0].GetSlug())
	}
}

// =============================================================================
// Real-World Scenarios Tests
// =============================================================================

func TestDiscoverDependencies_ComplexAgent(t *testing.T) {
	// Complex agent with multiple MCP servers, skills, and sub-agents
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "engineering-assistant",
		},
		Spec: &agentv1.AgentSpec{
			Description:  "Engineering assistant with code review capabilities",
			Instructions: "You are an engineering assistant...",
			// MCP servers for parent
			McpServerUsages: []*agentv1.McpServerUsage{
				mcpUsage("stigmer", "github"),
				mcpUsage("stigmer", "slack"),
				mcpUsage("acme", "jira"),
			},
			// Skills for parent
			SkillRefs: []*apiresource.ApiResourceReference{
				skillRef("stigmer", "web-search"),
				skillRef("stigmer", "code-analysis"),
			},
			// Sub-agents with their own skills
			SubAgents: []*agentv1.SubAgent{
				{
					Name:         "code-reviewer",
					Instructions: "You review code changes...",
					SkillRefs: []*apiresource.ApiResourceReference{
						skillRef("stigmer", "code-review-best-practices"),
						skillRef("stigmer", "security-audit"),
					},
				},
				{
					Name:         "documentation-writer",
					Instructions: "You write documentation...",
					SkillRefs: []*apiresource.ApiResourceReference{
						skillRef("stigmer", "markdown-guide"),
					},
				},
			},
		},
	}

	refs := DiscoverDependencies(agent)

	// 3 MCP servers + 2 parent skills + 2 code-reviewer skills + 1 doc-writer skill = 8
	if len(refs) != 8 {
		t.Fatalf("expected 8 references, got %d", len(refs))
	}

	// Verify MCP servers
	mcpCount := countByKind(refs, apiresourcekind.ApiResourceKind_mcp_server)
	if mcpCount != 3 {
		t.Errorf("expected 3 mcp_server refs, got %d", mcpCount)
	}

	// Verify skills
	skillCount := countByKind(refs, apiresourcekind.ApiResourceKind_skill)
	if skillCount != 5 {
		t.Errorf("expected 5 skill refs, got %d", skillCount)
	}

	// Verify specific refs exist
	if !hasRef(refs, apiresourcekind.ApiResourceKind_mcp_server, "github") {
		t.Error("missing github reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "security-audit") {
		t.Error("missing security-audit reference")
	}
}

func TestDiscoverDependencies_OverlappingSubAgentSkills(t *testing.T) {
	// Two sub-agents referencing the same skill
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{Name: "test"},
		Spec: &agentv1.AgentSpec{
			Instructions: "Parent agent",
			SubAgents: []*agentv1.SubAgent{
				{
					Name:         "sub1",
					Instructions: "Sub-agent 1",
					SkillRefs: []*apiresource.ApiResourceReference{
						skillRef("stigmer", "shared-skill"),
						skillRef("stigmer", "unique-skill-1"),
					},
				},
				{
					Name:         "sub2",
					Instructions: "Sub-agent 2",
					SkillRefs: []*apiresource.ApiResourceReference{
						skillRef("stigmer", "shared-skill"), // Same as sub1
						skillRef("stigmer", "unique-skill-2"),
					},
				},
			},
		},
	}

	refs := DiscoverDependencies(agent)

	// Should deduplicate: shared-skill + unique-skill-1 + unique-skill-2 = 3
	if len(refs) != 3 {
		t.Fatalf("expected 3 references after deduplication, got %d", len(refs))
	}

	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "shared-skill") {
		t.Error("missing shared-skill reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "unique-skill-1") {
		t.Error("missing unique-skill-1 reference")
	}
	if !hasRef(refs, apiresourcekind.ApiResourceKind_skill, "unique-skill-2") {
		t.Error("missing unique-skill-2 reference")
	}
}

// =============================================================================
// ToResourceKey Tests
// =============================================================================

func TestToResourceKey_SkillRef(t *testing.T) {
	ref := skillRef("stigmer", "web-search")

	key, err := ToResourceKey(ref)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key.Kind() != apiresourcekind.ApiResourceKind_skill {
		t.Errorf("expected kind skill, got %v", key.Kind())
	}
	if key.Slug() != "web-search" {
		t.Errorf("expected slug 'web-search', got %q", key.Slug())
	}
	if key.String() != "skill:web-search" {
		t.Errorf("expected 'skill:web-search', got %q", key.String())
	}
}

func TestToResourceKey_McpServerRef(t *testing.T) {
	ref := mcpServerRef("stigmer", "github")

	key, err := ToResourceKey(ref)

	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if key.String() != "mcp_server:github" {
		t.Errorf("expected 'mcp_server:github', got %q", key.String())
	}
}

func TestToResourceKey_NilRef(t *testing.T) {
	key, err := ToResourceKey(nil)

	if err != nil {
		t.Fatalf("unexpected error for nil ref: %v", err)
	}
	if !key.IsZero() {
		t.Error("expected zero key for nil ref")
	}
}
