package agentexecution

import (
	"fmt"
	"strings"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/registry"
)

// validateServiceTierStep fail-closed-validates ExecutionConfig.service_tier
// against the model registry (stigmer/stigmer#357).
//
// The tier exists to make pricing deterministic, so it is validated where the
// price is decided — at create, against the current registry — never
// discovered as a silent no-op at run time. The rule is a pure function of
// (model_name, service_tier, registry):
//
//   - UNSPECIFIED / STANDARD: always valid — every model has a base-priced
//     configuration, and unset resolves to explicitly-requested STANDARD in
//     the runner (never the provider account default).
//   - FAST: requires model_name to be set (Auto has no tier dimension) and
//     that model's registry entry to price a "fast" variant. A tier the
//     registry cannot price would trip billing's undercharge guard —
//     selection and billability are coupled by construction.
//
// Positioned directly after proto validation, before any side-effecting step
// (OSS has no scope steps rewriting ExecutionConfig). Mirrors the cloud Java
// ValidateServiceTierStep; both editions must refuse the same request with
// the same message.
type validateServiceTierStep struct {
	store *registry.ModelRegistryStore
}

func newValidateServiceTierStep() *validateServiceTierStep {
	return &validateServiceTierStep{store: registry.Store()}
}

func (s *validateServiceTierStep) Name() string {
	return "ValidateServiceTier"
}

func (s *validateServiceTierStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	config := ctx.NewState().GetSpec().GetExecutionConfig()
	if config.GetServiceTier() != agentexecutionv1.ServiceTier_SERVICE_TIER_FAST {
		// UNSPECIFIED and STANDARD are always valid; unknown enum numbers
		// were already refused by proto field validation (defined_only).
		return nil
	}

	modelName := strings.TrimSpace(config.GetModelName())
	if modelName == "" {
		return grpclib.InvalidArgumentError(
			"service_tier 'fast' requires execution_config.model_name: the fast tier is a "+
				"per-model price, and Auto (no pinned model) has no tier dimension. "+
				"Pin a model that supports it%s.", s.fastCapableSuffix())
	}

	if !s.store.HasPricingVariant(modelName, registry.FastVariantKey) {
		return grpclib.InvalidArgumentError(
			"service_tier 'fast' is not available for model '%s': the model "+
				"registry prices no fast variant for it%s.", modelName, s.fastCapableSuffix())
	}

	return nil
}

// fastCapableSuffix renders "; models with a fast tier: a, b, c" —
// actionable refusal detail, sorted (the store keeps the list sorted),
// empty when the registry prices none.
func (s *validateServiceTierStep) fastCapableSuffix() string {
	capable := s.store.CanonicalModelsWithVariant(registry.FastVariantKey)
	if len(capable) == 0 {
		return ""
	}
	return fmt.Sprintf("; models with a fast tier: %s", strings.Join(capable, ", "))
}
