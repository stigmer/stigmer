package stigmer

// Wire coverage for the credential inputs the generator writes: a
// credential's owner oneof and a surface's credential assignments.
//
// A credential belongs to a person or to its organization. The input
// declares no second org: with no person set, the credential is the
// organization's, named by the input's own org; a person, once set, holds
// the oneof. An assignment's source is a credential's field or a plain
// literal, and its requirement names the declarer through a target oneof
// whose git-host member is a plain string. Both scalar oneof members are
// held by their wrapper types, a path no other input took before.
//
// Like input_conversion_test.go, these drive the checked-in generated code
// through the public Create call and read the exact wire message from an
// in-memory gRPC server.

import (
	"context"
	"net"
	"testing"

	agentchannelv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/agentchannel/v1"
	credentialv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/credential/v1"
	"github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"google.golang.org/grpc"
	"google.golang.org/grpc/test/bufconn"
)

type credentialCaptureServer struct {
	credentialv1.UnimplementedCredentialCommandControllerServer
	last *credentialv1.Credential
}

func (s *credentialCaptureServer) Create(_ context.Context, req *credentialv1.Credential) (*credentialv1.Credential, error) {
	s.last = req
	return req, nil
}

type channelCaptureServer struct {
	agentchannelv1.UnimplementedAgentChannelCommandControllerServer
	last *agentchannelv1.AgentChannel
}

func (s *channelCaptureServer) Create(_ context.Context, req *agentchannelv1.AgentChannel) (*agentchannelv1.AgentChannel, error) {
	s.last = req
	return req, nil
}

func newCredentialCaptureClient(t *testing.T, register func(*grpc.Server)) *Client {
	t.Helper()

	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	register(srv)
	go func() { _ = srv.Serve(lis) }()

	client, err := NewClient(
		WithBaseURL("passthrough:///bufnet"),
		WithInsecure(),
		WithDialOptions(grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		})),
	)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	t.Cleanup(func() {
		_ = client.Close()
		srv.Stop()
		_ = lis.Close()
	})
	return client
}

func createCredential(t *testing.T, input *CredentialInput) *credentialv1.Credential {
	t.Helper()
	capture := &credentialCaptureServer{}
	client := newCredentialCaptureClient(t, func(s *grpc.Server) {
		credentialv1.RegisterCredentialCommandControllerServer(s, capture)
	})
	if _, err := client.Credential.Create(context.Background(), input); err != nil {
		t.Fatalf("Create: %v", err)
	}
	return capture.last
}

func TestCredentialInput_NoPersonIsTheOrganizations(t *testing.T) {
	got := createCredential(t, &CredentialInput{
		Name: "Datadog",
		Org:  "acme",
		Fields: map[string]*CredentialFieldInput{
			"DD_API_KEY": {Value: "dd-secret"},
		},
	})

	if org, ok := got.GetSpec().GetOwner().(*credentialv1.CredentialSpec_Org); !ok || org.Org != "acme" {
		t.Fatalf("owner = %#v, want org %q", got.GetSpec().GetOwner(), "acme")
	}
	if got.GetMetadata().GetOrg() != "acme" {
		t.Errorf("metadata.org = %q, want %q", got.GetMetadata().GetOrg(), "acme")
	}
	if v := got.GetSpec().GetFields()["DD_API_KEY"].GetValue(); v != "dd-secret" {
		t.Errorf("fields[DD_API_KEY].value = %q, want %q", v, "dd-secret")
	}
}

func TestCredentialInput_PersonHoldsTheOwner(t *testing.T) {
	got := createCredential(t, &CredentialInput{
		Name:   "My GitHub token",
		Org:    "acme",
		Person: "idac_ada",
		Serves: []*CredentialTargetInput{{GitHost: "github.com"}},
	})

	if p, ok := got.GetSpec().GetOwner().(*credentialv1.CredentialSpec_Person); !ok || p.Person != "idac_ada" {
		t.Fatalf("owner = %#v, want person %q", got.GetSpec().GetOwner(), "idac_ada")
	}
	if host := got.GetSpec().GetServes()[0].GetGitHost(); host != "github.com" {
		t.Errorf("serves[0].git_host = %q, want %q", host, "github.com")
	}
}

func TestAgentChannelInput_CredentialAssignmentsReachTheWire(t *testing.T) {
	capture := &channelCaptureServer{}
	client := newCredentialCaptureClient(t, func(s *grpc.Server) {
		agentchannelv1.RegisterAgentChannelCommandControllerServer(s, capture)
	})

	_, err := client.AgentChannel.Create(context.Background(), &AgentChannelInput{
		Name: "support",
		Org:  "acme",
		Credentials: []*CredentialAssignmentInput{
			{
				Requirement: &RequirementRefInput{
					Declarer: &CredentialTargetInput{McpServer: ResourceRef{Org: "acme", Slug: "github-mcp"}},
					Key:      "GITHUB_TOKEN",
				},
				Credential: &CredentialFieldRefInput{
					Credential: ResourceRef{Org: "acme", Slug: "bot-token"},
					Field:      "GITHUB_TOKEN",
				},
			},
			{
				Requirement: &RequirementRefInput{
					Declarer: &CredentialTargetInput{GitHost: "github.com"},
					Key:      "GIT_USER",
				},
				Literal: "stigmer-bot",
			},
		},
	})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}

	assignments := capture.last.GetSpec().GetCredentials()
	if len(assignments) != 2 {
		t.Fatalf("credentials = %d entries, want 2", len(assignments))
	}

	first := assignments[0]
	declarer := first.GetRequirement().GetDeclarer().GetMcpServer()
	if declarer.GetSlug() != "github-mcp" || declarer.GetKind() != apiresourcekind.ApiResourceKind_mcp_server {
		t.Errorf("credentials[0] declarer = %v, want mcp_server github-mcp", declarer)
	}
	ref := first.GetCredential()
	if ref.GetField() != "GITHUB_TOKEN" || ref.GetCredential().GetKind() != apiresourcekind.ApiResourceKind_credential {
		t.Errorf("credentials[0] source = %v, want credential bot-token field GITHUB_TOKEN", ref)
	}

	second := assignments[1]
	if host := second.GetRequirement().GetDeclarer().GetGitHost(); host != "github.com" {
		t.Errorf("credentials[1] declarer git_host = %q, want %q", host, "github.com")
	}
	if lit, ok := second.GetSource().(*credentialv1.CredentialAssignment_Literal); !ok || lit.Literal != "stigmer-bot" {
		t.Errorf("credentials[1] source = %#v, want literal %q", second.GetSource(), "stigmer-bot")
	}
}
