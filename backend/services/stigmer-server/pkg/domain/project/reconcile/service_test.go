package reconcile

import (
	"context"
	"errors"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	projectv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/project/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// =============================================================================
// Mock Store Implementation
// =============================================================================

// mockStore implements store.Store for testing purposes.
// It provides configurable behavior for the methods used by ReconciliationService.
type mockStore struct {
	// resources holds pre-configured resources by kind.
	// Key is the kind, value is a map of resource ID to serialized proto bytes.
	resources map[apiresourcekind.ApiResourceKind][]proto.Message

	// findAllByFieldFunc allows custom behavior for FindAllByField.
	// If set, this function is called instead of the default implementation.
	findAllByFieldFunc func(ctx context.Context, kind apiresourcekind.ApiResourceKind, fieldPath string, value string) ([][]byte, error)

	// findAllByFieldError forces FindAllByField to return this error.
	findAllByFieldError error

	// capturedFieldPath captures the fieldPath passed to FindAllByField.
	capturedFieldPath string

	// capturedProjectID captures the value (projectID) passed to FindAllByField.
	capturedProjectID string
}

// newMockStore creates a new mock store with empty resources.
func newMockStore() *mockStore {
	return &mockStore{
		resources: make(map[apiresourcekind.ApiResourceKind][]proto.Message),
	}
}

// withAgents adds agents to the mock store.
func (m *mockStore) withAgents(agents ...*agentv1.Agent) *mockStore {
	for _, agent := range agents {
		m.resources[apiresourcekind.ApiResourceKind_agent] = append(
			m.resources[apiresourcekind.ApiResourceKind_agent], agent)
	}
	return m
}

// withWorkflows adds workflows to the mock store.
func (m *mockStore) withWorkflows(workflows ...*workflowv1.Workflow) *mockStore {
	for _, workflow := range workflows {
		m.resources[apiresourcekind.ApiResourceKind_workflow] = append(
			m.resources[apiresourcekind.ApiResourceKind_workflow], workflow)
	}
	return m
}

// withMcpServers adds MCP servers to the mock store.
func (m *mockStore) withMcpServers(servers ...*mcpserverv1.McpServer) *mockStore {
	for _, server := range servers {
		m.resources[apiresourcekind.ApiResourceKind_mcp_server] = append(
			m.resources[apiresourcekind.ApiResourceKind_mcp_server], server)
	}
	return m
}

// withSkills adds skills to the mock store.
func (m *mockStore) withSkills(skills ...*skillv1.Skill) *mockStore {
	for _, skill := range skills {
		m.resources[apiresourcekind.ApiResourceKind_skill] = append(
			m.resources[apiresourcekind.ApiResourceKind_skill], skill)
	}
	return m
}

// withFindAllByFieldError configures the store to return an error.
func (m *mockStore) withFindAllByFieldError(err error) *mockStore {
	m.findAllByFieldError = err
	return m
}

// FindAllByField implements store.Store.
func (m *mockStore) FindAllByField(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	fieldPath string,
	value string,
) ([][]byte, error) {
	// Capture the call for assertions
	m.capturedFieldPath = fieldPath
	m.capturedProjectID = value

	// Check for configured error
	if m.findAllByFieldError != nil {
		return nil, m.findAllByFieldError
	}

	// Use custom function if provided
	if m.findAllByFieldFunc != nil {
		return m.findAllByFieldFunc(ctx, kind, fieldPath, value)
	}

	// Default: return configured resources for the kind
	resources := m.resources[kind]
	result := make([][]byte, 0, len(resources))
	for _, resource := range resources {
		bytes, err := proto.Marshal(resource)
		if err != nil {
			continue
		}
		result = append(result, bytes)
	}
	return result, nil
}

// Stub implementations for unused store.Store methods

func (m *mockStore) SaveResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error {
	return errors.New("not implemented")
}

func (m *mockStore) GetResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error {
	return store.ErrNotFound
}

func (m *mockStore) ListResources(ctx context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error) {
	return nil, errors.New("not implemented")
}

func (m *mockStore) DeleteResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string) error {
	return errors.New("not implemented")
}

