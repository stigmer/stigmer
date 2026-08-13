package skill

import (
	"context"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/transfer"
)

// CreateArtifactUploadUrl mints a short-lived, single-use HTTP upload URL
// for a skill artifact that exceeds the gRPC message cap (#675).
//
// Authorization mirrors Push (can_create_skill on the org) — wired through
// the same proto rpc options, so minting a staging capability requires
// exactly the permission that consuming it via push() does.
//
// The size gate here is the fail-loud half of the contract: an over-limit
// artifact is refused with the actual limit in the message BEFORE any bytes
// move, instead of surfacing as a transport error mid-upload.
func (c *SkillController) CreateArtifactUploadUrl(ctx context.Context, req *skillv1.CreateSkillArtifactUploadUrlRequest) (*skillv1.SkillArtifactUploadUrl, error) {
	if c.transferSlots == nil {
		return nil, grpclib.FailedPreconditionError("skill artifact transfer lane is not configured on this server")
	}

	reqCtx := pipeline.NewRequestContext(ctx, req)
	p := pipeline.NewPipeline[*skillv1.CreateSkillArtifactUploadUrlRequest]("skill-create-artifact-upload-url").
		AddStep(steps.NewValidateProtoStep[*skillv1.CreateSkillArtifactUploadUrlRequest]()).
		Build()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	if req.SizeBytes > storage.MaxZipSize {
		return nil, grpclib.InvalidArgumentError(
			"skill artifact size %d bytes exceeds the %d-byte (100MB) skill limit",
			req.SizeBytes, int64(storage.MaxZipSize))
	}

	ref, ttl, err := c.transferSlots.Mint(req.SizeBytes)
	if err != nil {
		return nil, grpclib.InternalError(err, "failed to mint upload reference")
	}

	return &skillv1.SkillArtifactUploadUrl{
		Url:               transfer.UploadURL(c.transferBaseURL, ref),
		ArtifactUploadRef: ref,
		TtlSeconds:        int32(ttl.Seconds()),
	}, nil
}
