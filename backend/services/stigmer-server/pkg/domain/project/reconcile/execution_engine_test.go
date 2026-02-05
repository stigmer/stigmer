package reconcile

import (
	"context"
	"errors"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
)

// Test helpers are defined in desired_state_test.go and actual_state_test.go:
// - createTestAgent(name) *agentv1.Agent
// - createTestAgentWithID(name, id) *agentv1.Agent
// - createTestWorkflow(name) *workflowv1.Workflow
// - createTestWorkflowWithID(name, id) *workflowv1.Workflow
// - createTestMcpServer(name) *mcpserverv1.McpServer
// - createTestMcpServerWithID(name, id) *mcpserverv1.McpServer
// - createTestSkill(name) *skillv1.Skill
// - createTestSkillWithID(name, id) *skillv1.Skill

// =============================================================================
// Mock ResourceController for testing
// =============================================================================

type mockResourceController struct {
	// Track calls
	createAgentCalls     []*agentv1.Agent
	updateAgentCalls     []*agentv1.Agent
	deleteAgentCalls     []string
	createWorkflowCalls  []*workflowv1.Workflow
	updateWorkflowCalls  []*workflowv1.Workflow
	deleteWorkflowCalls  []string
	createMcpServerCalls []*mcpserverv1.McpServer
	updateMcpServerCalls []*mcpserverv1.McpServer
	deleteMcpServerCalls []string
	pushSkillCalls       []*skillv1.Skill
	deleteSkillCalls     []string

	// Configure responses
	createAgentResp     *agentv1.Agent
	createAgentErr      error
	updateAgentResp     *agentv1.Agent
	updateAgentErr      error
	deleteAgentErr      error
	createWorkflowResp  *workflowv1.Workflow
	createWorkflowErr   error
	updateWorkflowResp  *workflowv1.Workflow
	updateWorkflowErr   error
	deleteWorkflowErr   error
	createMcpServerResp *mcpserverv1.McpServer
	createMcpServerErr  error
	updateMcpServerResp *mcpserverv1.McpServer
	updateMcpServerErr  error
	deleteMcpServerErr  error
	pushSkillResp       *skillv1.Skill
	pushSkillErr        error
	deleteSkillErr      error
}

func newMockResourceController() *mockResourceController {
	return &mockResourceController{}
}

func (m *mockResourceController) CreateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	m.createAgentCalls = append(m.createAgentCalls, agent)
	if m.createAgentErr != nil {
		return nil, m.createAgentErr
	}
	if m.createAgentResp != nil {
		return m.createAgentResp, nil
	}
	// Return agent with ID set
	resp := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:          "created-agent-id",
			Name:        agent.GetMetadata().GetName(),
			Slug:        agent.GetMetadata().GetName(),
			Org:         agent.GetMetadata().GetOrg(),
			Annotations: agent.GetMetadata().GetAnnotations(),
		},
		Spec: agent.Spec,
	}
	return resp, nil
}

func (m *mockResourceController) UpdateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	m.updateAgentCalls = append(m.updateAgentCalls, agent)
	if m.updateAgentErr != nil {
		return nil, m.updateAgentErr
	}
	if m.updateAgentResp != nil {
		return m.updateAgentResp, nil
	}
	return agent, nil
}

func (m *mockResourceController) DeleteAgent(ctx context.Context, id string) error {
	m.deleteAgentCalls = append(m.deleteAgentCalls, id)
	return m.deleteAgentErr
}

func (m *mockResourceController) CreateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	m.createWorkflowCalls = append(m.createWorkflowCalls, workflow)
	if m.createWorkflowErr != nil {
		return nil, m.createWorkflowErr
	}
	if m.createWorkflowResp != nil {
		return m.createWorkflowResp, nil
	}
	resp := &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:          "created-workflow-id",
			Name:        workflow.GetMetadata().GetName(),
			Slug:        workflow.GetMetadata().GetName(),
			Org:         workflow.GetMetadata().GetOrg(),
			Annotations: workflow.GetMetadata().GetAnnotations(),
		},
		Spec: workflow.Spec,
	}
	return resp, nil
}

func (m *mockResourceController) UpdateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	m.updateWorkflowCalls = append(m.updateWorkflowCalls, workflow)
	if m.updateWorkflowErr != nil {
		return nil, m.updateWorkflowErr
	}
	if m.updateWorkflowResp != nil {
		return m.updateWorkflowResp, nil
	}
	return workflow, nil
}

