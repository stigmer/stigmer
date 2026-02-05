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

// orderedOperation tracks a single operation with its sequence number.
// Used to verify that operations execute in the correct dependency order.
type orderedOperation struct {
	operation string      // "createAgent", "updateAgent", "deleteWorkflow", etc.
	key       ResourceKey // The resource being operated on
	index     int         // Sequence number (0-based)
}

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

	// Order tracking for E3 topological execution tests
	operationLog []orderedOperation
	opIndex      int
	// idToKey maps resource IDs to ResourceKeys for delete order tracking.
	// Tests set this up based on the delete changes they create.
	idToKey map[string]ResourceKey

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
	return &mockResourceController{
		operationLog: make([]orderedOperation, 0),
		idToKey:      make(map[string]ResourceKey),
	}
}

// registerDeleteKey registers an ID-to-key mapping for delete order tracking.
func (m *mockResourceController) registerDeleteKey(id string, key ResourceKey) {
	m.idToKey[id] = key
}

// logOperation records an operation with its sequence number.
func (m *mockResourceController) logOperation(operation string, key ResourceKey) {
	m.operationLog = append(m.operationLog, orderedOperation{
		operation: operation,
		key:       key,
		index:     m.opIndex,
	})
	m.opIndex++
}

// getOperationIndex returns the sequence number for a given resource key.
// Returns -1 if the key was not found in the operation log.
func (m *mockResourceController) getOperationIndex(key ResourceKey) int {
	for _, op := range m.operationLog {
		if op.key == key {
			return op.index
		}
	}
	return -1
}

// assertCreatedBefore verifies that dep was created before dependent.
// Returns true if the ordering is correct, false otherwise.
func (m *mockResourceController) assertCreatedBefore(t *testing.T, dep, dependent ResourceKey) {
	t.Helper()
	depIdx := m.getOperationIndex(dep)
	dependentIdx := m.getOperationIndex(dependent)

	if depIdx == -1 {
		t.Errorf("dependency %s was not found in operation log", dep)
		return
	}
	if dependentIdx == -1 {
		t.Errorf("dependent %s was not found in operation log", dependent)
		return
	}
	if depIdx >= dependentIdx {
		t.Errorf("%s should be created before %s: %s=%d, %s=%d",
			dep, dependent, dep, depIdx, dependent, dependentIdx)
	}
}

// assertDeletedBefore verifies that dependent was deleted before dep.
// Returns true if the ordering is correct, false otherwise.
func (m *mockResourceController) assertDeletedBefore(t *testing.T, dependent, dep ResourceKey) {
	t.Helper()
	dependentIdx := m.getOperationIndex(dependent)
	depIdx := m.getOperationIndex(dep)

	if dependentIdx == -1 {
		t.Errorf("dependent %s was not found in operation log", dependent)
		return
	}
	if depIdx == -1 {
		t.Errorf("dependency %s was not found in operation log", dep)
		return
	}
	if dependentIdx >= depIdx {
		t.Errorf("%s should be deleted before %s: %s=%d, %s=%d",
			dependent, dep, dependent, dependentIdx, dep, depIdx)
	}
}

func (m *mockResourceController) CreateAgent(ctx context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	m.createAgentCalls = append(m.createAgentCalls, agent)
	// Log operation for order tracking
	slug := agent.GetMetadata().GetSlug()
	if slug == "" {
		slug = agent.GetMetadata().GetName()
	}
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, slug)
	m.logOperation("createAgent", key)

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
	// Log operation for order tracking
	slug := agent.GetMetadata().GetSlug()
	if slug == "" {
		slug = agent.GetMetadata().GetName()
	}
	key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, slug)
	m.logOperation("updateAgent", key)

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
	// Log operation for order tracking using pre-registered ID-to-key mapping
	if key, ok := m.idToKey[id]; ok {
		m.logOperation("deleteAgent", key)
	}
	return m.deleteAgentErr
}

