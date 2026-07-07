package steps

import (
	"fmt"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	personalLabelKey   = "stigmer.ai/personal"
	personalLabelValue = "true"
)

// EnforcePersonalUniquenessStep prevents creation of duplicate personal environments.
//
// A personal environment (label stigmer.ai/personal=true) must be unique per org.
// If the request carries the personal label, this step looks for an existing
// personal environment in the SAME org. If one exists, the step fails with
// ALREADY_EXISTS. For non-personal environments, this step is a no-op.
//
// Contract note: the Cloud edition enforces uniqueness per (org, owner) — it also
// scopes by the creating identity. OSS has no caller identity yet (audit
// created_by is always the "system" actor), so per-(org, owner) collapses to
// per-org here. This is a faithful specialization of the shared contract, not a
// divergence; when OSS gains real caller identity, revisit whether to also scope
// by created_by.
//
// Placement: this step runs at create time only, before the resource is assigned
// an ID and persisted, so it never matches the in-flight resource against itself.
// Update deliberately omits it (updating a personal environment must not re-check
// uniqueness against its own record).
type EnforcePersonalUniquenessStep struct {
	store store.Store
}

// NewEnforcePersonalUniquenessStep creates a step that rejects duplicate personal environments.
func NewEnforcePersonalUniquenessStep(s store.Store) *EnforcePersonalUniquenessStep {
	return &EnforcePersonalUniquenessStep{store: s}
}

func (s *EnforcePersonalUniquenessStep) Name() string {
	return "EnforcePersonalEnvUniqueness"
}

func (s *EnforcePersonalUniquenessStep) Execute(ctx *pipeline.RequestContext[*environmentv1.Environment]) error {
	env := ctx.NewState()
	metadata := env.GetMetadata()
	if metadata == nil {
		return nil
	}

	if metadata.GetLabels()[personalLabelKey] != personalLabelValue {
		return nil
	}

	org := metadata.GetOrg()

	existing, found, err := steps.FindResourceByLabelAndOrg[*environmentv1.Environment](
		ctx.Context(),
		s.store,
		apiresourcekind.ApiResourceKind_environment,
		personalLabelKey,
		personalLabelValue,
		org,
	)
	if err != nil {
		return fmt.Errorf("failed to check personal environment uniqueness: %w", err)
	}

	if found {
		return status.Errorf(codes.AlreadyExists,
			"a personal environment already exists for this organization: %s",
			existing.GetMetadata().GetId())
	}

	return nil
}
