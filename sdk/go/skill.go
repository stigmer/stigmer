package stigmer

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"

	"github.com/stigmer/stigmer/sdk/go/v3/internal/gen"
	skillv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/skill/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// maxInlineArtifactBytes is the largest artifact Push sends inline in the
// gRPC request. The server's transport cap is 10MB for the WHOLE message,
// so the artifact must leave headroom for the request envelope (org, tag,
// git provenance, version message, proto framing); 64KB is far beyond any
// real envelope while costing nothing meaningful in inline reach.
const maxInlineArtifactBytes = 10*1024*1024 - 64*1024

// skillPushTransport is the slice of the generated client the push routing
// needs — narrow so tests can fake exactly these two calls.
type skillPushTransport interface {
	Push(ctx context.Context, input *skillv1.PushSkillRequest) (*skillv1.Skill, error)
	CreateArtifactUploadUrl(ctx context.Context, input *skillv1.CreateSkillArtifactUploadUrlRequest) (*skillv1.SkillArtifactUploadUrl, error)
}

// SkillClient wraps the generated skill client with transport-aware push
// routing (stigmer/stigmer#675).
//
// The gRPC transport caps messages at 10MB while skills may be up to 100MB,
// so Push routes by size: small artifacts travel inline in the request
// (one round trip, unchanged behavior), larger ones are staged over HTTP
// via createArtifactUploadUrl and pushed by reference. Callers never see
// the mechanics — Push(req) simply works for any valid skill size.
//
// Every other method is the generated client's, promoted unchanged.
type SkillClient struct {
	*gen.SkillClient
	transport  skillPushTransport
	httpClient *http.Client
}

func newSkillClient(g *gen.SkillClient) *SkillClient {
	return &SkillClient{
		SkillClient: g,
		transport:   g,
		// http.Client without a global timeout: a 100MB artifact on a slow
		// link legitimately takes minutes. Cancellation rides the caller's
		// ctx via http.NewRequestWithContext.
		httpClient: &http.Client{},
	}
}

// Push uploads a skill artifact, routing by size (see the type comment).
//
// A request that already carries an ArtifactUploadRef is passed through
// untouched — the caller has done its own staging.
func (s *SkillClient) Push(ctx context.Context, input *skillv1.PushSkillRequest) (*skillv1.Skill, error) {
	if input.GetArtifactUploadRef() != "" || len(input.GetArtifact()) <= maxInlineArtifactBytes {
		return s.transport.Push(ctx, input)
	}
	return s.pushViaUploadURL(ctx, input)
}

// pushViaUploadURL stages the artifact over HTTP and pushes by reference:
// createArtifactUploadUrl → PUT bytes → push(artifact_upload_ref).
func (s *SkillClient) pushViaUploadURL(ctx context.Context, input *skillv1.PushSkillRequest) (*skillv1.Skill, error) {
	upload, err := s.transport.CreateArtifactUploadUrl(ctx, &skillv1.CreateSkillArtifactUploadUrlRequest{
		Org:       input.GetOrg(),
		SizeBytes: int64(len(input.GetArtifact())),
	})
	if err != nil {
		if status.Code(err) == codes.Unimplemented {
			// Pre-transfer-lane server: without staging, an artifact this
			// size physically cannot travel. Say so instead of letting the
			// raw transport error surface (the failure mode #675 reported).
			return nil, fmt.Errorf(
				"stigmer: skill artifact is %d bytes, above the ~10MB gRPC message cap, and this server does not support the HTTP artifact transfer lane — upgrade stigmer-server to push skills of this size", len(input.GetArtifact()))
		}
		return nil, err
	}

	if err := s.putArtifact(ctx, upload.GetUrl(), input.GetArtifact()); err != nil {
		return nil, err
	}

	// Same request, artifact traveling by reference instead of by value.
	byRef := proto.Clone(input).(*skillv1.PushSkillRequest)
	byRef.Artifact = nil
	byRef.ArtifactUploadRef = upload.GetArtifactUploadRef()
	return s.transport.Push(ctx, byRef)
}

// putArtifact PUTs the artifact ZIP to the staging URL. The URL is the
// credential (capability semantics — a pre-signed R2 URL on cloud, the
// server's own transfer lane on OSS), so no auth header is attached.
func (s *SkillClient) putArtifact(ctx context.Context, url string, artifact []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(artifact))
	if err != nil {
		return fmt.Errorf("stigmer: failed to build artifact upload request: %w", err)
	}
	req.Header.Set("Content-Type", "application/zip")
	req.ContentLength = int64(len(artifact))

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("stigmer: skill artifact upload failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("stigmer: skill artifact upload rejected with HTTP %d: %s", resp.StatusCode, bytes.TrimSpace(body))
	}
	return nil
}
