package transport

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"slices"
	"strings"
	"testing"

	skillv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/skill/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/test/bufconn"
)

// oversizedArtifactServer serves a getArtifact response above grpc-go's 4MB
// default receive cap but below the server's 10MB limit — the exact response
// class stigmer#702 reported dying client-side.
type oversizedArtifactServer struct {
	skillv1.UnimplementedSkillQueryControllerServer
	artifact []byte
}

func (s *oversizedArtifactServer) GetArtifact(ctx context.Context, req *skillv1.GetArtifactRequest) (*skillv1.GetArtifactResponse, error) {
	return &skillv1.GetArtifactResponse{Artifact: s.artifact}, nil
}

// TestDial_ReceivesResponsesAboveGrpcDefaultCap pins the raised receive cap
// (stigmer#702): a 5MB response — which the server would always serve, and
// which grpc-go's invisible 4MB default refused with "received message
// larger than max" — must arrive intact through Dial's connection.
func TestDial_ReceivesResponsesAboveGrpcDefaultCap(t *testing.T) {
	artifact := bytes.Repeat([]byte{0xAB}, 5*1024*1024)

	lis := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer()
	skillv1.RegisterSkillQueryControllerServer(server, &oversizedArtifactServer{artifact: artifact})
	go func() { _ = server.Serve(lis) }()
	defer server.Stop()

	conn, err := Dial(Config{
		Target:   "passthrough:///bufnet",
		Insecure: true,
		DialOptions: []grpc.DialOption{
			grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
				return lis.DialContext(ctx)
			}),
		},
	})
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	defer conn.Close()

	resp, err := skillv1.NewSkillQueryControllerClient(conn).GetArtifact(
		context.Background(),
		&skillv1.GetArtifactRequest{ArtifactStorageKey: "skills/org/skill/hash.zip"},
	)
	if err != nil {
		t.Fatalf("GetArtifact over 4MB must succeed through the SDK channel (stigmer#702): %v", err)
	}
	if !bytes.Equal(resp.GetArtifact(), artifact) {
		t.Fatalf("artifact bytes corrupted in transit: got %d bytes, want %d", len(resp.GetArtifact()), len(artifact))
	}
}

// recordingServer records the authorization header of each call it serves,
// unary and streaming alike.
type recordingServer struct {
	skillv1.UnimplementedSkillQueryControllerServer
	headers []string
}

func (s *recordingServer) GetArtifact(ctx context.Context, _ *skillv1.GetArtifactRequest) (*skillv1.GetArtifactResponse, error) {
	md, _ := metadata.FromIncomingContext(ctx)
	s.headers = append(s.headers, strings.Join(md.Get("authorization"), ","))
	return &skillv1.GetArtifactResponse{}, nil
}

func dialRecorder(t *testing.T, cfg Config) (*grpc.ClientConn, *recordingServer) {
	t.Helper()
	lis := bufconn.Listen(1024 * 1024)
	rec := &recordingServer{}
	server := grpc.NewServer()
	skillv1.RegisterSkillQueryControllerServer(server, rec)
	go func() { _ = server.Serve(lis) }()
	t.Cleanup(server.Stop)

	cfg.Target = "passthrough:///bufnet"
	cfg.Insecure = true
	cfg.DialOptions = []grpc.DialOption{grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
		return lis.DialContext(ctx)
	})}
	conn, err := Dial(cfg)
	if err != nil {
		t.Fatalf("Dial: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	return conn, rec
}

// TestDial_TokenFuncIsAskedOnEveryCall pins WithTokenFunc's contract: the
// bearer is fetched per call, so a token that expires is replaced.
func TestDial_TokenFuncIsAskedOnEveryCall(t *testing.T) {
	n := 0
	conn, rec := dialRecorder(t, Config{TokenFunc: func(context.Context) (string, error) {
		n++
		return fmt.Sprintf("token-%d", n), nil
	}})
	client := skillv1.NewSkillQueryControllerClient(conn)
	for range 2 {
		if _, err := client.GetArtifact(t.Context(), &skillv1.GetArtifactRequest{}); err != nil {
			t.Fatalf("GetArtifact: %v", err)
		}
	}
	if want := []string{"Bearer token-1", "Bearer token-2"}; !slices.Equal(rec.headers, want) {
		t.Errorf("headers = %v, want %v", rec.headers, want)
	}
}

// TestDial_TokenFuncErrorIsAnsweredBeforeAnythingIsSent: a refused mint, or
// an empty token, fails the call on the client.
func TestDial_TokenFuncErrorIsAnsweredBeforeAnythingIsSent(t *testing.T) {
	refused := errors.New("mint refused")
	for name, tc := range map[string]struct {
		fn   func(context.Context) (string, error)
		want error
	}{
		"error": {func(context.Context) (string, error) { return "", refused }, refused},
		"empty": {func(context.Context) (string, error) { return "", nil }, errEmptyToken},
	} {
		conn, rec := dialRecorder(t, Config{TokenFunc: tc.fn})
		client := skillv1.NewSkillQueryControllerClient(conn)
		if _, err := client.GetArtifact(t.Context(), &skillv1.GetArtifactRequest{}); !errors.Is(err, tc.want) {
			t.Errorf("%s: unary err = %v, want %v", name, err, tc.want)
		}
		ctx, cancel := context.WithCancel(t.Context())
		stream, err := grpc.NewClientStream(ctx, &grpc.StreamDesc{ServerStreams: true}, conn, "/x/y")
		cancel()
		if !errors.Is(err, tc.want) || stream != nil {
			t.Errorf("%s: stream err = %v, want %v", name, err, tc.want)
		}
		if len(rec.headers) != 0 {
			t.Errorf("%s: %d calls reached the server", name, len(rec.headers))
		}
	}
}

// TestDial_FixedTokenIsSentAsTheBearer: WithAPIKey's and WithToken's path.
func TestDial_FixedTokenIsSentAsTheBearer(t *testing.T) {
	conn, rec := dialRecorder(t, Config{BearerToken: "stk_key"})
	if _, err := skillv1.NewSkillQueryControllerClient(conn).GetArtifact(t.Context(), &skillv1.GetArtifactRequest{}); err != nil {
		t.Fatalf("GetArtifact: %v", err)
	}
	if want := []string{"Bearer stk_key"}; !slices.Equal(rec.headers, want) {
		t.Errorf("headers = %v, want %v", rec.headers, want)
	}
}

// TestStreamAuthInterceptor_SendsTheBearerOnAStream: a server-streaming call
// (a session's event stream) carries the token the source answers.
func TestStreamAuthInterceptor_SendsTheBearerOnAStream(t *testing.T) {
	var sent []string
	streamer := func(ctx context.Context, _ *grpc.StreamDesc, _ *grpc.ClientConn, _ string, _ ...grpc.CallOption) (grpc.ClientStream, error) {
		md, _ := metadata.FromOutgoingContext(ctx)
		sent = md.Get("authorization")
		return nil, nil
	}
	if _, err := streamAuthInterceptor(fixedToken("tok"))(t.Context(), &grpc.StreamDesc{ServerStreams: true}, nil, "/x/y", streamer); err != nil {
		t.Fatalf("interceptor: %v", err)
	}
	if want := []string{"Bearer tok"}; !slices.Equal(sent, want) {
		t.Errorf("sent = %v, want %v", sent, want)
	}
}
