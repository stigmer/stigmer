package stigmer

// The token client against an in-process TokenService: MintUserToken sends
// org, user id, email and name on the wire through the client's own
// connection and maps the token, its type and lifetime back with ExpiresAt
// computed at call time; an empty org or user id is refused as
// invalid-argument before any request; a server refusal surfaces as the
// SDK error carrying the server's code.

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	tokenv1 "go.stigmer.ai/sdk/proto/ai/stigmer/iam/token/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/proto"
)

// tokenCaptureServer records every mint request and answers with a fixed
// token, or with refusal when it is set.
type tokenCaptureServer struct {
	tokenv1.UnimplementedTokenServiceServer
	requests []*tokenv1.MintUserTokenRequest
	refusal  error
}

func (s *tokenCaptureServer) MintUserToken(_ context.Context, req *tokenv1.MintUserTokenRequest) (*tokenv1.MintUserTokenResponse, error) {
	s.requests = append(s.requests, proto.Clone(req).(*tokenv1.MintUserTokenRequest))
	if s.refusal != nil {
		return nil, s.refusal
	}
	return &tokenv1.MintUserTokenResponse{AccessToken: "stgm_jwt_abc", TokenType: "Bearer", ExpiresIn: 3600}, nil
}

func newTokenCaptureClient(t *testing.T) (*Client, *tokenCaptureServer) {
	t.Helper()

	capture := &tokenCaptureServer{}
	lis := bufconn.Listen(1024 * 1024)
	srv := grpc.NewServer()
	tokenv1.RegisterTokenServiceServer(srv, capture)

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

	return client, capture
}

func TestTokensMintUserToken_SendsThePersonAndMapsTheToken(t *testing.T) {
	client, capture := newTokenCaptureClient(t)

	before := time.Now()
	result, err := client.Tokens.MintUserToken(t.Context(), &MintUserTokenInput{
		Org:       "acme",
		UserID:    "user-123",
		UserEmail: "jane@acme.com",
		UserName:  "Jane Doe",
	})
	if err != nil {
		t.Fatalf("MintUserToken: %v", err)
	}

	if len(capture.requests) != 1 {
		t.Fatalf("requests = %d, want 1", len(capture.requests))
	}
	want := &tokenv1.MintUserTokenRequest{Org: "acme", UserId: "user-123", UserEmail: "jane@acme.com", UserName: "Jane Doe"}
	if !proto.Equal(capture.requests[0], want) {
		t.Errorf("request = %v, want %v", capture.requests[0], want)
	}

	if result.AccessToken != "stgm_jwt_abc" || result.TokenType != "Bearer" || result.ExpiresIn != 3600 {
		t.Errorf("result = %+v", result)
	}
	if result.ExpiresAt.Before(before.Add(time.Hour)) || result.ExpiresAt.After(time.Now().Add(time.Hour)) {
		t.Errorf("ExpiresAt = %v, want an hour after the call", result.ExpiresAt)
	}
}

func TestTokensMintUserToken_RefusesMissingOrgOrUserBeforeAnyRequest(t *testing.T) {
	cases := map[string]*MintUserTokenInput{
		"nil input":     nil,
		"empty org":     {UserID: "user-123"},
		"empty user id": {Org: "acme"},
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			client, capture := newTokenCaptureClient(t)

			_, err := client.Tokens.MintUserToken(t.Context(), input)
			var sdkErr *Error
			if !errors.As(err, &sdkErr) || sdkErr.Code != CodeInvalidArgument || sdkErr.GRPCCode != codes.InvalidArgument {
				t.Fatalf("err = %v, want an invalid-argument SDK error", err)
			}
			if len(capture.requests) != 0 {
				t.Errorf("requests = %d, want none", len(capture.requests))
			}
		})
	}
}

func TestTokensMintUserToken_ServerRefusalIsTheSDKError(t *testing.T) {
	client, capture := newTokenCaptureClient(t)
	capture.refusal = status.Error(codes.PermissionDenied, "only an admin service account may mint")

	result, err := client.Tokens.MintUserToken(t.Context(), &MintUserTokenInput{Org: "acme", UserID: "user-123"})
	if result != nil {
		t.Errorf("result = %+v, want nil", result)
	}
	var sdkErr *Error
	if !errors.As(err, &sdkErr) || sdkErr.Code != CodePermissionDenied || !IsPermissionDenied(err) {
		t.Fatalf("err = %v, want a permission-denied SDK error", err)
	}
	if len(capture.requests) != 1 {
		t.Errorf("requests = %d, want 1", len(capture.requests))
	}
}
