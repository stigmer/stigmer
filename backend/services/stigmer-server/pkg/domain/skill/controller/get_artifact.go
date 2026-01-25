package skill

import (
	"context"
	"strings"

	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/skill/storage"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// GetArtifact downloads a skill artifact by its storage key.
//
// This endpoint is used by the agent-runner to download skill artifact ZIP files
// for extraction into the sandbox at /bin/skills/{version_hash}/.
//
// Authorization is skipped as the storage key itself acts as a capability token.
//
// Pipeline:
// 1. ValidateProto - Validate input GetArtifactRequest (ensures storage key is not empty)
// 2. LoadArtifact - Load artifact from storage by key
//
// Note: Compared to Stigmer Cloud (Java), OSS excludes:
// - R2 storage (uses local file storage instead)
// - TransformResponse step (handler returns directly)
// - SendResponse step (handler returns directly)
//
// The artifact bytes are returned directly in GetArtifactResponse.
func (c *SkillController) GetArtifact(ctx context.Context, req *skillv1.GetArtifactRequest) (*skillv1.GetArtifactResponse, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildGetArtifactPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	// Retrieve loaded artifact from context
	artifact := reqCtx.Get(artifactBytesKey).([]byte)
	return &skillv1.GetArtifactResponse{
		Artifact: artifact,
	}, nil
}

// artifactBytesKey is the context key for storing loaded artifact bytes
const artifactBytesKey = "artifactBytes"

// buildGetArtifactPipeline constructs the pipeline for get-artifact operations
func (c *SkillController) buildGetArtifactPipeline() *pipeline.Pipeline[*skillv1.GetArtifactRequest] {
	return pipeline.NewPipeline[*skillv1.GetArtifactRequest]("skill-get-artifact").
		AddStep(steps.NewValidateProtoStep[*skillv1.GetArtifactRequest]()). // 1. Validate input
		AddStep(newLoadArtifactStep(c.artifactStorage)).                    // 2. Load artifact
		Build()
}

// loadArtifactStep loads a skill artifact from storage by its storage key
type loadArtifactStep struct {
	storage storage.ArtifactStorage
}

// newLoadArtifactStep creates a new loadArtifactStep
func newLoadArtifactStep(storage storage.ArtifactStorage) *loadArtifactStep {
	return &loadArtifactStep{storage: storage}
}

// Name returns the step name for logging/tracing
func (s *loadArtifactStep) Name() string {
	return "LoadArtifact"
}

// Execute loads the artifact from storage
func (s *loadArtifactStep) Execute(ctx *pipeline.RequestContext[*skillv1.GetArtifactRequest]) error {
	storageKey := ctx.Request().GetArtifactStorageKey()

	// Load artifact from storage
	artifactBytes, err := s.storage.Get(storageKey)
	if err != nil {
		// Check if it's a not found error
		if strings.Contains(err.Error(), "not found") {
			return status.Errorf(codes.NotFound, "skill artifact not found: %s", storageKey)
		}
		return status.Errorf(codes.Internal, "failed to load skill artifact: %v", err)
	}

	// Store artifact bytes in context for the handler to retrieve
	ctx.Set(artifactBytesKey, artifactBytes)

	return nil
}
