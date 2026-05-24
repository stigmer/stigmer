package artifact

import (
	"context"

	"github.com/rs/zerolog/log"
	artifactv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/artifact/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const artifactListKey = "artifactList"

// ListByExecution lists all artifacts produced by a specific execution.
//
// Custom pipeline (mirrors ListBySession in AgentExecutionController):
// 1. Validate — at least one of workflow_execution_id or agent_execution_id required
// 2. Query + filter — FindAllByField on the matching source field
// 3. Build response — wrap in ArtifactList
func (c *ArtifactController) ListByExecution(ctx context.Context, req *artifactv1.ListArtifactsByExecutionRequest) (*artifactv1.ArtifactList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListByExecutionPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	result, ok := reqCtx.Get(artifactListKey).(*artifactv1.ArtifactList)
	if !ok {
		return nil, grpclib.InternalError(nil, "artifact list not found in pipeline context")
	}

	return result, nil
}

func (c *ArtifactController) buildListByExecutionPipeline() *pipeline.Pipeline[*artifactv1.ListArtifactsByExecutionRequest] {
	return pipeline.NewPipeline[*artifactv1.ListArtifactsByExecutionRequest]("artifact-list-by-execution").
		AddStep(newValidateListByExecutionRequestStep()).
		AddStep(newQueryArtifactsByExecutionStep(c.store)).
		Build()
}

// --- Pipeline Steps ---

// validateListByExecutionRequestStep ensures the request has exactly one filter.
type validateListByExecutionRequestStep struct{}

func newValidateListByExecutionRequestStep() *validateListByExecutionRequestStep {
	return &validateListByExecutionRequestStep{}
}

func (s *validateListByExecutionRequestStep) Name() string {
	return "ValidateListByExecutionRequest"
}

func (s *validateListByExecutionRequestStep) Execute(ctx *pipeline.RequestContext[*artifactv1.ListArtifactsByExecutionRequest]) error {
	req := ctx.Input()
	wexID := req.GetWorkflowExecutionId()
	aexID := req.GetAgentExecutionId()

	if wexID == "" && aexID == "" {
		return grpclib.InvalidArgumentError("workflow_execution_id or agent_execution_id is required")
	}

	return nil
}

// queryArtifactsByExecutionStep loads artifacts filtered by execution ID.
type queryArtifactsByExecutionStep struct {
	store store.Store
}

func newQueryArtifactsByExecutionStep(s store.Store) *queryArtifactsByExecutionStep {
	return &queryArtifactsByExecutionStep{store: s}
}

func (s *queryArtifactsByExecutionStep) Name() string {
	return "QueryArtifactsByExecution"
}

func (s *queryArtifactsByExecutionStep) Execute(ctx *pipeline.RequestContext[*artifactv1.ListArtifactsByExecutionRequest]) error {
	req := ctx.Input()

	wexID := req.GetWorkflowExecutionId()
	aexID := req.GetAgentExecutionId()

	log.Debug().
		Str("workflow_execution_id", wexID).
		Str("agent_execution_id", aexID).
		Msg("Querying artifacts by execution")

	data, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_artifact)
	if err != nil {
		log.Error().Err(err).Msg("Failed to list artifacts")
		return grpclib.InternalError(err, "failed to list artifacts")
	}

	artifacts := make([]*artifactv1.Artifact, 0)
	for _, d := range data {
		a := &artifactv1.Artifact{}
		if err := proto.Unmarshal(d, a); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal artifact, skipping")
			continue
		}

		source := a.GetSpec().GetSource()
		if wexID != "" && source.GetWorkflowExecutionId() == wexID {
			artifacts = append(artifacts, a)
		} else if aexID != "" && source.GetAgentExecutionId() == aexID {
			artifacts = append(artifacts, a)
		}
	}

	log.Debug().
		Str("workflow_execution_id", wexID).
		Str("agent_execution_id", aexID).
		Int("total", len(data)).
		Int("matched", len(artifacts)).
		Msg("Queried artifacts by execution")

	ctx.Set(artifactListKey, &artifactv1.ArtifactList{
		TotalPages: 1,
		Entries:    artifacts,
	})

	return nil
}