func (m *mockStore) FindByField(ctx context.Context, kind apiresourcekind.ApiResourceKind, fieldPath string, value string, msg proto.Message) error {
	return store.ErrNotFound
}

func (m *mockStore) DeleteResourcesByKind(ctx context.Context, kind apiresourcekind.ApiResourceKind) (int64, error) {
	return 0, errors.New("not implemented")
}

func (m *mockStore) DeleteResourcesByIdPrefix(ctx context.Context, kind apiresourcekind.ApiResourceKind, idPrefix string) (int64, error) {
	return 0, errors.New("not implemented")
}

func (m *mockStore) SaveAudit(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string, msg proto.Message, versionHash, tag string) error {
	return errors.New("not implemented")
}

func (m *mockStore) GetAuditByHash(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, versionHash string, msg proto.Message) error {
	return store.ErrAuditNotFound
}

func (m *mockStore) GetAuditByTag(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId, tag string, msg proto.Message) error {
	return store.ErrAuditNotFound
}

func (m *mockStore) ListAuditHistory(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) ([][]byte, error) {
	return nil, errors.New("not implemented")
}

func (m *mockStore) DeleteAuditByResourceId(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) (int64, error) {
	return 0, errors.New("not implemented")
}

func (m *mockStore) UpsertSearchIndex(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string, entry *store.SearchIndexEntry) error {
	return errors.New("not implemented")
}

func (m *mockStore) DeleteSearchIndex(ctx context.Context, kind apiresourcekind.ApiResourceKind, resourceId string) error {
	return errors.New("not implemented")
}

func (m *mockStore) Close() error {
	return nil
}

// =============================================================================
// Test Fixtures
// =============================================================================

// createServiceTestProject creates a Project for testing with the given name.
func createServiceTestProject(name string) *projectv1.Project {
	return &projectv1.Project{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Project",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "prj-test123",
			Name: name,
			Slug: "test-project",
			Org:  "test-org",
		},
		Spec: &projectv1.ProjectSpec{
			Runtime:     projectv1.ProjectRuntime_go,
			EntryPoint:  "main.go",
			Description: "A test project",
		},
	}
}

// createServiceTestProjectWithAgents creates a Project with embedded agents.
func createServiceTestProjectWithAgents(agents ...*agentv1.Agent) *projectv1.Project {
	project := createServiceTestProject("Test Project")
	project.Spec.Agents = agents
	return project
}

// createServiceTestProjectWithWorkflows creates a Project with embedded workflows.
func createServiceTestProjectWithWorkflows(workflows ...*workflowv1.Workflow) *projectv1.Project {
	project := createServiceTestProject("Test Project")
	project.Spec.Workflows = workflows
	return project
}

// createServiceTestProjectWithMcpServers creates a Project with embedded MCP servers.
func createServiceTestProjectWithMcpServers(servers ...*mcpserverv1.McpServer) *projectv1.Project {
	project := createServiceTestProject("Test Project")
	project.Spec.McpServers = servers
	return project
}

// createServiceTestProjectWithSkills creates a Project with embedded skills.
func createServiceTestProjectWithSkills(skills ...*skillv1.Skill) *projectv1.Project {
	project := createServiceTestProject("Test Project")
	project.Spec.Skills = skills
	return project
}

// createServiceTestProjectWithAllResources creates a Project with all resource types.
func createServiceTestProjectWithAllResources() *projectv1.Project {
	project := createServiceTestProject("Test Project")
	project.Spec.Agents = []*agentv1.Agent{createServiceTestAgent("test-agent", "Test agent")}
	project.Spec.Workflows = []*workflowv1.Workflow{createServiceTestWorkflow("test-workflow", "Test workflow")}
	project.Spec.McpServers = []*mcpserverv1.McpServer{createServiceTestMcpServer("test-mcp", "Test MCP")}
	project.Spec.Skills = []*skillv1.Skill{createServiceTestSkill("test-skill", "Test skill")}
	return project
}

