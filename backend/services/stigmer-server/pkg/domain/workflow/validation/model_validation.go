package validation

import (
	"fmt"
	"strings"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/converter"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/registry"
)

// Model validity comes from the shared registry.Store() — the same
// document the /v1/proxy/model-registry HTTP endpoint serves (the bundled
// registry, upgraded by the background refresh from the cloud endpoint
// when reachable). Reading the store per validation call instead of a
// boot-time snapshot is what keeps validation and the served pickers in
// lockstep: a model that appears in every picker after a refresh must
// also validate (DD-004).

// Harness names, suggestion machinery, and the write-time pin-existence
// rule all live in the registry package (the shared validation authority)
// — this package consumes them so workflow errors and schedule/channel
// pin errors suggest identically.
const (
	harnessNameNative = registry.HarnessNameNative
	harnessNameCursor = registry.HarnessNameCursor
)

// ValidateModelReferences checks that model IDs specified in workflow tasks
// are valid entries in the model registry for the task's effective harness.
//
// Validated task kinds:
//   - agent_call: run_config.model_name (optional) against harness from task config
//   - llm_call: model (required) against native harness
//   - eval: model (required) against native harness
//
// Returns validation errors with harness-aware closest-match suggestions.
func ValidateModelReferences(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	models := registry.Store()
	if !models.HasAnyModels() {
		return nil
	}

	var errors []string

	for _, task := range spec.Tasks {
		if task == nil || task.TaskConfig == nil {
			continue
		}

		var model, harness, kindLabel string

		switch task.Kind {
		case workflowv1.WorkflowTaskKind_agent_call:
			kindLabel = "agent_call"
			msg, err := converter.UnmarshalTaskConfigPublic(task.Kind, task.TaskConfig)
			if err != nil {
				continue
			}
			cfg, ok := msg.(*tasksv1.AgentCallTaskConfig)
			if !ok || cfg == nil {
				continue
			}
			harness = resolveHarnessName(cfg.Harness)
			// Tier validation is independent of the model check below: FAST
			// with no model_name must fail even though the model loop skips
			// (#357, same fail-closed rule as execution create).
			if tierErr := validateAgentCallServiceTier(models, task.Name, harness, cfg.GetRunConfig()); tierErr != "" {
				errors = append(errors, tierErr)
			}
			if cfg.GetRunConfig().GetModelName() == "" {
				continue
			}
			model = cfg.GetRunConfig().GetModelName()

		case workflowv1.WorkflowTaskKind_llm_call:
			kindLabel = "llm_call"
			msg, err := converter.UnmarshalTaskConfigPublic(task.Kind, task.TaskConfig)
			if err != nil {
				continue
			}
			cfg, ok := msg.(*tasksv1.LlmCallTaskConfig)
			if !ok || cfg == nil || cfg.Model == "" {
				continue
			}
			model = cfg.Model
			harness = harnessNameNative

		case workflowv1.WorkflowTaskKind_eval:
			kindLabel = "eval"
			msg, err := converter.UnmarshalTaskConfigPublic(task.Kind, task.TaskConfig)
			if err != nil {
				continue
			}
			cfg, ok := msg.(*tasksv1.EvalTaskConfig)
			if !ok || cfg == nil || cfg.Model == "" {
				continue
			}
			model = cfg.Model
			harness = harnessNameNative

		default:
			continue
		}

		if !models.HasHarness(harness) {
			continue
		}

		if models.IsValidModel(harness, model) {
			continue
		}

		errors = append(errors, buildModelError(models, task.Name, kindLabel, model, harness))
	}

	return errors
}

// validateAgentCallServiceTier applies the same fail-closed service-tier
// rules as execution create to an agent_call's run_config, with one extra
// dimension execution create cannot have: the task config names its
// harness, so the fast variant must be priced FOR THAT HARNESS — a fast
// price under another harness would validate a tier the execution path can
// never apply (a silent no-op, the exact class #357 exists to kill).
//
// STANDARD/unset is always valid; unknown tier strings never reach this
// function (protojson refuses non-canonical enum values at conversion).
// The message strings are pinned identical to the cloud Java
// ModelValidationHelper — keep them in lockstep.
func validateAgentCallServiceTier(models *registry.ModelRegistryStore,
	taskName, harness string, rc *agentexecutionv1.RunConfig) string {
	if rc.GetServiceTier() != agentexecutionv1.ServiceTier_SERVICE_TIER_FAST {
		return ""
	}
	modelName := strings.TrimSpace(rc.GetModelName())
	if modelName == "" {
		return fmt.Sprintf(
			"task '%s' (agent_call): run_config.service_tier 'fast' requires "+
				"run_config.model_name — the fast tier is a per-model price",
			taskName)
	}
	if !models.HasPricingVariantForHarness(harness, modelName, registry.FastVariantKey) {
		return fmt.Sprintf(
			"task '%s' (agent_call): run_config.service_tier 'fast' is not available "+
				"for model '%s' on harness '%s': the model registry prices no fast "+
				"variant for it%s",
			taskName, modelName, harness, fastCapableSuffix(models, harness))
	}
	return ""
}

// fastCapableSuffix renders "; models with a fast tier on '<harness>':
// a, b, c" — actionable refusal detail, sorted (the store keeps the list
// sorted), empty when the registry prices none for that harness.
func fastCapableSuffix(models *registry.ModelRegistryStore, harness string) string {
	capable := models.CanonicalModelsWithVariantForHarness(harness, registry.FastVariantKey)
	if len(capable) == 0 {
		return ""
	}
	return fmt.Sprintf("; models with a fast tier on '%s': %s",
		harness, strings.Join(capable, ", "))
}

func resolveHarnessName(h sessionv1.Harness) string {
	return registry.HarnessName(h)
}

func buildModelError(models *registry.ModelRegistryStore,
	taskName, kindLabel, model, harness string) string {
	suggestions := registry.SuggestSimilarModels(model, models.CanonicalModels(harness))

	msg := fmt.Sprintf(
		"task '%s' (%s): model '%s' is not a valid model for harness '%s'",
		taskName, kindLabel, model, harness,
	)

	if len(suggestions) > 0 {
		quoted := make([]string, len(suggestions))
		for i, s := range suggestions {
			quoted[i] = fmt.Sprintf("'%s'", s)
		}
		msg += fmt.Sprintf(". Did you mean: %s?", strings.Join(quoted, ", "))
	}

	return msg
}