func (m *mockResourceController) DeleteWorkflow(ctx context.Context, id string) error {
	m.deleteWorkflowCalls = append(m.deleteWorkflowCalls, id)
	return m.deleteWorkflowErr
}

func (m *mockResourceController) CreateMcpServer(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	m.createMcpServerCalls = append(m.createMcpServerCalls, server)
	if m.createMcpServerErr != nil {
		return nil, m.createMcpServerErr
	}
	if m.createMcpServerResp != nil {
		return m.createMcpServerResp, nil
	}
	resp := &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:          "created-mcpserver-id",
			Name:        server.GetMetadata().GetName(),
			Slug:        server.GetMetadata().GetName(),
			Org:         server.GetMetadata().GetOrg(),
			Annotations: server.GetMetadata().GetAnnotations(),
		},
		Spec: server.Spec,
	}
	return resp, nil
}

func (m *mockResourceController) UpdateMcpServer(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	m.updateMcpServerCalls = append(m.updateMcpServerCalls, server)
	if m.updateMcpServerErr != nil {
		return nil, m.updateMcpServerErr
	}
	if m.updateMcpServerResp != nil {
		return m.updateMcpServerResp, nil
	}
	return server, nil
}

func (m *mockResourceController) DeleteMcpServer(ctx context.Context, id string) error {
	m.deleteMcpServerCalls = append(m.deleteMcpServerCalls, id)
	return m.deleteMcpServerErr
}

func (m *mockResourceController) PushSkill(ctx context.Context, skill *skillv1.Skill) (*skillv1.Skill, error) {
	m.pushSkillCalls = append(m.pushSkillCalls, skill)
	if m.pushSkillErr != nil {
		return nil, m.pushSkillErr
	}
	if m.pushSkillResp != nil {
		return m.pushSkillResp, nil
	}
	resp := &skillv1.Skill{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:          "pushed-skill-id",
			Name:        skill.GetMetadata().GetName(),
			Slug:        skill.GetMetadata().GetName(),
			Org:         skill.GetMetadata().GetOrg(),
			Annotations: skill.GetMetadata().GetAnnotations(),
		},
		Spec: skill.Spec,
	}
	return resp, nil
}

func (m *mockResourceController) DeleteSkill(ctx context.Context, id string) error {
	m.deleteSkillCalls = append(m.deleteSkillCalls, id)
	return m.deleteSkillErr
}

// =============================================================================
// ExecutePlan Tests
// =============================================================================

func TestExecutePlan_NilPlan(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	result := engine.ExecutePlan(context.Background(), nil, "project-id", "test-org")

	if result.TotalChanges() != 0 || result.HasErrors() {
		t.Error("Expected empty result for nil plan")
	}
}

func TestExecutePlan_EmptyPlan(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	plan := EmptyPlan()

	result := engine.ExecutePlan(context.Background(), plan, "project-id", "test-org")

	if result.TotalChanges() != 0 || result.HasErrors() {
		t.Error("Expected empty result for empty plan")
	}
}

func TestExecutePlan_CreateAgent(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	agent := createTestAgent("my-agent")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	change := NewCreateChange(key, agent)

	plan := NewReconciliationPlan([]ResourceChange{change}, nil, nil)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	// Verify agent was created
	if len(mock.createAgentCalls) != 1 {
		t.Fatalf("Expected 1 create agent call, got %d", len(mock.createAgentCalls))
	}

	// Verify org was set
	createdAgent := mock.createAgentCalls[0]
	if createdAgent.GetMetadata().GetOrg() != "test-org" {
		t.Errorf("Expected org 'test-org', got '%s'", createdAgent.GetMetadata().GetOrg())
	}

	// Verify ownership annotation was set
	if createdAgent.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation] != "project-123" {
		t.Errorf("Expected ownership annotation 'project-123', got '%s'",
			createdAgent.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation])
	}

	// Verify result
	if len(result.Created()) != 1 {
		t.Errorf("Expected 1 created record, got %d", len(result.Created()))
	}
	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}
}

