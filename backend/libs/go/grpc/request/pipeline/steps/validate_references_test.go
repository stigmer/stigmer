package steps

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// mockStore is a minimal store for unit tests that only supports ListResources.
type mockStore struct {
	resources map[apiresourcekind.ApiResourceKind][][]byte
}

func newMockStore() *mockStore {
	return &mockStore{
		resources: make(map[apiresourcekind.ApiResourceKind][][]byte),
	}
}

func (m *mockStore) addResource(kind apiresourcekind.ApiResourceKind, msg proto.Message) {
	data, _ := proto.Marshal(msg)
	m.resources[kind] = append(m.resources[kind], data)
}

func (m *mockStore) ListResources(_ context.Context, kind apiresourcekind.ApiResourceKind) ([][]byte, error) {
	return m.resources[kind], nil
}

func (m *mockStore) SaveResource(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string, _ proto.Message) error {
	return nil
}
func (m *mockStore) GetResource(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string, _ proto.Message) error {
	return store.ErrNotFound
}
func (m *mockStore) UpdateResource(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string, _ proto.Message, _ func() error) error {
	return nil
}
func (m *mockStore) DeleteResource(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string) error {
	return nil
}
func (m *mockStore) FindByField(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string, _ string, _ proto.Message) error {
	return store.ErrNotFound
}
func (m *mockStore) FindAllByField(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string, _ string) ([][]byte, error) {
	return nil, nil
}
func (m *mockStore) FindByLabel(_ context.Context, _ apiresourcekind.ApiResourceKind, _, _ string, _ proto.Message) error {
	return store.ErrNotFound
}
func (m *mockStore) FindAllByLabel(_ context.Context, _ apiresourcekind.ApiResourceKind, _, _ string, _ proto.Message) ([][]byte, error) {
	return nil, nil
}
func (m *mockStore) DeleteResourcesByKind(_ context.Context, _ apiresourcekind.ApiResourceKind) (int64, error) {
	return 0, nil
}
func (m *mockStore) DeleteResourcesByIdPrefix(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string) (int64, error) {
	return 0, nil
}
func (m *mockStore) SaveAudit(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string, _ proto.Message, _, _ string) error {
	return nil
}
func (m *mockStore) GetAuditByHash(_ context.Context, _ apiresourcekind.ApiResourceKind, _, _ string, _ proto.Message) error {
	return store.ErrAuditNotFound
}
func (m *mockStore) GetAuditByTag(_ context.Context, _ apiresourcekind.ApiResourceKind, _, _ string, _ proto.Message) error {
	return store.ErrAuditNotFound
}
func (m *mockStore) ListAuditHistory(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string) ([][]byte, error) {
	return nil, nil
}
func (m *mockStore) DeleteAuditByResourceId(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string) (int64, error) {
	return 0, nil
}
func (m *mockStore) AppendWorkflowExecutionEvents(_ context.Context, _ string, _ []*store.WorkflowExecutionEventRecord) (int, error) {
	return 0, nil
}
func (m *mockStore) GetWorkflowExecutionEvents(_ context.Context, _ string, _ int64, _ string, _ string, _ int) ([]*store.WorkflowExecutionEventRecord, error) {
	return nil, nil
}
func (m *mockStore) GetMaxEventSequence(_ context.Context, _ string) (int64, error) {
	return 0, nil
}
func (m *mockStore) UpsertSearchIndex(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string, _ *store.SearchIndexEntry) error {
	return nil
}
func (m *mockStore) DeleteSearchIndex(_ context.Context, _ apiresourcekind.ApiResourceKind, _ string) error {
	return nil
}
func (m *mockStore) Close() error { return nil }

func TestValidateReferencesStep_Name(t *testing.T) {
	step := NewValidateReferencesStep[*agentv1.Agent](newMockStore())
	if step.Name() != "ValidateReferences" {
		t.Errorf("Expected Name()=ValidateReferences, got %q", step.Name())
	}
}

func TestValidateReferencesStep_ValidMcpServer(t *testing.T) {
	s := newMockStore()
	s.addResource(apiresourcekind.ApiResourceKind_mcp_server, &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Postgres",
			Slug: "postgres",
			Org:  "acme",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "PostgreSQL MCP server",
		},
	})

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "postgres",
						Org:  "acme",
					},
				},
			},
		},
	}

	step := NewValidateReferencesStep[*agentv1.Agent](s)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("expected no error for valid MCP server ref, got: %v", err)
	}
}

