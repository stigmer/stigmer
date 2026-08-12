package environment

import (
	"context"
	"sort"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	envsteps "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/controller/steps"
	"google.golang.org/protobuf/proto"
)

const listResultKey = "listResult"

// List retrieves environments filtered by organization and optional labels.
//
// Pipeline Steps:
// 1. ValidateProto - Validate proto field constraints (org is required)
// 2. ListByOrgAndLabels - Load all environments, filter by org and labels
//
// Note: Unlike Stigmer Cloud, OSS excludes:
// - Authorization filtering (no multi-user auth — returns all matching environments)
// - Pagination (returns all matching results)
//
// Secret values are redacted in every item (oss#405 — both editions redact
// on read; getSecretValue is the reveal path).
func (c *EnvironmentController) List(ctx context.Context, req *environmentv1.ListEnvironmentsRequest) (*environmentv1.EnvironmentList, error) {
	reqCtx := pipeline.NewRequestContext(ctx, req)

	p := c.buildListPipeline()
	if err := p.Execute(reqCtx); err != nil {
		return nil, err
	}

	list := reqCtx.Get(listResultKey)
	if list == nil {
		return nil, grpclib.InternalError(nil, "environment list not found in context")
	}

	return list.(*environmentv1.EnvironmentList), nil
}

func (c *EnvironmentController) buildListPipeline() *pipeline.Pipeline[*environmentv1.ListEnvironmentsRequest] {
	return pipeline.NewPipeline[*environmentv1.ListEnvironmentsRequest]("environment-list").
		AddStep(steps.NewValidateProtoStep[*environmentv1.ListEnvironmentsRequest]()).
		AddStep(newListByOrgAndLabelsStep(c.store)).
		Build()
}

// ============================================================================
// Custom Pipeline Step: ListByOrgAndLabels
// ============================================================================

// listByOrgAndLabelsStep loads all environments and filters by org and labels.
//
// This step:
// 1. Lists all environments from the store
// 2. Filters by metadata.org matching the requested org
// 3. Filters by metadata.labels containing all requested labels (AND semantics)
// 4. Sorts by created_at descending (newest first)
// 5. Stores the result list in pipeline context
//
// In OSS (local usage), no authorization filtering is applied.
type listByOrgAndLabelsStep struct {
	store store.Store
}

func newListByOrgAndLabelsStep(store store.Store) *listByOrgAndLabelsStep {
	return &listByOrgAndLabelsStep{store: store}
}

func (s *listByOrgAndLabelsStep) Name() string {
	return "ListByOrgAndLabels"
}

func (s *listByOrgAndLabelsStep) Execute(ctx *pipeline.RequestContext[*environmentv1.ListEnvironmentsRequest]) error {
	req := ctx.Input()
	org := req.GetOrg()
	reqLabels := req.GetLabels()

	resources, err := s.store.ListResources(ctx.Context(), apiresourcekind.ApiResourceKind_environment)
	if err != nil {
		return grpclib.InternalError(err, "failed to list environments")
	}

	environments := make([]*environmentv1.Environment, 0, len(resources))
	for _, data := range resources {
		env := &environmentv1.Environment{}
		if err := proto.Unmarshal(data, env); err != nil {
			log.Warn().Err(err).Msg("Failed to unmarshal environment, skipping")
			continue
		}

		if env.GetMetadata().GetOrg() != org {
			continue
		}

		if !matchesAllLabels(env.GetMetadata().GetLabels(), reqLabels) {
			continue
		}

		envsteps.RedactEnvironmentSecrets(env)
		environments = append(environments, env)
	}

	sort.Slice(environments, func(i, j int) bool {
		ti := environments[i].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
		tj := environments[j].GetStatus().GetAudit().GetSpecAudit().GetCreatedAt()
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
		Int("matchCount", len(environments)).
		Int("labelFilters", len(reqLabels)).
		Msg("Listed environments")

	ctx.Set(listResultKey, &environmentv1.EnvironmentList{
		TotalCount: int32(len(environments)),
		Items:      environments,
	})

	return nil
}

// matchesAllLabels returns true if resourceLabels contains every entry in filterLabels.
// An empty filterLabels map matches all resources.
func matchesAllLabels(resourceLabels, filterLabels map[string]string) bool {
	for k, v := range filterLabels {
		if resourceLabels[k] != v {
			return false
		}
	}
	return true
}