func TestExecutePlan_CreateWorkflow(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	workflow := createTestWorkflow("my-workflow")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "my-workflow")
	change := NewCreateChange(key, workflow)

	plan := NewReconciliationPlan([]ResourceChange{change}, nil, nil)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.createWorkflowCalls) != 1 {
		t.Fatalf("Expected 1 create workflow call, got %d", len(mock.createWorkflowCalls))
	}

	if len(result.Created()) != 1 {
		t.Errorf("Expected 1 created record, got %d", len(result.Created()))
	}
}

func TestExecutePlan_CreateMcpServer(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	server := createTestMcpServer("my-server")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "my-server")
	change := NewCreateChange(key, server)

	plan := NewReconciliationPlan([]ResourceChange{change}, nil, nil)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.createMcpServerCalls) != 1 {
		t.Fatalf("Expected 1 create mcp server call, got %d", len(mock.createMcpServerCalls))
	}

	if len(result.Created()) != 1 {
		t.Errorf("Expected 1 created record, got %d", len(result.Created()))
	}
}

func TestExecutePlan_CreateSkill(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	skill := createTestSkill("my-skill")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "my-skill")
	change := NewCreateChange(key, skill)

	plan := NewReconciliationPlan([]ResourceChange{change}, nil, nil)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.pushSkillCalls) != 1 {
		t.Fatalf("Expected 1 push skill call, got %d", len(mock.pushSkillCalls))
	}

	if len(result.Created()) != 1 {
		t.Errorf("Expected 1 created record, got %d", len(result.Created()))
	}
}

func TestExecutePlan_UpdateAgent(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	actualAgent := createTestAgentWithID("my-agent", "agent-id-123")
	desiredAgent := createTestAgent("my-agent")
	desiredAgent.Spec.Description = "Updated Agent Description"

	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	change := NewUpdateChange(key, desiredAgent, actualAgent)

	plan := NewReconciliationPlan(nil, []ResourceChange{change}, nil)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.updateAgentCalls) != 1 {
		t.Fatalf("Expected 1 update agent call, got %d", len(mock.updateAgentCalls))
	}

	// Verify ID was preserved from actual state
	updatedAgent := mock.updateAgentCalls[0]
	if updatedAgent.GetMetadata().GetId() != "agent-id-123" {
		t.Errorf("Expected ID 'agent-id-123', got '%s'", updatedAgent.GetMetadata().GetId())
	}

	// Verify spec was from desired state
	if updatedAgent.Spec.Description != "Updated Agent Description" {
		t.Errorf("Expected description 'Updated Agent Description', got '%s'", updatedAgent.Spec.Description)
	}

	// Verify ownership annotation was set
	if updatedAgent.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation] != "project-123" {
		t.Errorf("Expected ownership annotation 'project-123', got '%s'",
			updatedAgent.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation])
	}

	if len(result.Updated()) != 1 {
		t.Errorf("Expected 1 updated record, got %d", len(result.Updated()))
	}
}

func TestExecutePlan_DeleteAgent(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	actualAgent := createTestAgentWithID("my-agent", "agent-id-123")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	change := NewDeleteChange(key, actualAgent)

	plan := NewReconciliationPlan(nil, nil, []ResourceChange{change})

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.deleteAgentCalls) != 1 {
		t.Fatalf("Expected 1 delete agent call, got %d", len(mock.deleteAgentCalls))
	}

	if mock.deleteAgentCalls[0] != "agent-id-123" {
		t.Errorf("Expected delete with ID 'agent-id-123', got '%s'", mock.deleteAgentCalls[0])
	}

	if len(result.Deleted()) != 1 {
		t.Errorf("Expected 1 deleted record, got %d", len(result.Deleted()))
	}
}

func TestExecutePlan_DeleteWorkflow(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	actualWorkflow := createTestWorkflowWithID("my-workflow", "workflow-id-123")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "my-workflow")
	change := NewDeleteChange(key, actualWorkflow)

	plan := NewReconciliationPlan(nil, nil, []ResourceChange{change})

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.deleteWorkflowCalls) != 1 {
		t.Fatalf("Expected 1 delete workflow call, got %d", len(mock.deleteWorkflowCalls))
	}

	if len(result.Deleted()) != 1 {
		t.Errorf("Expected 1 deleted record, got %d", len(result.Deleted()))
	}
}