// createServiceTestAgent creates an Agent for testing.
func createServiceTestAgent(slug, description string) *agentv1.Agent {
	return &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &agentv1.AgentSpec{
			Description:  description,
			Instructions: "Test instructions for " + slug,
		},
	}
}

// createServiceTestAgentWithID creates an Agent with a specific ID (for actual state).
func createServiceTestAgentWithID(slug, description, id string) *agentv1.Agent {
	agent := createServiceTestAgent(slug, description)
	agent.Metadata.Id = id
	agent.Metadata.Annotations = map[string]string{
		ProjectOwnershipAnnotation: "prj-test123",
	}
	return agent
}

// createServiceTestWorkflow creates a Workflow for testing.
func createServiceTestWorkflow(slug, description string) *workflowv1.Workflow {
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: description,
		},
	}
}

// createServiceTestWorkflowWithID creates a Workflow with a specific ID.
func createServiceTestWorkflowWithID(slug, description, id string) *workflowv1.Workflow {
	workflow := createServiceTestWorkflow(slug, description)
	workflow.Metadata.Id = id
	workflow.Metadata.Annotations = map[string]string{
		ProjectOwnershipAnnotation: "prj-test123",
	}
	return workflow
}

// createServiceTestMcpServer creates an MCP Server for testing.
func createServiceTestMcpServer(slug, description string) *mcpserverv1.McpServer {
	return &mcpserverv1.McpServer{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: description,
		},
	}
}

// createServiceTestMcpServerWithID creates an MCP Server with a specific ID.
func createServiceTestMcpServerWithID(slug, description, id string) *mcpserverv1.McpServer {
	server := createServiceTestMcpServer(slug, description)
	server.Metadata.Id = id
	server.Metadata.Annotations = map[string]string{
		ProjectOwnershipAnnotation: "prj-test123",
	}
	return server
}

// createServiceTestSkill creates a Skill for testing.
func createServiceTestSkill(slug, description string) *skillv1.Skill {
	return &skillv1.Skill{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Skill",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: slug,
			Slug: slug,
			Org:  "test-org",
		},
		Spec: &skillv1.SkillSpec{
			Description: description,
		},
	}
}

// createServiceTestSkillWithID creates a Skill with a specific ID.
func createServiceTestSkillWithID(slug, description, id string) *skillv1.Skill {
	skill := createServiceTestSkill(slug, description)
	skill.Metadata.Id = id
	skill.Metadata.Annotations = map[string]string{
		ProjectOwnershipAnnotation: "prj-test123",
	}
	return skill
}

// =============================================================================
// A. Reconcile Orchestration Tests (8 tests)
// =============================================================================

func TestReconcile_NilProject_ReturnsError(t *testing.T) {
	mockStore := newMockStore()
	service := NewReconciliationService(mockStore, nil)

	_, err := service.Reconcile(context.Background(), nil, DefaultOptions())
	if err == nil {
		t.Error("expected error for nil project")
	}
	if err.Error() != "project is nil" {
		t.Errorf("expected 'project is nil' error, got: %v", err)
	}
}

func TestReconcile_ProjectWithoutID_ReturnsError(t *testing.T) {
	mockStore := newMockStore()
	service := NewReconciliationService(mockStore, nil)

	project := &projectv1.Project{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Test",
			// No ID set
		},
		Spec: &projectv1.ProjectSpec{},
	}

	_, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err == nil {
		t.Error("expected error for project without ID")
	}
	if err.Error() != "project must have metadata.id set (must be persisted first)" {
		t.Errorf("unexpected error message: %v", err)
	}
}

func TestReconcile_NilMetadata_ReturnsError(t *testing.T) {
	mockStore := newMockStore()
	service := NewReconciliationService(mockStore, nil)

	project := &projectv1.Project{
		Spec: &projectv1.ProjectSpec{},
	}

	_, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err == nil {
		t.Error("expected error for project without metadata")
	}
}