func (m *mockResourceController) CreateWorkflow(ctx context.Context, workflow *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	m.createWorkflowCalls = append(m.createWorkflowCalls, workflow)
	// Log operation for order tracking
	slug := workflow.GetMetadata().GetSlug()
	if slug == "" {
		slug = workflow.GetMetadata().GetName()
	}
	key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, slug)
	m.logOperation("createWorkflow", key)

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
	// Log operation for order tracking
	slug := workflow.GetMetadata().GetSlug()
	if slug == "" {
		slug = workflow.GetMetadata().GetName()
	}
	key := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, slug)
	m.logOperation("updateWorkflow", key)

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
	// Log operation for order tracking using pre-registered ID-to-key mapping
	if key, ok := m.idToKey[id]; ok {
		m.logOperation("deleteWorkflow", key)
	}
	return m.deleteWorkflowErr
}

func (m *mockResourceController) CreateMcpServer(ctx context.Context, server *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	m.createMcpServerCalls = append(m.createMcpServerCalls, server)
	// Log operation for order tracking
	slug := server.GetMetadata().GetSlug()
	if slug == "" {
		slug = server.GetMetadata().GetName()
	}
	key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, slug)
	m.logOperation("createMcpServer", key)

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
	// Log operation for order tracking
	slug := server.GetMetadata().GetSlug()
	if slug == "" {
		slug = server.GetMetadata().GetName()
	}
	key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, slug)
	m.logOperation("updateMcpServer", key)

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
	// Log operation for order tracking using pre-registered ID-to-key mapping
	if key, ok := m.idToKey[id]; ok {
		m.logOperation("deleteMcpServer", key)
	}
	return m.deleteMcpServerErr
}

func (m *mockResourceController) PushSkill(ctx context.Context, skill *skillv1.Skill) (*skillv1.Skill, error) {
	m.pushSkillCalls = append(m.pushSkillCalls, skill)
	// Log operation for order tracking
	slug := skill.GetMetadata().GetSlug()
	if slug == "" {
		slug = skill.GetMetadata().GetName()
	}
	key := MustResourceKey(apiresourcekind.ApiResourceKind_skill, slug)
	m.logOperation("pushSkill", key)

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
	// Log operation for order tracking using pre-registered ID-to-key mapping
	if key, ok := m.idToKey[id]; ok {
		m.logOperation("deleteSkill", key)
	}
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

// =============================================================================
// E3: Topological Execution Order Tests
// =============================================================================
//
// These tests verify that the ExecutionEngine respects dependency ordering
// when executing reconciliation plans. Creates/updates must happen in
// dependency order (dependencies before dependents), and deletes must happen
// in reverse dependency order (dependents before dependencies).

// -----------------------------------------------------------------------------
// Create Order Verification Tests
// -----------------------------------------------------------------------------

func TestExecutePlan_CreateOrder_LinearChain(t *testing.T) {
	// Linear chain: workflow -> agent -> mcp_server
	// MCP server should be created first, then agent, then workflow
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "etl")
	workflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "pipeline")

	mcp := createTestMcpServer("db")
	agent := createTestAgent("etl")
	workflow := createTestWorkflow("pipeline")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(workflowKey, workflow), // Added first, but should execute last
		NewCreateChange(agentKey, agent),
		NewCreateChange(mcpKey, mcp), // Should execute first
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	// Verify no errors
	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Verify topological order: mcp -> agent -> workflow
	mock.assertCreatedBefore(t, mcpKey, agentKey)
	mock.assertCreatedBefore(t, agentKey, workflowKey)
}

func TestExecutePlan_CreateOrder_DiamondDependency(t *testing.T) {
	// Diamond pattern: agent depends on 2 MCP servers
	//       agent
	//      /     \
	//   mcp1    mcp2
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	mcp1Key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "postgres")
	mcp2Key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "s3")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "etl")

	mcp1 := createTestMcpServer("postgres")
	mcp2 := createTestMcpServer("s3")
	agent := createTestAgent("etl")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcp1Key).
		AddDependency(agentKey, mcp2Key).
		Build()

	creates := []ResourceChange{
		NewCreateChange(agentKey, agent), // Depends on both MCPs
		NewCreateChange(mcp1Key, mcp1),
		NewCreateChange(mcp2Key, mcp2),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Both MCPs should be created before agent
	mock.assertCreatedBefore(t, mcp1Key, agentKey)
	mock.assertCreatedBefore(t, mcp2Key, agentKey)
}

func TestExecutePlan_CreateOrder_SkillBeforeAgent(t *testing.T) {
	// Agent depends on skill
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	skillKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "coding")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "reviewer")

	skill := createTestSkill("coding")
	agent := createTestAgent("reviewer")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, skillKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(agentKey, agent),
		NewCreateChange(skillKey, skill),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Skill should be created before agent
	mock.assertCreatedBefore(t, skillKey, agentKey)
}