func TestExecutePlan_DeleteMcpServer(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	actualServer := createTestMcpServerWithID("my-server", "server-id-123")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "my-server")
	change := NewDeleteChange(key, actualServer)

	plan := NewReconciliationPlan(nil, nil, []ResourceChange{change})

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.deleteMcpServerCalls) != 1 {
		t.Fatalf("Expected 1 delete mcp server call, got %d", len(mock.deleteMcpServerCalls))
	}

	if len(result.Deleted()) != 1 {
		t.Errorf("Expected 1 deleted record, got %d", len(result.Deleted()))
	}
}

func TestExecutePlan_DeleteSkill(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	actualSkill := createTestSkillWithID("my-skill", "skill-id-123")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "my-skill")
	change := NewDeleteChange(key, actualSkill)

	plan := NewReconciliationPlan(nil, nil, []ResourceChange{change})

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.deleteSkillCalls) != 1 {
		t.Fatalf("Expected 1 delete skill call, got %d", len(mock.deleteSkillCalls))
	}

	if len(result.Deleted()) != 1 {
		t.Errorf("Expected 1 deleted record, got %d", len(result.Deleted()))
	}
}

func TestExecutePlan_MixedOperations(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	// Create: new agent
	newAgent := createTestAgent("new-agent")
	createKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "new-agent")
	createChange := NewCreateChange(createKey, newAgent)

	// Update: existing workflow
	actualWorkflow := createTestWorkflowWithID("existing-workflow", "workflow-id")
	desiredWorkflow := createTestWorkflow("existing-workflow")
	updateKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "existing-workflow")
	updateChange := NewUpdateChange(updateKey, desiredWorkflow, actualWorkflow)

	// Delete: old mcp server
	actualServer := createTestMcpServerWithID("old-server", "server-id")
	deleteKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "old-server")
	deleteChange := NewDeleteChange(deleteKey, actualServer)

	plan := NewReconciliationPlan(
		[]ResourceChange{createChange},
		[]ResourceChange{updateChange},
		[]ResourceChange{deleteChange},
	)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(mock.createAgentCalls) != 1 {
		t.Errorf("Expected 1 create agent call, got %d", len(mock.createAgentCalls))
	}
	if len(mock.updateWorkflowCalls) != 1 {
		t.Errorf("Expected 1 update workflow call, got %d", len(mock.updateWorkflowCalls))
	}
	if len(mock.deleteMcpServerCalls) != 1 {
		t.Errorf("Expected 1 delete mcp server call, got %d", len(mock.deleteMcpServerCalls))
	}

	if len(result.Created()) != 1 {
		t.Errorf("Expected 1 created, got %d", len(result.Created()))
	}
	if len(result.Updated()) != 1 {
		t.Errorf("Expected 1 updated, got %d", len(result.Updated()))
	}
	if len(result.Deleted()) != 1 {
		t.Errorf("Expected 1 deleted, got %d", len(result.Deleted()))
	}
}

// =============================================================================
// Partial Failure Tests
// =============================================================================

func TestExecutePlan_PartialFailure_CreateFails(t *testing.T) {
	mock := newMockResourceController()
	mock.createAgentErr = errors.New("agent creation failed")
	engine := NewExecutionEngine(mock)

	// Two creates: first will fail, second should still execute
	agent1 := createTestAgent("agent1")
	key1 := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	change1 := NewCreateChange(key1, agent1)

	workflow := createTestWorkflow("workflow1")
	key2 := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "workflow1")
	change2 := NewCreateChange(key2, workflow)

	plan := NewReconciliationPlan([]ResourceChange{change1, change2}, nil, nil)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	// Agent creation failed
	if len(mock.createAgentCalls) != 1 {
		t.Errorf("Expected 1 create agent call, got %d", len(mock.createAgentCalls))
	}

	// Workflow creation should still succeed
	if len(mock.createWorkflowCalls) != 1 {
		t.Errorf("Expected 1 create workflow call, got %d", len(mock.createWorkflowCalls))
	}

	// Result should have 1 error and 1 success
	if !result.HasErrors() {
		t.Error("Expected errors in result")
	}
	if len(result.Errors()) != 1 {
		t.Errorf("Expected 1 error, got %d", len(result.Errors()))
	}
	if len(result.Created()) != 1 {
		t.Errorf("Expected 1 created, got %d", len(result.Created()))
	}
}