func TestReconcile_NilOptions_UsesDefaults(t *testing.T) {
	mockStore := newMockStore()
	service := NewReconciliationService(mockStore, nil)

	project := createServiceTestProject("Test")

	// Should not panic with nil options
	result, err := service.Reconcile(context.Background(), project, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == nil {
		t.Error("expected non-nil result")
	}
}

func TestReconcile_EmptyProject_ReturnsEmptyResult(t *testing.T) {
	mockStore := newMockStore()
	service := NewReconciliationService(mockStore, nil)

	// Project with no embedded resources
	project := createServiceTestProject("Empty Project")

	result, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.TotalChanges() != 0 {
		t.Errorf("expected 0 changes, got %d", result.TotalChanges())
	}
}

func TestReconcile_FirstApply_ReturnsAllCreates(t *testing.T) {
	mockStore := newMockStore() // No existing resources
	service := NewReconciliationService(mockStore, nil)

	project := createServiceTestProjectWithAllResources()

	result, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should have 4 creates (1 agent, 1 workflow, 1 mcp, 1 skill)
	summary := result.ToProtoSummary()
	if len(summary.Created) != 4 {
		t.Errorf("expected 4 creates, got %d", len(summary.Created))
	}
	if len(summary.Updated) != 0 {
		t.Errorf("expected 0 updates, got %d", len(summary.Updated))
	}
	if len(summary.Deleted) != 0 {
		t.Errorf("expected 0 deletes, got %d", len(summary.Deleted))
	}
}

func TestReconcile_NoChanges_ReturnsEmptyResult(t *testing.T) {
	// Setup store with existing resources matching desired state
	agent := createServiceTestAgentWithID("test-agent", "Test agent", "agt-123")
	mockStore := newMockStore().withAgents(agent)
	service := NewReconciliationService(mockStore, nil)

	// Project with same agent (same spec)
	project := createServiceTestProject("Test")
	project.Spec.Agents = []*agentv1.Agent{createServiceTestAgent("test-agent", "Test agent")}

	result, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.TotalChanges() != 0 {
		t.Errorf("expected 0 changes (no diff), got %d", result.TotalChanges())
	}
}

func TestReconcile_StoreError_ReturnsError(t *testing.T) {
	mockStore := newMockStore().withFindAllByFieldError(errors.New("database connection failed"))
	service := NewReconciliationService(mockStore, nil)

	project := createServiceTestProjectWithAgents(createServiceTestAgent("test-agent", "desc"))

	_, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err == nil {
		t.Error("expected error from store failure")
	}
	if err.Error() != "failed to fetch actual state: failed to fetch agents: database connection failed" {
		t.Errorf("unexpected error message: %v", err)
	}
}

// =============================================================================
// B. parseDesiredState Tests (8 tests)
// =============================================================================

func TestParseDesiredState_NilSpec_ReturnsEmpty(t *testing.T) {
	service := &reconciliationServiceImpl{}

	project := &projectv1.Project{
		Metadata: &apiresource.ApiResourceMetadata{Id: "prj-123"},
		// Spec is nil
	}

	desired := service.parseDesiredState(project)

	if !desired.IsEmpty() {
		t.Errorf("expected empty state, got %d resources", desired.ResourceCount())
	}
}

func TestParseDesiredState_EmptySpec_ReturnsEmpty(t *testing.T) {
	service := &reconciliationServiceImpl{}

	project := &projectv1.Project{
		Metadata: &apiresource.ApiResourceMetadata{Id: "prj-123"},
		Spec:     &projectv1.ProjectSpec{},
	}

	desired := service.parseDesiredState(project)

	if !desired.IsEmpty() {
		t.Errorf("expected empty state, got %d resources", desired.ResourceCount())
	}
}

func TestParseDesiredState_SingleAgent_ExtractsCorrectly(t *testing.T) {
	service := &reconciliationServiceImpl{}

	agent := createServiceTestAgent("my-agent", "Test agent")
	project := createServiceTestProjectWithAgents(agent)

	desired := service.parseDesiredState(project)

	if desired.ResourceCount() != 1 {
		t.Fatalf("expected 1 resource, got %d", desired.ResourceCount())
	}

	extracted := desired.GetAgent("my-agent")
	if extracted == nil {
		t.Fatal("expected agent 'my-agent' to be extracted")
	}
	if extracted.Spec.Description != "Test agent" {
		t.Errorf("expected description 'Test agent', got '%s'", extracted.Spec.Description)
	}
}

func TestParseDesiredState_MultipleAgents_AllExtracted(t *testing.T) {
	service := &reconciliationServiceImpl{}

	agents := []*agentv1.Agent{
		createServiceTestAgent("agent-1", "First agent"),
		createServiceTestAgent("agent-2", "Second agent"),
		createServiceTestAgent("agent-3", "Third agent"),
	}
	project := createServiceTestProjectWithAgents(agents...)

	desired := service.parseDesiredState(project)

	if desired.ResourceCount() != 3 {
		t.Errorf("expected 3 resources, got %d", desired.ResourceCount())
	}

	for _, slug := range []string{"agent-1", "agent-2", "agent-3"} {
		if desired.GetAgent(slug) == nil {
			t.Errorf("expected agent '%s' to be extracted", slug)
		}
	}
}

func TestParseDesiredState_AllResourceTypes_ExtractsAll(t *testing.T) {
	service := &reconciliationServiceImpl{}

	project := createServiceTestProjectWithAllResources()

	desired := service.parseDesiredState(project)

	if desired.ResourceCount() != 4 {
		t.Errorf("expected 4 resources (1 of each type), got %d", desired.ResourceCount())
	}

	if desired.GetAgent("test-agent") == nil {
		t.Error("expected agent to be extracted")
	}
	if desired.GetWorkflow("test-workflow") == nil {
		t.Error("expected workflow to be extracted")
	}
	if desired.GetMcpServer("test-mcp") == nil {
		t.Error("expected MCP server to be extracted")
	}
	if desired.GetSkill("test-skill") == nil {
		t.Error("expected skill to be extracted")
	}
}

func TestParseDesiredState_UsesSlugIfSet(t *testing.T) {
	service := &reconciliationServiceImpl{}

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "My Display Name",
			Slug: "custom-slug",
		},
		Spec: &agentv1.AgentSpec{Description: "test"},
	}
	project := createServiceTestProjectWithAgents(agent)

	desired := service.parseDesiredState(project)

	// Should use slug, not generate from name
	if desired.GetAgent("custom-slug") == nil {
		t.Error("expected agent to be keyed by slug 'custom-slug'")
	}
	if desired.GetAgent("my-display-name") != nil {
		t.Error("should not generate key from name when slug is set")
	}
}