func TestExecutePlan_CreateOrder_ComplexDependencies(t *testing.T) {
	// Complex scenario:
	// workflow -> [etl-agent, validator-agent]
	// etl-agent -> [postgres-mcp, s3-mcp]
	// validator-agent -> [validation-skill]
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	postgresKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "postgres")
	s3Key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "s3")
	validationKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "validation")
	etlAgentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "etl")
	validatorKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "validator")
	workflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "data-pipeline")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, etlAgentKey).
		AddDependency(workflowKey, validatorKey).
		AddDependency(etlAgentKey, postgresKey).
		AddDependency(etlAgentKey, s3Key).
		AddDependency(validatorKey, validationKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(workflowKey, createTestWorkflow("data-pipeline")),
		NewCreateChange(etlAgentKey, createTestAgent("etl")),
		NewCreateChange(validatorKey, createTestAgent("validator")),
		NewCreateChange(postgresKey, createTestMcpServer("postgres")),
		NewCreateChange(s3Key, createTestMcpServer("s3")),
		NewCreateChange(validationKey, createTestSkill("validation")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Leaf nodes before agents
	mock.assertCreatedBefore(t, postgresKey, etlAgentKey)
	mock.assertCreatedBefore(t, s3Key, etlAgentKey)
	mock.assertCreatedBefore(t, validationKey, validatorKey)

	// Agents before workflow
	mock.assertCreatedBefore(t, etlAgentKey, workflowKey)
	mock.assertCreatedBefore(t, validatorKey, workflowKey)
}

func TestExecutePlan_CreateOrder_FirstApplyScenario(t *testing.T) {
	// First apply: all creates with real dependency structure
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	skillKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "coding")
	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "github")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "reviewer")
	workflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "ci-cd")

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		AddDependency(agentKey, skillKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(workflowKey, createTestWorkflow("ci-cd")),
		NewCreateChange(agentKey, createTestAgent("reviewer")),
		NewCreateChange(mcpKey, createTestMcpServer("github")),
		NewCreateChange(skillKey, createTestSkill("coding")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Verify correct order
	mock.assertCreatedBefore(t, skillKey, agentKey)
	mock.assertCreatedBefore(t, mcpKey, agentKey)
	mock.assertCreatedBefore(t, agentKey, workflowKey)

	// Verify all 4 were created
	if len(result.Created()) != 4 {
		t.Errorf("Expected 4 creates, got %d", len(result.Created()))
	}
}

func TestExecutePlan_CreateOrder_Deterministic(t *testing.T) {
	// Same inputs should always produce same output order
	for i := 0; i < 5; i++ {
		mock := newMockResourceController()
		engine := NewExecutionEngine(mock)

		mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
		agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "worker")

		graph := NewDependencyGraphBuilder().
			AddDependency(agentKey, mcpKey).
			Build()

		creates := []ResourceChange{
			NewCreateChange(agentKey, createTestAgent("worker")),
			NewCreateChange(mcpKey, createTestMcpServer("db")),
		}

		plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
		engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

		mcpIdx := mock.getOperationIndex(mcpKey)
		agentIdx := mock.getOperationIndex(agentKey)

		if mcpIdx != 0 {
			t.Errorf("iteration %d: expected MCP at index 0, got %d", i, mcpIdx)
		}
		if agentIdx != 1 {
			t.Errorf("iteration %d: expected agent at index 1, got %d", i, agentIdx)
		}
	}
}

// -----------------------------------------------------------------------------
// Delete Order Verification Tests
// -----------------------------------------------------------------------------

func TestExecutePlan_DeleteOrder_LinearChain(t *testing.T) {
	// Linear chain: workflow -> agent -> mcp_server
	// Deletion should be: workflow, agent, mcp_server (dependents first)
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "etl")
	workflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "pipeline")

	mcp := createTestMcpServerWithID("db", "mcp-id")
	agent := createTestAgentWithID("etl", "agent-id")
	workflow := createTestWorkflowWithID("pipeline", "workflow-id")

	// Register ID-to-key mappings for delete tracking
	mock.registerDeleteKey("mcp-id", mcpKey)
	mock.registerDeleteKey("agent-id", agentKey)
	mock.registerDeleteKey("workflow-id", workflowKey)

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		Build()

	deletes := []ResourceChange{
		NewDeleteChange(mcpKey, mcp), // Should be deleted last
		NewDeleteChange(agentKey, agent),
		NewDeleteChange(workflowKey, workflow), // Should be deleted first
	}

	plan := NewReconciliationPlanWithGraph(nil, nil, deletes, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Verify reverse topological order: workflow -> agent -> mcp
	mock.assertDeletedBefore(t, workflowKey, agentKey)
	mock.assertDeletedBefore(t, agentKey, mcpKey)
}

