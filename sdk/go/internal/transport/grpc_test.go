package transport

import (
	"bytes"
	"context"
	"net"
	"testing"

	skillv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/skill/v1"
	"google.golang.org/grpc"
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
