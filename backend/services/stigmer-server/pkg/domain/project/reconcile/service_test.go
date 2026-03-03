package reconcile

import (
	"context"
	"fmt"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"google.golang.org/protobuf/proto"
)

// ---------------------------------------------------------------------------
// Fake downstream clients for test isolation
// ---------------------------------------------------------------------------

type fakeAgentClient struct {
	deletedID string
	deleteErr error
}

func (f *fakeAgentClient) Create(_ context.Context, a *agentv1.Agent) (*agentv1.Agent, error) {
	return a, nil
}
func (f *fakeAgentClient) Update(_ context.Context, a *agentv1.Agent) (*agentv1.Agent, error) {
	return a, nil
}
func (f *fakeAgentClient) Delete(_ context.Context, id string) (*agentv1.Agent, error) {
	f.deletedID = id
	return nil, f.deleteErr
}

type fakeWorkflowClient struct {
	deletedID string
	deleteErr error
}

func (f *fakeWorkflowClient) Create(_ context.Context, w *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	return w, nil
}
func (f *fakeWorkflowClient) Update(_ context.Context, w *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	return w, nil
}
func (f *fakeWorkflowClient) Delete(_ context.Context, id string) (*workflowv1.Workflow, error) {
	f.deletedID = id
	return nil, f.deleteErr
}

type fakeMcpServerClient struct {
	deletedID string
	deleteErr error
}

func (f *fakeMcpServerClient) Create(_ context.Context, s *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	return s, nil
}
func (f *fakeMcpServerClient) Update(_ context.Context, s *mcpserverv1.McpServer) (*mcpserverv1.McpServer, error) {
	return s, nil
}
func (f *fakeMcpServerClient) Delete(_ context.Context, id string) (*mcpserverv1.McpServer, error) {
	f.deletedID = id
	return nil, f.deleteErr
}

type fakeSkillClient struct {
	deletedID string
	deleteErr error
}

func (f *fakeSkillClient) Push(_ context.Context, _ *skillv1.PushSkillRequest) (*skillv1.Skill, error) {
	return nil, nil
}
func (f *fakeSkillClient) Delete(_ context.Context, id string) (*skillv1.Skill, error) {
	f.deletedID = id
	return nil, f.deleteErr
}

// ---------------------------------------------------------------------------
// Helper to create a test store and seed a resource
// ---------------------------------------------------------------------------

func setupTestStore(t *testing.T) *sqlite.Store {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	if err != nil {
		t.Fatalf("failed to create test store: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func seedAgent(t *testing.T, s *sqlite.Store, id, slug string) {
	t.Helper()
	agent := &agentv1.Agent{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: slug,
			Slug: slug,
			Org:  "local",
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_agent, id, agent); err != nil {
		t.Fatalf("failed to seed agent: %v", err)
	}
}

func seedWorkflow(t *testing.T, s *sqlite.Store, id, slug string) {
	t.Helper()
	wf := &workflowv1.Workflow{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   id,
			Name: slug,
			Slug: slug,
			Org:  "local",
		},
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_workflow, id, wf); err != nil {
		t.Fatalf("failed to seed workflow: %v", err)
	}
}

func ref(kind apiresourcekind.ApiResourceKind, slug string) *apiresource.ApiResourceReference {
	return &apiresource.ApiResourceReference{
		Org:  "local",
		Kind: kind,
		Slug: slug,
	}
}

// ---------------------------------------------------------------------------
// Tests: Reconcile — set difference logic
// ---------------------------------------------------------------------------

func TestReconcile_BothNil(t *testing.T) {
	s := setupTestStore(t)
	svc := NewReconciliationService(s, nil)

	result, err := svc.Reconcile(context.Background(), nil, nil, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != EmptyResult() {
		t.Error("expected empty result for nil members")
	}
}

func TestReconcile_BothEmpty(t *testing.T) {
	s := setupTestStore(t)
	svc := NewReconciliationService(s, nil)

	result, err := svc.Reconcile(context.Background(),
		[]*apiresource.ApiResourceReference{},
		[]*apiresource.ApiResourceReference{},
		DefaultOptions(),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != EmptyResult() {
		t.Error("expected empty result for empty members")
	}
}

func TestReconcile_NoChanges(t *testing.T) {
	s := setupTestStore(t)
	svc := NewReconciliationService(s, nil)

	members := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "my-agent"),
	}

	result, err := svc.Reconcile(context.Background(), members, members, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != EmptyResult() {
		t.Error("expected empty result when previous == current")
	}
}

func TestReconcile_FirstApply_AllAdded(t *testing.T) {
	s := setupTestStore(t)
	svc := NewReconciliationService(s, nil)

	current := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "agent-1"),
		ref(apiresourcekind.ApiResourceKind_workflow, "wf-1"),
	}

	result, err := svc.Reconcile(context.Background(), nil, current, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.AddedCount() != 2 {
		t.Errorf("expected 2 added, got %d", result.AddedCount())
	}
	if result.RemovedCount() != 0 {
		t.Errorf("expected 0 removed, got %d", result.RemovedCount())
	}
}

func TestReconcile_OrphansDetected_PruneDisabled(t *testing.T) {
	s := setupTestStore(t)
	svc := NewReconciliationService(s, nil)

	previous := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "old-agent"),
	}

	result, err := svc.Reconcile(context.Background(), previous, nil, NoPruneOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.RemovedCount() != 0 {
		t.Errorf("expected 0 removed with prune disabled, got %d", result.RemovedCount())
	}
}