func TestExecutePlan_DeleteOrder_KindHierarchyFallback(t *testing.T) {
	// No graph - should use kind hierarchy fallback
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	skillKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "orphan-skill")
	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "orphan-mcp")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "orphan-agent")
	workflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "orphan-workflow")

	skill := createTestSkillWithID("orphan-skill", "skill-id")
	mcp := createTestMcpServerWithID("orphan-mcp", "mcp-id")
	agent := createTestAgentWithID("orphan-agent", "agent-id")
	workflow := createTestWorkflowWithID("orphan-workflow", "workflow-id")

	// Register ID-to-key mappings
	mock.registerDeleteKey("skill-id", skillKey)
	mock.registerDeleteKey("mcp-id", mcpKey)
	mock.registerDeleteKey("agent-id", agentKey)
	mock.registerDeleteKey("workflow-id", workflowKey)

	deletes := []ResourceChange{
		NewDeleteChange(skillKey, skill),
		NewDeleteChange(mcpKey, mcp),
		NewDeleteChange(agentKey, agent),
		NewDeleteChange(workflowKey, workflow),
	}

	// No graph - use fallback kind order
	plan := NewReconciliationPlan(nil, nil, deletes)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Kind order: workflow -> agent -> mcp_server -> skill
	mock.assertDeletedBefore(t, workflowKey, agentKey)
	mock.assertDeletedBefore(t, agentKey, mcpKey)
	mock.assertDeletedBefore(t, mcpKey, skillKey)
}

func TestExecutePlan_DeleteOrder_OrphansInSafeOrder(t *testing.T) {
	// Orphan resources (not in desired state) should be deleted safely
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	agent1Key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "orphan1")
	agent2Key := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "orphan2")
	workflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "orphan-wf")

	agent1 := createTestAgentWithID("orphan1", "agent1-id")
	agent2 := createTestAgentWithID("orphan2", "agent2-id")
	workflow := createTestWorkflowWithID("orphan-wf", "wf-id")

	mock.registerDeleteKey("agent1-id", agent1Key)
	mock.registerDeleteKey("agent2-id", agent2Key)
	mock.registerDeleteKey("wf-id", workflowKey)

	deletes := []ResourceChange{
		NewDeleteChange(agent1Key, agent1),
		NewDeleteChange(agent2Key, agent2),
		NewDeleteChange(workflowKey, workflow),
	}

	plan := NewReconciliationPlan(nil, nil, deletes)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Workflow should be deleted before agents (kind hierarchy)
	mock.assertDeletedBefore(t, workflowKey, agent1Key)
	mock.assertDeletedBefore(t, workflowKey, agent2Key)
}

func TestExecutePlan_DeleteOrder_CompleteTeardown(t *testing.T) {
	// Complete teardown: all resources deleted in reverse dependency order
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	skillKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "coding")
	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "github")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "reviewer")
	workflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "ci-cd")

	skill := createTestSkillWithID("coding", "skill-id")
	mcp := createTestMcpServerWithID("github", "mcp-id")
	agent := createTestAgentWithID("reviewer", "agent-id")
	workflow := createTestWorkflowWithID("ci-cd", "wf-id")

	mock.registerDeleteKey("skill-id", skillKey)
	mock.registerDeleteKey("mcp-id", mcpKey)
	mock.registerDeleteKey("agent-id", agentKey)
	mock.registerDeleteKey("wf-id", workflowKey)

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		AddDependency(agentKey, skillKey).
		Build()

	deletes := []ResourceChange{
		NewDeleteChange(skillKey, skill),
		NewDeleteChange(mcpKey, mcp),
		NewDeleteChange(agentKey, agent),
		NewDeleteChange(workflowKey, workflow),
	}

	plan := NewReconciliationPlanWithGraph(nil, nil, deletes, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Verify all 4 were deleted
	if len(result.Deleted()) != 4 {
		t.Errorf("Expected 4 deletes, got %d", len(result.Deleted()))
	}

	// Verify reverse dependency order
	mock.assertDeletedBefore(t, workflowKey, agentKey)
	mock.assertDeletedBefore(t, agentKey, mcpKey)
	mock.assertDeletedBefore(t, agentKey, skillKey)
}

