package agentrunner

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	agentrunnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentrunner/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const listResultKey = "listResult"

// List retrieves AgentRunners within an organization, with label-based filtering.
//
// Pipeline:
//  1. ValidateProto — validate input ListAgentRunnersRequest
//  2. ListRunnersByOrgAndLabels — load, filter by org + labels, sort, return
//
// Compared to Stigmer Cloud, OSS excludes:
//   - FGA-filtered queries (no IAM — returns all runners for the org)
//   - Pagination (simple list all; proto supports page_info for cloud use)
//   - TransformResponse / SendResponse steps
func (c *AgentRunnerController) List(ctx context.Context, req *agentrunnerv1.ListAgentRunnersRequest) (*agentrunnerv1.AgentRunnerList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(listResultKey).(*agentrunnerv1.AgentRunnerList), nil
}

func (c *AgentRunnerController) buildListPipeline() *pipeline.Pipeline[*agentrunnerv1.ListAgentRunnersRequest] {
	return pipeline.NewPipeline[*agentrunnerv1.ListAgentRunnersRequest]("agent-runner-list").
		AddStep(steps.NewValidateProtoStep[*agentrunnerv1.ListAgentRunnersRequest]()). // 1. Validate input
		AddStep(&listRunnersByOrgAndLabelsStep{store: c.store}).                       // 2. Load + filter
		Build()
}

// listRunnersByOrgAndLabelsStep loads all AgentRunners and filters by org and labels.
//
// Filtering:
//   - org: required, must match metadata.org
//   - labels: AND semantics — all requested label key-value pairs must be present
//     and match on the resource's metadata.labels
//
// Sorting: by created_at DESC (newest first), consistent with other list handlers.
type listRunnersByOrgAndLabelsStep struct {
	store store.Store
}

func (s *listRunnersByOrgAndLabelsStep) Name() string {
	return "ListRunnersByOrgAndLabels"
}

func (s *listRunnersByOrgAndLabelsStep) Execute(ctx *pipeline.RequestContext[*agentrunnerv1.ListAgentRunnersRequest]) error {
	req := ctx.Input()
	org := req.GetOrg()
	requestedLabels := req.GetLabels()

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	data, err := s.store.ListResources(ctx.Context(), kind)
	if err != nil {
		log.Error().Err(err).Msg("Failed to list agent runners")
		return grpclib.InternalError(err, "failed to list agent runners")
	}

	runners := make([]*agentrunnerv1.AgentRunner, 0, len(data))
	for _, d := range data {
		runner := &agentrunnerv1.AgentRunner{}
		if err := proto.Unmarshal(d, runner); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal agent runner, skipping")
			continue
		}

		if org != "" && runner.GetMetadata().GetOrg() != org {
			continue
		}

		if !matchesAllLabels(runner.GetMetadata().GetLabels(), requestedLabels) {
			continue
		}

		runners = append(runners, runner)
	}

	sort.Slice(runners, func(i, j int) bool {
		ti := runners[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := runners[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		if ti == nil || tj == nil {
			return ti != nil
		}
		if ti.GetSeconds() != tj.GetSeconds() {
			return ti.GetSeconds() > tj.GetSeconds()
		}
		return ti.GetNanos() > tj.GetNanos()
	})

	log.Info().
		Str("org", org).
		Int("count", len(runners)).
		Msg("Listed agent runners")

	result := &agentrunnerv1.AgentRunnerList{
		TotalCount: int32(len(runners)),
		Items:      runners,
	}
	ctx.Set(listResultKey, result)

	return nil
}

// matchesAllLabels checks that every key-value pair in requested exists and
// matches in resourceLabels. Empty requested map matches everything.
func matchesAllLabels(resourceLabels, requested map[string]string) bool {
	for key, val := range requested {
		if resourceLabels[key] != val {
			return false
		}
	}
	return true
}