func TestParseDesiredState_GeneratesSlugFromName(t *testing.T) {
	service := &reconciliationServiceImpl{}

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "My Agent Name",
			// No slug set
		},
		Spec: &agentv1.AgentSpec{Description: "test"},
	}
	project := createServiceTestProjectWithAgents(agent)

	desired := service.parseDesiredState(project)

	// Should generate slug from name
	if desired.GetAgent("my-agent-name") == nil {
		t.Error("expected agent to be keyed by generated slug 'my-agent-name'")
	}
}

func TestParseDesiredState_SkipsResourcesWithNoSlug(t *testing.T) {
	service := &reconciliationServiceImpl{}

	// Agent with no metadata
	agent := &agentv1.Agent{
		Spec: &agentv1.AgentSpec{Description: "test"},
	}
	project := createServiceTestProjectWithAgents(agent)

	desired := service.parseDesiredState(project)

	// Should be empty - resource without slug/name is skipped
	if desired.ResourceCount() != 0 {
		t.Errorf("expected 0 resources (invalid agent skipped), got %d", desired.ResourceCount())
	}
}

// =============================================================================
// C. fetchActualState Tests (6 tests)
// =============================================================================

func TestFetchActualState_NoResources_ReturnsEmpty(t *testing.T) {
	mockStore := newMockStore() // Empty store
	service := &reconciliationServiceImpl{store: mockStore}

	actual, err := service.fetchActualState(context.Background(), "prj-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if !actual.IsEmpty() {
		t.Errorf("expected empty state, got %d resources", actual.ResourceCount())
	}
}