func TestExecutePlan_DeleteOrder_PartialGraphCoverage(t *testing.T) {
	// Graph doesn't cover all orphans - should fall back to kind order
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent1")
	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "mcp1")
	orphanKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "orphan")

	agent := createTestAgentWithID("agent1", "agent-id")
	mcp := createTestMcpServerWithID("mcp1", "mcp-id")
	orphan := createTestSkillWithID("orphan", "orphan-id")

	mock.registerDeleteKey("agent-id", agentKey)
	mock.registerDeleteKey("mcp-id", mcpKey)
	mock.registerDeleteKey("orphan-id", orphanKey)

	// Graph only has agent -> mcp dependency (orphan skill not in graph)
	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcpKey).
		Build()

	deletes := []ResourceChange{
		NewDeleteChange(agentKey, agent),
		NewDeleteChange(mcpKey, mcp),
		NewDeleteChange(orphanKey, orphan),
	}

	plan := NewReconciliationPlanWithGraph(nil, nil, deletes, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Should fall back to kind order since orphan not in graph
	// Kind order: agent -> mcp -> skill
	mock.assertDeletedBefore(t, agentKey, mcpKey)
	mock.assertDeletedBefore(t, mcpKey, orphanKey)
}

// -----------------------------------------------------------------------------
// Mixed Operations Tests
// -----------------------------------------------------------------------------

func TestExecutePlan_MixedOrder_CreatesBeforeDeletes(t *testing.T) {
	// Creates should happen before deletes in the same plan
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	createKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "new-agent")
	deleteKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "old-agent")

	newAgent := createTestAgent("new-agent")
	oldAgent := createTestAgentWithID("old-agent", "old-agent-id")

	mock.registerDeleteKey("old-agent-id", deleteKey)

	creates := []ResourceChange{NewCreateChange(createKey, newAgent)}
	deletes := []ResourceChange{NewDeleteChange(deleteKey, oldAgent)}

	plan := NewReconciliationPlan(creates, nil, deletes)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Create should happen before delete
	createIdx := mock.getOperationIndex(createKey)
	deleteIdx := mock.getOperationIndex(deleteKey)

	if createIdx >= deleteIdx {
		t.Errorf("Create should happen before delete: create=%d, delete=%d", createIdx, deleteIdx)
	}
}

func TestExecutePlan_MixedOrder_UpdatesWithCreates(t *testing.T) {
	// Updates and creates should both respect dependency order
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "worker")

	mcp := createTestMcpServer("db")
	actualAgent := createTestAgentWithID("worker", "agent-id")
	desiredAgent := createTestAgent("worker")
	desiredAgent.Spec.Description = "Updated"

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcpKey).
		Build()

	creates := []ResourceChange{NewCreateChange(mcpKey, mcp)}
	updates := []ResourceChange{NewUpdateChange(agentKey, desiredAgent, actualAgent)}

	plan := NewReconciliationPlanWithGraph(creates, updates, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// MCP (create) should happen before agent (update) due to dependency
	mock.assertCreatedBefore(t, mcpKey, agentKey)
}

func TestExecutePlan_MixedOrder_IncrementalUpdate(t *testing.T) {
	// Incremental update: add new dependency, update existing agent
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	existingMcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "postgres")
	newSkillKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "new-skill")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "worker")

	existingMcp := createTestMcpServer("postgres")
	newSkill := createTestSkill("new-skill")
	actualAgent := createTestAgentWithID("worker", "agent-id")
	desiredAgent := createTestAgent("worker")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, existingMcpKey).
		AddDependency(agentKey, newSkillKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(existingMcpKey, existingMcp),
		NewCreateChange(newSkillKey, newSkill),
	}
	updates := []ResourceChange{
		NewUpdateChange(agentKey, desiredAgent, actualAgent),
	}

	plan := NewReconciliationPlanWithGraph(creates, updates, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Both dependencies should be created before agent update
	mock.assertCreatedBefore(t, existingMcpKey, agentKey)
	mock.assertCreatedBefore(t, newSkillKey, agentKey)
}