func TestExecutePlan_PartialFailure_UpdateFails(t *testing.T) {
	mock := newMockResourceController()
	mock.updateAgentErr = errors.New("agent update failed")
	engine := NewExecutionEngine(mock)

	actualAgent := createTestAgentWithID("agent1", "agent-id")
	desiredAgent := createTestAgent("agent1")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	change := NewUpdateChange(key, desiredAgent, actualAgent)

	plan := NewReconciliationPlan(nil, []ResourceChange{change}, nil)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if !result.HasErrors() {
		t.Error("Expected errors in result")
	}
	if len(result.Updated()) != 0 {
		t.Errorf("Expected 0 updated, got %d", len(result.Updated()))
	}
}

func TestExecutePlan_PartialFailure_DeleteFails(t *testing.T) {
	mock := newMockResourceController()
	mock.deleteAgentErr = errors.New("agent deletion failed")
	engine := NewExecutionEngine(mock)

	actualAgent := createTestAgentWithID("agent1", "agent-id")
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	change := NewDeleteChange(key, actualAgent)

	plan := NewReconciliationPlan(nil, nil, []ResourceChange{change})

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if !result.HasErrors() {
		t.Error("Expected errors in result")
	}
	if len(result.Deleted()) != 0 {
		t.Errorf("Expected 0 deleted, got %d", len(result.Deleted()))
	}
}

func TestExecutePlan_MultipleFailures(t *testing.T) {
	mock := newMockResourceController()
	mock.createAgentErr = errors.New("agent creation failed")
	mock.createWorkflowErr = errors.New("workflow creation failed")
	engine := NewExecutionEngine(mock)

	agent := createTestAgent("agent1")
	key1 := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	change1 := NewCreateChange(key1, agent)

	workflow := createTestWorkflow("workflow1")
	key2 := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "workflow1")
	change2 := NewCreateChange(key2, workflow)

	plan := NewReconciliationPlan([]ResourceChange{change1, change2}, nil, nil)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(result.Errors()) != 2 {
		t.Errorf("Expected 2 errors, got %d", len(result.Errors()))
	}
	if len(result.Created()) != 0 {
		t.Errorf("Expected 0 created, got %d", len(result.Created()))
	}
}

// =============================================================================
// prepareForCreate Tests
// =============================================================================

func TestPrepareForCreate_SetsOrgAndAnnotation(t *testing.T) {
	engine := NewExecutionEngine(nil)

	agent := createTestAgent("test-agent")
	prepared, err := engine.prepareForCreate(agent, "project-123", "my-org")

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	preparedAgent := prepared.(*agentv1.Agent)

	// Verify org was set
	if preparedAgent.GetMetadata().GetOrg() != "my-org" {
		t.Errorf("Expected org 'my-org', got '%s'", preparedAgent.GetMetadata().GetOrg())
	}

	// Verify annotation was set
	if preparedAgent.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation] != "project-123" {
		t.Errorf("Expected annotation 'project-123', got '%s'",
			preparedAgent.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation])
	}
}

func TestPrepareForCreate_DoesNotMutateOriginal(t *testing.T) {
	engine := NewExecutionEngine(nil)

	original := createTestAgent("test-agent")
	originalOrg := original.GetMetadata().GetOrg()

	_, err := engine.prepareForCreate(original, "project-123", "my-org")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Original should be unchanged
	if original.GetMetadata().GetOrg() != originalOrg {
		t.Error("Original agent was mutated")
	}
	if original.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation] != "" {
		t.Error("Original agent annotations were mutated")
	}
}

// =============================================================================
// prepareForUpdate Tests
// =============================================================================

