package steps

import (
	"errors"
	"fmt"

	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
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
// If the request carries the personal label, this step queries the store for an
// existing personal environment. If one exists, the step fails with ALREADY_EXISTS.
//
// For non-personal environments, this step is a no-op.
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
	if env.GetMetadata() == nil {
		return nil
	}

	labels := env.GetMetadata().GetLabels()
	if labels[personalLabelKey] != personalLabelValue {
		return nil
	}

	existing := &environmentv1.Environment{}
	err := s.store.FindByLabel(
		ctx.Context(),
		apiresourcekind.ApiResourceKind_environment,
		personalLabelKey,
		personalLabelValue,
		existing,
	)

	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil
		}
		return fmt.Errorf("failed to check personal environment uniqueness: %w", err)
	}

	existingID := existing.GetMetadata().GetId()
	return status.Errorf(codes.AlreadyExists,
		"a personal environment already exists for this organization: %s", existingID)
}