func TestExecutePlan_MixedOrder_ResourceReplacement(t *testing.T) {
	// Replace old MCP with new MCP, update agent that uses it
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	newMcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "new-db")
	oldMcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "old-db")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "worker")

	newMcp := createTestMcpServer("new-db")
	oldMcp := createTestMcpServerWithID("old-db", "old-mcp-id")
	actualAgent := createTestAgentWithID("worker", "agent-id")
	desiredAgent := createTestAgent("worker")

	mock.registerDeleteKey("old-mcp-id", oldMcpKey)

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, newMcpKey).
		Build()

	creates := []ResourceChange{NewCreateChange(newMcpKey, newMcp)}
	updates := []ResourceChange{NewUpdateChange(agentKey, desiredAgent, actualAgent)}
	deletes := []ResourceChange{NewDeleteChange(oldMcpKey, oldMcp)}

	plan := NewReconciliationPlanWithGraph(creates, updates, deletes, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// New MCP should be created, then agent updated, then old MCP deleted
	newMcpIdx := mock.getOperationIndex(newMcpKey)
	agentIdx := mock.getOperationIndex(agentKey)
	oldMcpIdx := mock.getOperationIndex(oldMcpKey)

	if newMcpIdx >= agentIdx {
		t.Errorf("New MCP should be created before agent update: newMcp=%d, agent=%d", newMcpIdx, agentIdx)
	}
	if agentIdx >= oldMcpIdx {
		t.Errorf("Agent update should happen before old MCP delete: agent=%d, oldMcp=%d", agentIdx, oldMcpIdx)
	}
}

// -----------------------------------------------------------------------------
// Partial Failure with Ordering Tests
// -----------------------------------------------------------------------------

func TestExecutePlan_PartialFailure_OrderPreserved(t *testing.T) {
	// Early create fails, but later creates still execute in order
	mock := newMockResourceController()
	mock.createMcpServerErr = errors.New("MCP creation failed")
	engine := NewExecutionEngine(mock)

	mcp1Key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "mcp1")
	mcp2Key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "mcp2")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent")

	mcp1 := createTestMcpServer("mcp1")
	mcp2 := createTestMcpServer("mcp2")
	agent := createTestAgent("agent")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcp1Key).
		AddDependency(agentKey, mcp2Key).
		Build()

	creates := []ResourceChange{
		NewCreateChange(mcp1Key, mcp1), // Will fail
		NewCreateChange(mcp2Key, mcp2), // Will also fail (same error)
		NewCreateChange(agentKey, agent),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	// Should have errors for MCP failures
	if !result.HasErrors() {
		t.Error("Expected errors in result")
	}

	// Agent should still be attempted even though MCPs failed
	if len(mock.createAgentCalls) != 1 {
		t.Errorf("Expected agent creation attempt, got %d calls", len(mock.createAgentCalls))
	}

	// Verify order was still correct (MCPs before agent, even with failures)
	mcp1Idx := mock.getOperationIndex(mcp1Key)
	mcp2Idx := mock.getOperationIndex(mcp2Key)
	agentIdx := mock.getOperationIndex(agentKey)

	if mcp1Idx >= agentIdx {
		t.Errorf("mcp1 should be attempted before agent: mcp1=%d, agent=%d", mcp1Idx, agentIdx)
	}
	if mcp2Idx >= agentIdx {
		t.Errorf("mcp2 should be attempted before agent: mcp2=%d, agent=%d", mcp2Idx, agentIdx)
	}
}