func TestValidateReferencesStep_MissingMcpServer(t *testing.T) {
	s := newMockStore()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "nonexistent-server",
						Org:  "acme",
					},
				},
			},
		},
	}

	step := NewValidateReferencesStep[*agentv1.Agent](s)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)
	if err == nil {
		t.Fatal("expected error for missing MCP server ref, got nil")
	}

	errMsg := err.Error()
	if !contains(errMsg, "nonexistent-server") {
		t.Errorf("error should mention the missing slug, got: %s", errMsg)
	}
	if !contains(errMsg, "acme") {
		t.Errorf("error should mention the org, got: %s", errMsg)
	}
}

func TestValidateReferencesStep_CrossOrgMcpServer(t *testing.T) {
	s := newMockStore()
	s.addResource(apiresourcekind.ApiResourceKind_mcp_server, &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Postgres",
			Slug: "postgres",
			Org:  "stigmer",
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "PostgreSQL MCP server (seedpack)",
		},
	})

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "postgres",
						Org:  "stigmer",
					},
				},
			},
		},
	}

	step := NewValidateReferencesStep[*agentv1.Agent](s)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("expected no error for valid cross-org MCP server ref, got: %v", err)
	}
}

func TestValidateReferencesStep_WrongOrgFails(t *testing.T) {
	s := newMockStore()
	s.addResource(apiresourcekind.ApiResourceKind_mcp_server, &mcpserverv1.McpServer{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "Postgres",
			Slug: "postgres",
			Org:  "stigmer",
		},
		Spec: &mcpserverv1.McpServerSpec{},
	})

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "postgres",
						Org:  "acme",
					},
				},
			},
		},
	}

	step := NewValidateReferencesStep[*agentv1.Agent](s)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)
	if err == nil {
		t.Fatal("expected error when MCP server is in wrong org, got nil")
	}
}

func TestValidateReferencesStep_MultipleMissingRefs(t *testing.T) {
	s := newMockStore()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "missing-server-1",
						Org:  "acme",
					},
				},
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "missing-server-2",
						Org:  "acme",
					},
				},
			},
		},
	}

	step := NewValidateReferencesStep[*agentv1.Agent](s)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	err := step.Execute(ctx)
	if err == nil {
		t.Fatal("expected error for multiple missing MCP servers, got nil")
	}

	errMsg := err.Error()
	if !contains(errMsg, "missing-server-1") {
		t.Errorf("error should mention first missing slug, got: %s", errMsg)
	}
	if !contains(errMsg, "missing-server-2") {
		t.Errorf("error should mention second missing slug, got: %s", errMsg)
	}
}

func TestValidateReferencesStep_NoRefsIsNoop(t *testing.T) {
	s := newMockStore()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
		},
	}

	step := NewValidateReferencesStep[*agentv1.Agent](s)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("expected no error for agent without refs, got: %v", err)
	}
}

func TestValidateReferencesStep_EmptySlugSkipped(t *testing.T) {
	s := newMockStore()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			McpServerUsages: []*agentv1.McpServerUsage{
				{
					McpServerRef: &apiresource.ApiResourceReference{
						Kind: apiresourcekind.ApiResourceKind_mcp_server,
						Slug: "",
						Org:  "acme",
					},
				},
			},
		},
	}

	step := NewValidateReferencesStep[*agentv1.Agent](s)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("expected no error for empty slug (should be skipped), got: %v", err)
	}
}

func TestValidateReferencesStep_SkillRefsNotValidated(t *testing.T) {
	s := newMockStore()

	agent := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "test-agent",
			Org:  "acme",
		},
		Spec: &agentv1.AgentSpec{
			Instructions: "You are a test agent",
			SkillRefs: []*apiresource.ApiResourceReference{
				{
					Kind: apiresourcekind.ApiResourceKind_skill,
					Slug: "nonexistent-skill",
					Org:  "acme",
				},
			},
		},
	}

	step := NewValidateReferencesStep[*agentv1.Agent](s)
	ctx := pipeline.NewRequestContext(context.Background(), agent)
	ctx.SetNewState(agent)

	// Skill refs are not validated (only MCP servers are strict)
	if err := step.Execute(ctx); err != nil {
		t.Fatalf("expected no error for missing skill ref (not strict), got: %v", err)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstring(s, substr))
}

func containsSubstring(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