func TestPrepareForUpdate_PreservesImmutableFields(t *testing.T) {
	engine := NewExecutionEngine(nil)

	actual := createTestAgentWithID("my-agent", "original-id")
	actual.GetMetadata().Slug = "original-slug"
	actual.GetMetadata().Org = "original-org"

	desired := createTestAgent("my-agent")
	desired.Spec.Description = "New Description"

	prepared, err := engine.prepareForUpdate(desired, actual, "project-123")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	preparedAgent := prepared.(*agentv1.Agent)

	// Verify immutable fields were preserved
	if preparedAgent.GetMetadata().GetId() != "original-id" {
		t.Errorf("Expected ID 'original-id', got '%s'", preparedAgent.GetMetadata().GetId())
	}
	if preparedAgent.GetMetadata().GetSlug() != "original-slug" {
		t.Errorf("Expected slug 'original-slug', got '%s'", preparedAgent.GetMetadata().GetSlug())
	}
	if preparedAgent.GetMetadata().GetOrg() != "original-org" {
		t.Errorf("Expected org 'original-org', got '%s'", preparedAgent.GetMetadata().GetOrg())
	}

	// Verify spec was from desired
	if preparedAgent.Spec.Description != "New Description" {
		t.Errorf("Expected description 'New Description', got '%s'", preparedAgent.Spec.Description)
	}
}

func TestPrepareForUpdate_SetsOwnershipAnnotation(t *testing.T) {
	engine := NewExecutionEngine(nil)

	actual := createTestAgentWithID("my-agent", "agent-id")
	desired := createTestAgent("my-agent")

	prepared, err := engine.prepareForUpdate(desired, actual, "project-123")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	preparedAgent := prepared.(*agentv1.Agent)

	if preparedAgent.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation] != "project-123" {
		t.Errorf("Expected annotation 'project-123', got '%s'",
			preparedAgent.GetMetadata().GetAnnotations()[ProjectOwnershipAnnotation])
	}
}

func TestPrepareForUpdate_DoesNotMutateOriginal(t *testing.T) {
	engine := NewExecutionEngine(nil)

	actual := createTestAgentWithID("my-agent", "agent-id")
	desired := createTestAgent("my-agent")
	originalName := desired.GetMetadata().GetName()

	_, err := engine.prepareForUpdate(desired, actual, "project-123")
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	// Original desired should be unchanged
	if desired.GetMetadata().GetName() != originalName {
		t.Error("Original desired agent was mutated")
	}
	if desired.GetMetadata().GetId() != "" {
		t.Error("Original desired agent ID was mutated")
	}
}

// =============================================================================
// extractResourceID Tests
// =============================================================================

func TestExtractResourceID_ValidResource(t *testing.T) {
	agent := createTestAgentWithID("my-agent", "test-id-123")

	id, err := extractResourceID(agent)

	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}
	if id != "test-id-123" {
		t.Errorf("Expected 'test-id-123', got '%s'", id)
	}
}

func TestExtractResourceID_NilResource(t *testing.T) {
	_, err := extractResourceID(nil)

	if err == nil {
		t.Error("Expected error for nil resource")
	}
}

func TestExtractResourceID_NilMetadata(t *testing.T) {
	agent := &agentv1.Agent{Metadata: nil}

	_, err := extractResourceID(agent)

	if err == nil {
		t.Error("Expected error for nil metadata")
	}
}

func TestExtractResourceID_EmptyID(t *testing.T) {
	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Id: "",
		},
	}

	_, err := extractResourceID(agent)

	if err == nil {
		t.Error("Expected error for empty ID")
	}
}

// =============================================================================
// buildChangeRecord Tests
// =============================================================================

func TestBuildChangeRecord(t *testing.T) {
	engine := NewExecutionEngine(nil)

	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "my-agent")
	result := createTestAgentWithID("my-agent", "result-id")

	record := engine.buildChangeRecord(key, result)

	if record.Kind != apiresourcekind.ApiResourceKind_agent {
		t.Errorf("Expected kind 'agent', got '%v'", record.Kind)
	}
	if record.Slug != "my-agent" {
		t.Errorf("Expected slug 'my-agent', got '%s'", record.Slug)
	}
	if record.ResourceId != "result-id" {
		t.Errorf("Expected resource ID 'result-id', got '%s'", record.ResourceId)
	}
}

func TestBuildChangeRecordWithID(t *testing.T) {
	engine := NewExecutionEngine(nil)

	key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "my-workflow")

	record := engine.buildChangeRecordWithID(key, "explicit-id")

	if record.Kind != apiresourcekind.ApiResourceKind_workflow {
		t.Errorf("Expected kind 'workflow', got '%v'", record.Kind)
	}
	if record.Slug != "my-workflow" {
		t.Errorf("Expected slug 'my-workflow', got '%s'", record.Slug)
	}
	if record.ResourceId != "explicit-id" {
		t.Errorf("Expected resource ID 'explicit-id', got '%s'", record.ResourceId)
	}
}