func TestReconcile_DryRun_ReportsOrphansWithoutDeleting(t *testing.T) {
	s := setupTestStore(t)
	deleter := &mockResourceDeleter{}
	svc := NewReconciliationService(s, deleter)

	previous := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "orphan-agent"),
	}

	result, err := svc.Reconcile(context.Background(), previous, nil, DryRunOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.RemovedCount() != 1 {
		t.Errorf("expected 1 removed in dry-run, got %d", result.RemovedCount())
	}
	if len(deleter.calls) != 0 {
		t.Errorf("expected no delete calls in dry-run, got %d", len(deleter.calls))
	}
}

func TestReconcile_OrphanDeletion_Success(t *testing.T) {
	s := setupTestStore(t)
	seedAgent(t, s, "agent-id-1", "old-agent")

	agentClient := &fakeAgentClient{}
	deleter := NewResourceDeleterAdapter(&DownstreamClients{
		AgentClient: agentClient,
	})
	svc := NewReconciliationService(s, deleter)

	previous := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "old-agent"),
	}
	current := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "new-agent"),
	}

	result, err := svc.Reconcile(context.Background(), previous, current, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.AddedCount() != 1 {
		t.Errorf("expected 1 added, got %d", result.AddedCount())
	}
	if result.RemovedCount() != 1 {
		t.Errorf("expected 1 removed, got %d", result.RemovedCount())
	}
	if agentClient.deletedID != "agent-id-1" {
		t.Errorf("expected agent 'agent-id-1' to be deleted, got %q", agentClient.deletedID)
	}
	if !result.IsSuccess() {
		t.Error("expected reconciliation to be successful")
	}
}

func TestReconcile_OrphanDeletion_ResolutionFailure(t *testing.T) {
	s := setupTestStore(t)
	// Do NOT seed the agent — resolution will fail
	deleter := &mockResourceDeleter{}
	svc := NewReconciliationService(s, deleter)

	previous := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "ghost-agent"),
	}

	result, err := svc.Reconcile(context.Background(), previous, nil, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.RemovedCount() != 0 {
		t.Errorf("expected 0 removed (resolution failed), got %d", result.RemovedCount())
	}
	if result.ErrorCount() != 1 {
		t.Errorf("expected 1 error, got %d", result.ErrorCount())
	}
	if len(deleter.calls) != 0 {
		t.Errorf("expected no delete calls when resolution fails, got %d", len(deleter.calls))
	}
}

func TestReconcile_OrphanDeletion_PartialFailure(t *testing.T) {
	s := setupTestStore(t)
	seedAgent(t, s, "agent-ok", "good-agent")
	seedWorkflow(t, s, "wf-fail", "bad-workflow")

	agentClient := &fakeAgentClient{}
	workflowClient := &fakeWorkflowClient{deleteErr: fmt.Errorf("permission denied")}
	deleter := NewResourceDeleterAdapter(&DownstreamClients{
		AgentClient:    agentClient,
		WorkflowClient: workflowClient,
	})
	svc := NewReconciliationService(s, deleter)

	previous := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "good-agent"),
		ref(apiresourcekind.ApiResourceKind_workflow, "bad-workflow"),
	}

	result, err := svc.Reconcile(context.Background(), previous, nil, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.RemovedCount() != 1 {
		t.Errorf("expected 1 removed (partial success), got %d", result.RemovedCount())
	}
	if result.ErrorCount() != 1 {
		t.Errorf("expected 1 error (partial failure), got %d", result.ErrorCount())
	}
	if result.IsSuccess() {
		t.Error("expected IsSuccess to be false for partial failure")
	}
}

