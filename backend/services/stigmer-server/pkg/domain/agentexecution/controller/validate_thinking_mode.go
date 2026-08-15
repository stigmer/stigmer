package agentexecution

import (
	"fmt"
	"strings"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/registry"
)

// validateThinkingModeStep fail-closed-validates
// ExecutionConfig.thinking_mode against the model registry
// (stigmer/stigmer#772) — the sibling of validateServiceTierStep for the
// second variant dimension.
//
// Unlike the fast tier, thinking is capability-gated, not pricing-gated:
// thinking variants bill at base per-token rates (ledger-verified), so the
// registry fact that makes ENABLED selectable is capabilities.thinking on
// the model's CURSOR-harness entry. The harness scoping is deliberate —
// native entries truthfully declare the same capability (Anthropic models
// support extended thinking natively) but no native wire mapping exists in
// v1, so validating them would accept a config the runner silently cannot
// honor (the exact silent-no-op class #357 exists to kill; mirrors the
// #361 FAST-on-native hold).
//
//   - UNSPECIFIED / DISABLED: always valid — every model has a base
//     variant, and unset resolves to explicitly-requested DISABLED in the
//     runner (never the provider account default).
//   - ENABLED: requires model_name to be set (Auto has no variant
//     dimensions) and that model's cursor-harness registry entry to declare
//     the thinking capability.
//
// Positioned beside validateServiceTierStep, before any side-effecting
// step. Mirrors the cloud Java ValidateThinkingModeStep; both editions
// must refuse the same request with the same message.
type validateThinkingModeStep struct {
	store *registry.ModelRegistryStore
}

func newValidateThinkingModeStep() *validateThinkingModeStep {
	return &validateThinkingModeStep{store: registry.Store()}
}

func (s *validateThinkingModeStep) Name() string {
	return "ValidateThinkingMode"
}

func (s *validateThinkingModeStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	config := ctx.NewState().GetSpec().GetExecutionConfig()
	if config.GetThinkingMode() != agentexecutionv1.ThinkingMode_THINKING_MODE_ENABLED {
		// UNSPECIFIED and DISABLED are always valid; unknown enum numbers
		// were already refused by proto field validation (defined_only).
		return nil
	}

	modelName := strings.TrimSpace(config.GetModelName())
	if modelName == "" {
		return grpclib.InvalidArgumentError(
			"thinking_mode 'enabled' requires execution_config.model_name: thinking is a "+
				"per-model capability, and Auto (no pinned model) has no variant dimensions. "+
				"Pin a model that supports it%s.", s.thinkingCapableSuffix())
	}

	if !s.store.HasCapabilityForHarness(
		registry.HarnessNameCursor, modelName, registry.ThinkingCapabilityKey) {
		return grpclib.InvalidArgumentError(
			"thinking_mode 'enabled' is not available for model '%s': the model "+
				"registry declares no thinking capability for it on the cursor "+
				"harness%s.", modelName, s.thinkingCapableSuffix())
	}

	return nil
}

// thinkingCapableSuffix renders "; models with a thinking mode: a, b, c" —
// actionable refusal detail, sorted (the store keeps the list sorted),
// empty when the registry declares none.
func (s *validateThinkingModeStep) thinkingCapableSuffix() string {
	capable := s.store.CanonicalModelsWithCapabilityForHarness(
		registry.HarnessNameCursor, registry.ThinkingCapabilityKey)
	if len(capable) == 0 {
		return ""
	}
	return fmt.Sprintf("; models with a thinking mode: %s", strings.Join(capable, ", "))
}
