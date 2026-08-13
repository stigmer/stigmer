package skill

import (
	"context"
	"strings"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/transfer"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// GetArtifactDownloadUrl mints an HTTP download URL for a skill artifact,
// the transfer-lane twin of GetArtifact (#675). Preferred by clients for
// anything that might exceed the gRPC message cap: the bytes ride HTTP, so
// the full 100MB skill limit is deliverable.
//
// Authorization is skipped for the same reason as GetArtifact: the
// content-hash storage key acts as the capability token. The URL does not
// expire on OSS (ttl_seconds = 0) — it embeds that same capability, so a
// stored URL grants nothing a stored storage key would not.
func (c *SkillController) GetArtifactDownloadUrl(ctx context.Context, req *skillv1.GetArtifactRequest) (*skillv1.SkillArtifactDownloadUrl, error) {
	if c.transferBaseURL == "" {
		return nil, grpclib.FailedPreconditionError("skill artifact transfer lane is not configured on this server")
	}

	reqCtx := pipeline.NewRequestContext(ctx, req)
	p := pipeline.NewPipeline[*skillv1.GetArtifactRequest]("skill-get-artifact-download-url").
		AddStep(steps.NewValidateProtoStep[*skillv1.GetArtifactRequest]()).
		Build()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Stat (never load) the artifact: the RPC's job is a URL, not bytes.
	// A missing artifact fails here with NotFound rather than at fetch time.
	size, err := c.artifactStorage.Size(req.GetArtifactStorageKey())
	if err != nil {
		if strings.Contains(err.Error(), "not found") {
			return nil, status.Errorf(codes.NotFound, "skill artifact not found: %s", req.GetArtifactStorageKey())
		}
		return nil, grpclib.InternalError(err, "failed to stat skill artifact")
	}

	return &skillv1.SkillArtifactDownloadUrl{
		Url:        transfer.DownloadURL(c.transferBaseURL, req.GetArtifactStorageKey()),
		TtlSeconds: 0,
		SizeBytes:  size,
	}, nil
}
