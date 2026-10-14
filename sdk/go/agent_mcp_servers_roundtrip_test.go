package stigmer

// Pins that the generated AgentInput carries the MCP servers written in an
// agent itself (spec.mcp_servers: name, url, headers) to the wire and back.
// The forward direction drives the checked-in generated toProto through
// AgentClient.Apply against an in-memory server that captures the exact
// wire message; the reverse direction reads that message back through the
// exported AgentInputFromProto. The file lives at the SDK root because
// internal/gen is wiped and regenerated wholesale.

import (
	"context"
	"net"
	"testing"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	agentv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/agent/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/test/bufconn"
)

const (
	mcpServerName   = "zendesk"
	mcpServerURL    = "https://acme-co.zendesk.com/mcp"
	mcpHeaderName   = "X-Api-Key"
	mcpHeaderValue  = "${ZENDESK_KEY}"
	mcpAgentOrgSlug = "acme"
)

type agentCaptureServer struct {
	agentv1.UnimplementedAgentCommandControllerServer
	lastAgent *agentv1.Agent
}

func (s *agentCaptureServer) Apply(_ context.Context, req *agentv1.Agent) (*agentv1.Agent, error) {
	s.lastAgent = req
	return req, nil
}

func newAgentCaptureClient(t *testing.T) (*AgentClient, *agentCaptureServer) {
	t.Helper()

	capture := &agentCaptureServer{}
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	agentv1.RegisterAgentCommandControllerServer(srv, capture)

	go func() { _ = srv.Serve(lis) }()

	conn, err := grpc.NewClient("passthrough:///bufnet",
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
	)
	if err != nil {
		t.Fatalf("grpc.NewClient: %v", err)
	}

	t.Cleanup(func() {
		_ = conn.Close()
		srv.Stop()
		_ = lis.Close()
	})

	return gen.NewAgentClient(conn), capture
}

func TestAgentApply_CarriesMcpServersToTheWireAndBack(t *testing.T) {
	client, capture := newAgentCaptureClient(t)

	_, err := client.Apply(context.Background(), &AgentInput{
		Name:         "Support bot",
		Org:          mcpAgentOrgSlug,
		Instructions: "Answer tickets.",
		McpServers: []*AgentMcpServerInput{{
			Name:    mcpServerName,
			Url:     mcpServerURL,
			Headers: map[string]string{mcpHeaderName: mcpHeaderValue},
		}},
	})
	if err != nil {
		t.Fatalf("Agent.Apply: %v", err)
	}

	servers := capture.lastAgent.GetSpec().GetMcpServers()
	if len(servers) != 1 {
		t.Fatalf("wire mcp_servers = %d, want 1", len(servers))
	}
	wire := servers[0]
	if wire.GetName() != mcpServerName {
		t.Errorf("wire name = %q, want %q", wire.GetName(), mcpServerName)
	}
	if wire.GetUrl() != mcpServerURL {
		t.Errorf("wire url = %q, want %q", wire.GetUrl(), mcpServerURL)
	}
	if got := wire.GetHeaders(); len(got) != 1 || got[mcpHeaderName] != mcpHeaderValue {
		t.Errorf("wire headers = %v, want {%s: %s}", got, mcpHeaderName, mcpHeaderValue)
	}

	back := AgentInputFromProto(capture.lastAgent)
	if len(back.McpServers) != 1 {
		t.Fatalf("round-trip McpServers = %d, want 1", len(back.McpServers))
	}
	in := back.McpServers[0]
	if in.Name != mcpServerName || in.Url != mcpServerURL {
		t.Errorf("round-trip server = %q %q, want %q %q", in.Name, in.Url, mcpServerName, mcpServerURL)
	}
	if len(in.Headers) != 1 || in.Headers[mcpHeaderName] != mcpHeaderValue {
		t.Errorf("round-trip headers = %v, want {%s: %s}", in.Headers, mcpHeaderName, mcpHeaderValue)
	}
}