// =============================================================================
// Unsupported Kind Tests
// =============================================================================

func TestCreateResource_UnsupportedKind(t *testing.T) {
	engine := NewExecutionEngine(nil)

	// Use an unsupported kind (project kind is not supported for create via execution engine)
	_, err := engine.createResource(context.Background(), apiresourcekind.ApiResourceKind_project, nil)

	if err == nil {
		t.Error("Expected error for unsupported kind")
	}
}

func TestUpdateResource_UnsupportedKind(t *testing.T) {
	engine := NewExecutionEngine(nil)

	_, err := engine.updateResource(context.Background(), apiresourcekind.ApiResourceKind_project, nil)

	if err == nil {
		t.Error("Expected error for unsupported kind")
	}
}

func TestDeleteResource_UnsupportedKind(t *testing.T) {
	engine := NewExecutionEngine(nil)

	err := engine.deleteResource(context.Background(), apiresourcekind.ApiResourceKind_project, "some-id")

	if err == nil {
		t.Error("Expected error for unsupported kind")
	}
}

// =============================================================================
// ResourceControllerAdapter Tests
// =============================================================================

type mockAgentClient struct {
	createCalled bool
	updateCalled bool
	deleteCalled bool
}

func (m *mockAgentClient) Create(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	m.createCalled = true
	return agent, nil
}

func (m *mockAgentClient) Update(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	m.updateCalled = true
	return agent, nil
}

func (m *mockAgentClient) Delete(ctx context.Context, id string) (*agentv1.Agent, error) {
	m.deleteCalled = true
	return &agentv1.Agent{}, nil
}

type mockWorkflowClient struct {
	createCalled bool
	updateCalled bool
	deleteCalled bool
}

func (m *mockWorkflowClient) Create(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	m.createCalled = true
	return workflow, nil
}

func (m *mockWorkflowClient) Update(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	m.updateCalled = true
	return workflow, nil
}

func (m *mockWorkflowClient) Delete(ctx context.Context, id string) (*workflowv1.Workflow, error) {
	m.deleteCalled = true
	return &workflowv1.Workflow{}, nil
}

type mockMcpServerClient struct {
	createCalled bool
	updateCalled bool
	deleteCalled bool
}

func (m *mockMcpServerClient) Create(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	m.createCalled = true
	return server, nil
}

func (m *mockMcpServerClient) Update(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	m.updateCalled = true
	return server, nil
}

func (m *mockMcpServerClient) Delete(ctx context.Context, id string) (*mcpserverv1.McpServer, error) {
	m.deleteCalled = true
	return &mcpserverv1.McpServer{}, nil
}

type mockSkillClient struct {
	pushCalled   bool
	deleteCalled bool
}

func (m *mockSkillClient) Push(ctx context.Context, req *skillv1.PushSkillRequest) (*skillv1.Skill, error) {
	m.pushCalled = true
	return &skillv1.Skill{}, nil
}

func (m *mockSkillClient) Delete(ctx context.Context, id string) (*skillv1.Skill, error) {
	m.deleteCalled = true
	return &skillv1.Skill{}, nil
}

func TestResourceControllerAdapter_DelegatesAgentOps(t *testing.T) {
	agentClient := &mockAgentClient{}
	adapter := NewResourceControllerAdapter(&DownstreamClients{
		AgentClient: agentClient,
	})

	ctx := context.Background()
	agent := createTestAgent("test")

	adapter.CreateAgent(ctx, agent)
	if !agentClient.createCalled {
		t.Error("CreateAgent did not delegate to client")
	}

	adapter.UpdateAgent(ctx, agent)
	if !agentClient.updateCalled {
		t.Error("UpdateAgent did not delegate to client")
	}

	adapter.DeleteAgent(ctx, "id")
	if !agentClient.deleteCalled {
		t.Error("DeleteAgent did not delegate to client")
	}
}