func TestFetchActualState_AgentsOnly_ReturnsAgents(t *testing.T) {
	agent := createServiceTestAgentWithID("existing-agent", "Existing agent", "agt-123")
	mockStore := newMockStore().withAgents(agent)
	service := &reconciliationServiceImpl{store: mockStore}

	actual, err := service.fetchActualState(context.Background(), "prj-test123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if actual.ResourceCount() != 1 {
		t.Fatalf("expected 1 resource, got %d", actual.ResourceCount())
	}

	fetched := actual.GetAgent("existing-agent")
	if fetched == nil {
		t.Fatal("expected agent 'existing-agent' to be fetched")
	}
	if fetched.Metadata.Id != "agt-123" {
		t.Errorf("expected ID 'agt-123', got '%s'", fetched.Metadata.Id)
	}
}

func TestFetchActualState_AllTypes_ReturnsAll(t *testing.T) {
	mockStore := newMockStore().
		withAgents(createServiceTestAgentWithID("agent", "desc", "agt-1")).
		withWorkflows(createServiceTestWorkflowWithID("workflow", "desc", "wf-1")).
		withMcpServers(createServiceTestMcpServerWithID("mcp", "desc", "mcp-1")).
		withSkills(createServiceTestSkillWithID("skill", "desc", "sk-1"))

	service := &reconciliationServiceImpl{store: mockStore}

	actual, err := service.fetchActualState(context.Background(), "prj-test123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if actual.ResourceCount() != 4 {
		t.Errorf("expected 4 resources, got %d", actual.ResourceCount())
	}
}

func TestFetchActualState_SkipsUnmarshalErrors(t *testing.T) {
	mockStore := newMockStore()
	// Configure to return invalid bytes for agents
	mockStore.findAllByFieldFunc = func(ctx context.Context, kind apiresourcekind.ApiResourceKind, fieldPath string, value string) ([][]byte, error) {
		if kind == apiresourcekind.ApiResourceKind_agent {
			// Return invalid proto bytes
			return [][]byte{
				[]byte("invalid proto data"),
				[]byte("more garbage"),
			}, nil
		}
		return nil, nil
	}

	service := &reconciliationServiceImpl{store: mockStore}

	actual, err := service.fetchActualState(context.Background(), "prj-123")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should skip invalid resources gracefully
	if actual.ResourceCount() != 0 {
		t.Errorf("expected 0 resources (invalid skipped), got %d", actual.ResourceCount())
	}
}

func TestFetchActualState_StoreError_ReturnsError(t *testing.T) {
	mockStore := newMockStore().withFindAllByFieldError(errors.New("connection refused"))
	service := &reconciliationServiceImpl{store: mockStore}

	_, err := service.fetchActualState(context.Background(), "prj-123")
	if err == nil {
		t.Error("expected error from store failure")
	}
}

func TestFetchActualState_UsesCorrectAnnotationPath(t *testing.T) {
	mockStore := newMockStore()
	service := &reconciliationServiceImpl{store: mockStore}

	projectID := "prj-test-annotation"
	_, _ = service.fetchActualState(context.Background(), projectID)

	expectedPath := "metadata.annotations." + ProjectOwnershipAnnotation
	if mockStore.capturedFieldPath != expectedPath {
		t.Errorf("expected fieldPath '%s', got '%s'", expectedPath, mockStore.capturedFieldPath)
	}
	if mockStore.capturedProjectID != projectID {
		t.Errorf("expected projectID '%s', got '%s'", projectID, mockStore.capturedProjectID)
	}
}

// =============================================================================
// D. Options Behavior Tests (5 tests)
// =============================================================================

