package runner

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	runnerv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/runner/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	apiresourceinterceptor "github.com/stigmer/stigmer/backend/libs/go/grpc/interceptors/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

const listResultKey = "listResult"

// List retrieves Runners within an organization, with label-based filtering.
//
// Pipeline:
//  1. ValidateProto — validate input ListRunnersRequest
//  2. ListRunnersByOrgAndLabels — load, filter by org + labels, sort, return
//
// Compared to Stigmer Cloud, OSS excludes:
//   - FGA-filtered queries (no IAM — returns all runners for the org)
//   - Pagination (simple list all; proto supports page_info for cloud use)
//   - TransformResponse / SendResponse steps
func (c *RunnerController) List(ctx context.Context, req *runnerv1.ListRunnersRequest) (*runnerv1.RunnerList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()

	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	return reqCtx.Get(listResultKey).(*runnerv1.RunnerList), nil
}

func (c *RunnerController) buildListPipeline() *pipeline.Pipeline[*runnerv1.ListRunnersRequest] {
	return pipeline.NewPipeline[*runnerv1.ListRunnersRequest]("runner-list").
		AddStep(steps.NewValidateProtoStep[*runnerv1.ListRunnersRequest]()). // 1. Validate input
		AddStep(&listRunnersByOrgAndLabelsStep{store: c.store}).             // 2. Load + filter
		Build()
}

// listRunnersByOrgAndLabelsStep loads all Runners and filters by org and labels.
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

func (s *listRunnersByOrgAndLabelsStep) Execute(ctx *pipeline.RequestContext[*runnerv1.ListRunnersRequest]) error {
	req := ctx.Input()
	org := req.GetOrg()
	requestedLabels := req.GetLabels()

	kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())

	data, err := s.store.ListResources(ctx.Context(), kind)
	if err != nil {
		log.Error().Err(err).Msg("Failed to list runners")
		return grpclib.InternalError(err, "failed to list runners")
	}

	runners := make([]*runnerv1.Runner, 0, len(data))
	for _, d := range data {
		runner := &runnerv1.Runner{}
		if err := proto.Unmarshal(d, runner); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal runner, skipping")
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
		Msg("Listed runners")

	result := &runnerv1.RunnerList{
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