func TestReconcile_MixedAddedAndRemoved(t *testing.T) {
	s := setupTestStore(t)
	seedAgent(t, s, "agent-id-old", "agent-old")

	agentClient := &fakeAgentClient{}
	deleter := NewResourceDeleterAdapter(&DownstreamClients{
		AgentClient: agentClient,
	})
	svc := NewReconciliationService(s, deleter)

	previous := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "agent-old"),
		ref(apiresourcekind.ApiResourceKind_agent, "agent-keep"),
	}
	current := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "agent-keep"),
		ref(apiresourcekind.ApiResourceKind_workflow, "wf-new"),
	}

	result, err := svc.Reconcile(context.Background(), previous, current, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result.AddedCount() != 1 {
		t.Errorf("expected 1 added (wf-new), got %d", result.AddedCount())
	}
	if result.RemovedCount() != 1 {
		t.Errorf("expected 1 removed (agent-old), got %d", result.RemovedCount())
	}
	if result.Added()[0].GetSlug() != "wf-new" {
		t.Errorf("expected added slug 'wf-new', got %q", result.Added()[0].GetSlug())
	}
	if result.Removed()[0].GetSlug() != "agent-old" {
		t.Errorf("expected removed slug 'agent-old', got %q", result.Removed()[0].GetSlug())
	}
}

func TestReconcile_NilDeleter_StubMode(t *testing.T) {
	s := setupTestStore(t)
	seedAgent(t, s, "agent-id", "orphan")
	svc := NewReconciliationService(s, nil)

	previous := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "orphan"),
	}

	result, err := svc.Reconcile(context.Background(), previous, nil, DefaultOptions())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Stub mode: orphans are resolved but not actually deleted (no deleter).
	// They still appear as removed in the result.
	if result.RemovedCount() != 1 {
		t.Errorf("expected 1 removed in stub mode, got %d", result.RemovedCount())
	}
}

func TestReconcile_NilOptions_UsesDefault(t *testing.T) {
	s := setupTestStore(t)
	svc := NewReconciliationService(s, nil)

	result, err := svc.Reconcile(context.Background(), nil, nil, nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result != EmptyResult() {
		t.Error("expected empty result")
	}
}

// ---------------------------------------------------------------------------
// Tests: internal helpers
// ---------------------------------------------------------------------------

func TestReferenceKey(t *testing.T) {
	r := ref(apiresourcekind.ApiResourceKind_agent, "my-agent")
	key := referenceKey(r)
	if key != "agent:my-agent" {
		t.Errorf("expected 'agent:my-agent', got %q", key)
	}
}

func TestBuildReferenceSet(t *testing.T) {
	refs := []*apiresource.ApiResourceReference{
		ref(apiresourcekind.ApiResourceKind_agent, "a1"),
		ref(apiresourcekind.ApiResourceKind_workflow, "w1"),
	}

	set := buildReferenceSet(refs)

	if len(set) != 2 {
		t.Errorf("expected set size 2, got %d", len(set))
	}
	if _, ok := set["agent:a1"]; !ok {
		t.Error("expected set to contain 'agent:a1'")
	}
	if _, ok := set["workflow:w1"]; !ok {
		t.Error("expected set to contain 'workflow:w1'")
	}
}

func TestNewProtoForKind(t *testing.T) {
	tests := []struct {
		kind     apiresourcekind.ApiResourceKind
		expected proto.Message
		wantErr  bool
	}{
		{apiresourcekind.ApiResourceKind_agent, &agentv1.Agent{}, false},
		{apiresourcekind.ApiResourceKind_workflow, &workflowv1.Workflow{}, false},
		{apiresourcekind.ApiResourceKind_mcp_server, &mcpserverv1.McpServer{}, false},
		{apiresourcekind.ApiResourceKind_skill, &skillv1.Skill{}, false},
		{apiresourcekind.ApiResourceKind_project, nil, true},
	}

	for _, tt := range tests {
		t.Run(tt.kind.String(), func(t *testing.T) {
			msg, err := newProtoForKind(tt.kind)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error for unsupported kind")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if msg.ProtoReflect().Descriptor().FullName() != tt.expected.ProtoReflect().Descriptor().FullName() {
				t.Errorf("wrong type: got %s, want %s",
					msg.ProtoReflect().Descriptor().FullName(),
					tt.expected.ProtoReflect().Descriptor().FullName())
			}
		})
	}
}
