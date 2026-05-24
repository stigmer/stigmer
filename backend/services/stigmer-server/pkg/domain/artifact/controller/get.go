package artifact

import (
	"context"

	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
)

// Get retrieves a single artifact by ID.
//
// Pipeline:
// 1. ValidateProto — ensures ArtifactId.value is present
// 2. LoadTarget   — loads the Artifact from the store, returns NOT_FOUND if absent
func (c *ArtifactController) Get(ctx context.Context, id *artifactv1.ArtifactId) (*artifactv1.Artifact, error) {
	reqCtx := pipeline.NewRequestContext(ctx, id)

	p := c.buildGetPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	artifact, ok := reqCtx.Get(steps.TargetResourceKey).(*artifactv1.Artifact)
	if !ok {
		return nil, grpclib.InternalError(nil, "loaded artifact not found in pipeline context")
	}

	return artifact, nil
}

func (c *ArtifactController) buildGetPipeline() *pipeline.Pipeline[*artifactv1.ArtifactId] {
	return pipeline.NewPipeline[*artifactv1.ArtifactId]("artifact-get").
		AddStep(steps.NewValidateProtoStep[*artifactv1.ArtifactId]()).
		AddStep(steps.NewLoadTargetStep[*artifactv1.ArtifactId, *artifactv1.Artifact](c.store)).
		Build()
}