func TestExecutePlan_PartialFailure_UnrelatedResourcesStillExecute(t *testing.T) {
	// Failed dependency doesn't block unrelated resources
	mock := newMockResourceController()
	mock.createMcpServerErr = errors.New("MCP creation failed")
	engine := NewExecutionEngine(mock)

	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "db")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "worker")
	unrelatedSkillKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "unrelated")

	mcp := createTestMcpServer("db")
	agent := createTestAgent("worker")
	skill := createTestSkill("unrelated")

	// Only agent depends on MCP; skill is independent
	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, mcpKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(mcpKey, mcp),             // Will fail
		NewCreateChange(agentKey, agent),         // Will succeed (tries anyway)
		NewCreateChange(unrelatedSkillKey, skill), // Will succeed (unrelated)
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	// MCP failed, but skill succeeded
	if len(mock.pushSkillCalls) != 1 {
		t.Errorf("Expected skill to be created, got %d calls", len(mock.pushSkillCalls))
	}

	// Should have at least 1 error (for MCP)
	if len(result.Errors()) < 1 {
		t.Errorf("Expected at least 1 error, got %d", len(result.Errors()))
	}

	// Skill should have been created successfully
	if len(result.Created()) < 1 {
		t.Errorf("Expected at least 1 successful create (skill), got %d", len(result.Created()))
	}
}

func TestExecutePlan_PartialFailure_DeleteOrderPreserved(t *testing.T) {
	// Delete failure doesn't stop other deletes, order is preserved
	mock := newMockResourceController()
	mock.deleteWorkflowErr = errors.New("workflow deletion failed")
	engine := NewExecutionEngine(mock)

	workflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "wf")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "agent")
	mcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "mcp")

	workflow := createTestWorkflowWithID("wf", "wf-id")
	agent := createTestAgentWithID("agent", "agent-id")
	mcp := createTestMcpServerWithID("mcp", "mcp-id")

	mock.registerDeleteKey("wf-id", workflowKey)
	mock.registerDeleteKey("agent-id", agentKey)
	mock.registerDeleteKey("mcp-id", mcpKey)

	graph := NewDependencyGraphBuilder().
		AddDependency(workflowKey, agentKey).
		AddDependency(agentKey, mcpKey).
		Build()

	deletes := []ResourceChange{
		NewDeleteChange(workflowKey, workflow), // Will fail
		NewDeleteChange(agentKey, agent),
		NewDeleteChange(mcpKey, mcp),
	}

	plan := NewReconciliationPlanWithGraph(nil, nil, deletes, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	// Workflow deletion failed
	if !result.HasErrors() {
		t.Error("Expected errors for workflow deletion failure")
	}

	// But agent and MCP should still be deleted
	if len(mock.deleteAgentCalls) != 1 {
		t.Errorf("Expected agent to be deleted, got %d calls", len(mock.deleteAgentCalls))
	}
	if len(mock.deleteMcpServerCalls) != 1 {
		t.Errorf("Expected MCP to be deleted, got %d calls", len(mock.deleteMcpServerCalls))
	}

	// Order should still be correct (workflow first attempted, then agent, then mcp)
	wfIdx := mock.getOperationIndex(workflowKey)
	agentIdx := mock.getOperationIndex(agentKey)
	mcpIdx := mock.getOperationIndex(mcpKey)

	if wfIdx >= agentIdx {
		t.Errorf("Workflow should be attempted before agent: wf=%d, agent=%d", wfIdx, agentIdx)
	}
	if agentIdx >= mcpIdx {
		t.Errorf("Agent should be deleted before MCP: agent=%d, mcp=%d", agentIdx, mcpIdx)
	}
}

// -----------------------------------------------------------------------------
// Real-World Scenario Tests
// -----------------------------------------------------------------------------

func TestExecutePlan_RealWorld_DataPipeline(t *testing.T) {
	// Data pipeline deployment:
	// workflow -> [etl-agent, validator-agent]
	// etl-agent -> [postgres-mcp, s3-mcp]
	// validator-agent -> [validation-skill]
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	postgresKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "postgres")
	s3Key := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "s3")
	validationKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "validation")
	etlKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "etl")
	validatorKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "validator")
	pipelineKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "data-pipeline")

	graph := NewDependencyGraphBuilder().
		AddDependency(pipelineKey, etlKey).
		AddDependency(pipelineKey, validatorKey).
		AddDependency(etlKey, postgresKey).
		AddDependency(etlKey, s3Key).
		AddDependency(validatorKey, validationKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(pipelineKey, createTestWorkflow("data-pipeline")),
		NewCreateChange(etlKey, createTestAgent("etl")),
		NewCreateChange(validatorKey, createTestAgent("validator")),
		NewCreateChange(postgresKey, createTestMcpServer("postgres")),
		NewCreateChange(s3Key, createTestMcpServer("s3")),
		NewCreateChange(validationKey, createTestSkill("validation")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}
	if len(result.Created()) != 6 {
		t.Errorf("Expected 6 creates, got %d", len(result.Created()))
	}

	// Verify complete dependency order
	mock.assertCreatedBefore(t, postgresKey, etlKey)
	mock.assertCreatedBefore(t, s3Key, etlKey)
	mock.assertCreatedBefore(t, validationKey, validatorKey)
	mock.assertCreatedBefore(t, etlKey, pipelineKey)
	mock.assertCreatedBefore(t, validatorKey, pipelineKey)
}