func TestReconcile_DryRun_ReturnsFullPlan(t *testing.T) {
	mockStore := newMockStore()
	service := NewReconciliationService(mockStore, nil)

	// Project with resources to create
	project := createServiceTestProjectWithAgents(
		createServiceTestAgent("agent-1", "First"),
		createServiceTestAgent("agent-2", "Second"),
	)

	result, err := service.Reconcile(context.Background(), project, DryRunOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Dry run should still show what would be created
	summary := result.ToProtoSummary()
	if len(summary.Created) != 2 {
		t.Errorf("expected 2 creates in dry-run result, got %d", len(summary.Created))
	}
}

func TestReconcile_DryRun_DoesNotModifyActualState(t *testing.T) {
	// With dry run, even if there would be creates, actual state shouldn't change
	// Since executePlan is stubbed in D4, this test validates the dry-run path
	// returns without calling the stub

	mockStore := newMockStore()
	service := NewReconciliationService(mockStore, nil)

	project := createServiceTestProjectWithAgents(createServiceTestAgent("new-agent", "test"))

	result, err := service.Reconcile(context.Background(), project, DryRunOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Result should show the create
	if result.TotalChanges() != 1 {
		t.Errorf("expected 1 change in dry-run, got %d", result.TotalChanges())
	}
}

func TestReconcile_PruneDisabled_NoDeletes(t *testing.T) {
	// Store has an orphan resource
	orphan := createServiceTestAgentWithID("orphan", "To be deleted", "agt-orphan")
	mockStore := newMockStore().withAgents(orphan)
	service := NewReconciliationService(mockStore, nil)

	// Project has no agents (orphan should be deleted normally)
	project := createServiceTestProject("Empty Project")

	result, err := service.Reconcile(context.Background(), project, NoPruneOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// With prune disabled, no deletes should be reported
	summary := result.ToProtoSummary()
	if len(summary.Deleted) != 0 {
		t.Errorf("expected 0 deletes with prune disabled, got %d", len(summary.Deleted))
	}
}

func TestReconcile_PruneEnabled_IncludesDeletes(t *testing.T) {
	// Store has an orphan resource
	orphan := createServiceTestAgentWithID("orphan", "To be deleted", "agt-orphan")
	mockStore := newMockStore().withAgents(orphan)
	service := NewReconciliationService(mockStore, nil)

	// Project has no agents (orphan should be detected)
	project := createServiceTestProject("Empty Project")

	result, err := service.Reconcile(context.Background(), project, DefaultOptions()) // prune enabled
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// With prune enabled, the orphan should be in deletes
	summary := result.ToProtoSummary()
	if len(summary.Deleted) != 1 {
		t.Errorf("expected 1 delete with prune enabled, got %d", len(summary.Deleted))
	}
}

func TestReconcile_DefaultOptions_PruneEnabledNotDryRun(t *testing.T) {
	opts := DefaultOptions()

	if opts.IsDryRun() {
		t.Error("default options should not be dry-run")
	}
	if !opts.IsPruneEnabled() {
		t.Error("default options should have prune enabled")
	}
}

// =============================================================================
// E. Integration/End-to-End Tests (5 tests)
// =============================================================================

func TestReconcile_ComplexScenario_CorrectPlan(t *testing.T) {
	// Setup: Store has some existing resources
	// - agent-existing: same spec (no change)
	// - agent-update: different spec (update needed)
	// - agent-orphan: not in desired (delete)

	existingAgent := createServiceTestAgentWithID("agent-existing", "Same description", "agt-1")
	updateAgent := createServiceTestAgentWithID("agent-update", "Old description", "agt-2")
	orphanAgent := createServiceTestAgentWithID("agent-orphan", "To be deleted", "agt-3")

	mockStore := newMockStore().withAgents(existingAgent, updateAgent, orphanAgent)
	service := NewReconciliationService(mockStore, nil)

	// Desired state:
	// - agent-existing: same spec (no change)
	// - agent-update: new description (update)
	// - agent-new: doesn't exist (create)
	project := createServiceTestProjectWithAgents(
		createServiceTestAgent("agent-existing", "Same description"),
		createServiceTestAgent("agent-update", "New description"),
		createServiceTestAgent("agent-new", "Brand new"),
	)

	result, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	summary := result.ToProtoSummary()

	// Expected: 1 create, 1 update, 1 delete
	if len(summary.Created) != 1 {
		t.Errorf("expected 1 create, got %d", len(summary.Created))
	}
	if len(summary.Updated) != 1 {
		t.Errorf("expected 1 update, got %d", len(summary.Updated))
	}
	if len(summary.Deleted) != 1 {
		t.Errorf("expected 1 delete, got %d", len(summary.Deleted))
	}
}

func TestReconcile_UpdateDetectsSpecChanges(t *testing.T) {
	// Existing agent with one description
	existing := createServiceTestAgentWithID("my-agent", "Original description", "agt-123")
	mockStore := newMockStore().withAgents(existing)
	service := NewReconciliationService(mockStore, nil)

	// Desired agent with different description
	project := createServiceTestProjectWithAgents(
		createServiceTestAgent("my-agent", "Modified description"),
	)

	result, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	summary := result.ToProtoSummary()
	if len(summary.Updated) != 1 {
		t.Errorf("expected 1 update for spec change, got %d", len(summary.Updated))
	}
}

func TestReconcile_UpdateIgnoresMetadataChanges(t *testing.T) {
	// Existing agent with ID and timestamps
	existing := createServiceTestAgentWithID("my-agent", "Same description", "agt-123")
	mockStore := newMockStore().withAgents(existing)
	service := NewReconciliationService(mockStore, nil)

	// Desired agent without ID (as it would come from SDK)
	desired := createServiceTestAgent("my-agent", "Same description")
	// Explicitly ensure no ID (simulating SDK input)
	desired.Metadata.Id = ""

	project := createServiceTestProjectWithAgents(desired)

	result, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should not trigger update - only spec matters
	if result.TotalChanges() != 0 {
		t.Errorf("expected 0 changes (metadata-only difference), got %d", result.TotalChanges())
	}
}

func TestReconcile_OrphanDetection(t *testing.T) {
	// Store has resources that aren't in desired state
	orphan1 := createServiceTestAgentWithID("orphan-1", "desc", "agt-o1")
	orphan2 := createServiceTestWorkflowWithID("orphan-wf", "desc", "wf-o1")

	mockStore := newMockStore().
		withAgents(orphan1).
		withWorkflows(orphan2)

	service := NewReconciliationService(mockStore, nil)

	// Empty project - all existing resources are orphans
	project := createServiceTestProject("Empty")

	result, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	summary := result.ToProtoSummary()
	if len(summary.Deleted) != 2 {
		t.Errorf("expected 2 orphans detected, got %d", len(summary.Deleted))
	}
}

func TestReconcile_MixedResourceTypes_AllProcessed(t *testing.T) {
	// Test that all four resource types are processed correctly
	mockStore := newMockStore()
	service := NewReconciliationService(mockStore, nil)

	project := createServiceTestProject("Mixed")
	project.Spec.Agents = []*agentv1.Agent{
		createServiceTestAgent("agent-1", "Agent 1"),
		createServiceTestAgent("agent-2", "Agent 2"),
	}
	project.Spec.Workflows = []*workflowv1.Workflow{
		createServiceTestWorkflow("workflow-1", "Workflow 1"),
	}
	project.Spec.McpServers = []*mcpserverv1.McpServer{
		createServiceTestMcpServer("mcp-1", "MCP 1"),
		createServiceTestMcpServer("mcp-2", "MCP 2"),
		createServiceTestMcpServer("mcp-3", "MCP 3"),
	}
	project.Spec.Skills = []*skillv1.Skill{
		createServiceTestSkill("skill-1", "Skill 1"),
	}

	result, err := service.Reconcile(context.Background(), project, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should have 7 creates total
	summary := result.ToProtoSummary()
	if len(summary.Created) != 7 {
		t.Errorf("expected 7 creates (2+1+3+1), got %d", len(summary.Created))
	}
}