func TestResourceControllerAdapter_DelegatesWorkflowOps(t *testing.T) {
	workflowClient := &mockWorkflowClient{}
	adapter := NewResourceControllerAdapter(&DownstreamClients{
		WorkflowClient: workflowClient,
	})

	ctx := context.Background()
	workflow := createTestWorkflow("test")

	adapter.CreateWorkflow(ctx, workflow)
	if !workflowClient.createCalled {
		t.Error("CreateWorkflow did not delegate to client")
	}

	adapter.UpdateWorkflow(ctx, workflow)
	if !workflowClient.updateCalled {
		t.Error("UpdateWorkflow did not delegate to client")
	}

	adapter.DeleteWorkflow(ctx, "id")
	if !workflowClient.deleteCalled {
		t.Error("DeleteWorkflow did not delegate to client")
	}
}

func TestResourceControllerAdapter_DelegatesMcpServerOps(t *testing.T) {
	mcpClient := &mockMcpServerClient{}
	adapter := NewResourceControllerAdapter(&DownstreamClients{
		McpServerClient: mcpClient,
	})

	ctx := context.Background()
	server := createTestMcpServer("test")

	adapter.CreateMcpServer(ctx, server)
	if !mcpClient.createCalled {
		t.Error("CreateMcpServer did not delegate to client")
	}

	adapter.UpdateMcpServer(ctx, server)
	if !mcpClient.updateCalled {
		t.Error("UpdateMcpServer did not delegate to client")
	}

	adapter.DeleteMcpServer(ctx, "id")
	if !mcpClient.deleteCalled {
		t.Error("DeleteMcpServer did not delegate to client")
	}
}

func TestResourceControllerAdapter_DelegatesSkillOps(t *testing.T) {
	skillClient := &mockSkillClient{}
	adapter := NewResourceControllerAdapter(&DownstreamClients{
		SkillClient: skillClient,
	})

	ctx := context.Background()

	// PushSkill should return error (not delegate) because skills
	// cannot be created via project reconciliation
	_, err := adapter.PushSkill(ctx, createTestSkill("test"))
	if err == nil {
		t.Error("PushSkill should return error for project reconciliation")
	}

	adapter.DeleteSkill(ctx, "id")
	if !skillClient.deleteCalled {
		t.Error("DeleteSkill did not delegate to client")
	}
}

// =============================================================================
// GetProjectOrg Tests
// =============================================================================

func TestGetProjectOrg_ValidProject(t *testing.T) {
	agent := createTestAgentWithID("agent", "id")
	agent.GetMetadata().Org = "my-org"

	org := GetProjectOrg(agent)

	if org != "my-org" {
		t.Errorf("Expected 'my-org', got '%s'", org)
	}
}

func TestGetProjectOrg_NilMetadata(t *testing.T) {
	agent := &agentv1.Agent{Metadata: nil}

	org := GetProjectOrg(agent)

	if org != "" {
		t.Errorf("Expected empty string, got '%s'", org)
	}
}

// =============================================================================
// Result Counting Tests
// =============================================================================

func TestExecutePlan_ResultCountsCorrect(t *testing.T) {
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	// 2 creates
	agent1 := createTestAgent("agent1")
	agent2 := createTestAgent("agent2")
	key1 := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	key2 := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent2")
	create1 := NewCreateChange(key1, agent1)
	create2 := NewCreateChange(key2, agent2)

	// 1 update
	actual := createTestWorkflowWithID("workflow1", "wf-id")
	desired := createTestWorkflow("workflow1")
	updateKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "workflow1")
	update := NewUpdateChange(updateKey, desired, actual)

	// 3 deletes
	del1 := createTestMcpServerWithID("server1", "s1")
	del2 := createTestMcpServerWithID("server2", "s2")
	del3 := createTestMcpServerWithID("server3", "s3")
	delKey1 := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "server1")
	delKey2 := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "server2")
	delKey3 := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "server3")
	delete1 := NewDeleteChange(delKey1, del1)
	delete2 := NewDeleteChange(delKey2, del2)
	delete3 := NewDeleteChange(delKey3, del3)

	plan := NewReconciliationPlan(
		[]ResourceChange{create1, create2},
		[]ResourceChange{update},
		[]ResourceChange{delete1, delete2, delete3},
	)

	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if len(result.Created()) != 2 {
		t.Errorf("Expected 2 created, got %d", len(result.Created()))
	}
	if len(result.Updated()) != 1 {
		t.Errorf("Expected 1 updated, got %d", len(result.Updated()))
	}
	if len(result.Deleted()) != 3 {
		t.Errorf("Expected 3 deleted, got %d", len(result.Deleted()))
	}
	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}
}