func TestExecutePlan_RealWorld_AgentDeployment(t *testing.T) {
	// Agent deployment with multiple dependencies:
	// code-reviewer agent -> [github-mcp, coding-skill, review-skill]
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	githubKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "github")
	codingKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "coding")
	reviewKey := MustResourceKey(apiresourcekind.ApiResourceKind_skill, "review")
	agentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "code-reviewer")

	graph := NewDependencyGraphBuilder().
		AddDependency(agentKey, githubKey).
		AddDependency(agentKey, codingKey).
		AddDependency(agentKey, reviewKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(agentKey, createTestAgent("code-reviewer")),
		NewCreateChange(githubKey, createTestMcpServer("github")),
		NewCreateChange(codingKey, createTestSkill("coding")),
		NewCreateChange(reviewKey, createTestSkill("review")),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, nil, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// All dependencies should be created before agent
	mock.assertCreatedBefore(t, githubKey, agentKey)
	mock.assertCreatedBefore(t, codingKey, agentKey)
	mock.assertCreatedBefore(t, reviewKey, agentKey)
}

func TestExecutePlan_RealWorld_ProjectLifecycle(t *testing.T) {
	// Full project lifecycle: creates and deletes in same reconciliation
	// Creates: new-agent -> new-mcp
	// Deletes: old-workflow -> old-agent
	mock := newMockResourceController()
	engine := NewExecutionEngine(mock)

	newMcpKey := MustResourceKey(apiresourcekind.ApiResourceKind_mcp_server, "new-mcp")
	newAgentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "new-agent")
	oldAgentKey := MustResourceKey(apiresourcekind.ApiResourceKind_agent, "old-agent")
	oldWorkflowKey := MustResourceKey(apiresourcekind.ApiResourceKind_workflow, "old-workflow")

	newMcp := createTestMcpServer("new-mcp")
	newAgent := createTestAgent("new-agent")
	oldAgent := createTestAgentWithID("old-agent", "old-agent-id")
	oldWorkflow := createTestWorkflowWithID("old-workflow", "old-wf-id")

	mock.registerDeleteKey("old-agent-id", oldAgentKey)
	mock.registerDeleteKey("old-wf-id", oldWorkflowKey)

	graph := NewDependencyGraphBuilder().
		AddDependency(newAgentKey, newMcpKey).
		AddDependency(oldWorkflowKey, oldAgentKey).
		Build()

	creates := []ResourceChange{
		NewCreateChange(newMcpKey, newMcp),
		NewCreateChange(newAgentKey, newAgent),
	}
	deletes := []ResourceChange{
		NewDeleteChange(oldAgentKey, oldAgent),
		NewDeleteChange(oldWorkflowKey, oldWorkflow),
	}

	plan := NewReconciliationPlanWithGraph(creates, nil, deletes, graph)
	result := engine.ExecutePlan(context.Background(), plan, "project-123", "test-org")

	if result.HasErrors() {
		t.Errorf("Expected no errors, got %v", result.Errors())
	}

	// Create order: new-mcp -> new-agent
	mock.assertCreatedBefore(t, newMcpKey, newAgentKey)

	// Delete order: old-workflow -> old-agent
	mock.assertDeletedBefore(t, oldWorkflowKey, oldAgentKey)

	// All creates should happen before all deletes
	newMcpIdx := mock.getOperationIndex(newMcpKey)
	newAgentIdx := mock.getOperationIndex(newAgentKey)
	oldWfIdx := mock.getOperationIndex(oldWorkflowKey)
	oldAgentIdx := mock.getOperationIndex(oldAgentKey)

	if newMcpIdx >= oldWfIdx || newAgentIdx >= oldWfIdx {
		t.Error("Creates should happen before deletes")
	}
	if newMcpIdx >= oldAgentIdx || newAgentIdx >= oldAgentIdx {
		t.Error("Creates should happen before deletes")
	}
}
