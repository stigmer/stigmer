package agents

import (
	"context"
	"encoding/json"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/mcp-server/internal/auth"
	"github.com/stigmer/stigmer/mcp-server/internal/domains"
	"github.com/stigmer/stigmer/mcp-server/internal/testutil"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type mockAgentCommandController struct {
	agentv1.UnimplementedAgentCommandControllerServer
	gotAgent *agentv1.Agent
	resp     *agentv1.Agent
	err      error
}

func (m *mockAgentCommandController) Apply(_ context.Context, agent *agentv1.Agent) (*agentv1.Agent, error) {
	m.gotAgent = agent
	return m.resp, m.err
}

func TestApplyTool_metadata(t *testing.T) {
	tool := ApplyTool()
	if tool.Name != "apply_agent" {
		t.Errorf("Name = %q, want %q", tool.Name, "apply_agent")
	}
	if tool.Description == "" {
		t.Error("Description is empty, want non-empty")
	}
}

func TestApplyHandler_success(t *testing.T) {
	mock := &mockAgentCommandController{
		resp: &agentv1.Agent{
			ApiVersion: "agentic.stigmer.ai/v1",
			Kind:       "Agent",
			Metadata: &apiresource.ApiResourceMetadata{
				Org:  "acme",
				Slug: "code-reviewer",
				Name: "Code Reviewer",
				Id:   "agent-123",
			},
		},
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		agentv1.RegisterAgentCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ApplyHandler(addr)

	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name: "Code Reviewer",
			Slug: "code-reviewer",
			Org:  "acme",
		},
		Instructions: "You are a code reviewer.",
	}

	result, _, err := handler(ctx, nil, input)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if mock.gotAgent == nil {
		t.Fatal("mock never received a request")
	}
	if mock.gotAgent.GetMetadata().GetOrg() != "acme" {
		t.Errorf("Org = %q, want %q", mock.gotAgent.GetMetadata().GetOrg(), "acme")
	}
	if mock.gotAgent.GetMetadata().GetSlug() != "code-reviewer" {
		t.Errorf("Slug = %q, want %q", mock.gotAgent.GetMetadata().GetSlug(), "code-reviewer")
	}

	text := extractText(t, result)
	var raw map[string]any
	if err := json.Unmarshal([]byte(text), &raw); err != nil {
		t.Fatalf("response is not valid JSON: %v\ntext: %s", err, text)
	}
	if raw["api_version"] != "agentic.stigmer.ai/v1" {
		t.Errorf("api_version = %v, want %q", raw["api_version"], "agentic.stigmer.ai/v1")
	}
}

func TestApplyHandler_missingAPIKey(t *testing.T) {
	handler := ApplyHandler("localhost:0")

	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name: "Test Agent",
			Org:  "acme",
		},
		Instructions: "test instructions",
	}
	_, _, err := handler(context.Background(), nil, input)
	if err == nil {
		t.Fatal("expected error when API key is missing from context, got nil")
	}
}

func TestApplyHandler_grpcPermissionDenied(t *testing.T) {
	mock := &mockAgentCommandController{
		err: status.Error(codes.PermissionDenied, "unauthorized"),
	}

	addr := testutil.StartGRPCServer(t, func(s *grpc.Server) {
		agentv1.RegisterAgentCommandControllerServer(s, mock)
	})

	ctx := auth.WithAPIKey(context.Background(), "test-key")
	handler := ApplyHandler(addr)

	input := &ApplyAgentInput{
		ResourceIdentity: domains.ResourceIdentity{
			Name: "Test Agent",
			Slug: "x",
			Org:  "acme",
		},
		Instructions: "test instructions",
	}
	_, _, err := handler(ctx, nil, input)
	if err == nil {
		t.Fatal("expected error for PermissionDenied, got nil")
	}
}
