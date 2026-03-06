package envmerge

import (
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
)

// MergeEnvironmentLayers merges three layers of environment configuration into
// a single map of ExecutionValue entries, suitable for persisting in an ExecutionContext.
//
// Merge priority (lowest to highest):
//  1. templateData  -- Agent.env_spec.data or Workflow.env_spec.data (template defaults)
//  2. environments  -- resolved Environment resources from instance environment_refs/env_refs (in order)
//  3. runtimeEnv    -- execution-scoped runtime_env overrides (highest priority)
//
// EnvironmentValue entries with empty value are filtered out; they represent
// schema declarations ("this agent needs GITHUB_TOKEN") rather than runtime config.
func MergeEnvironmentLayers(
	templateData map[string]*environmentv1.EnvironmentValue,
	environments []*environmentv1.Environment,
	runtimeEnv map[string]*executioncontextv1.ExecutionValue,
) map[string]*executioncontextv1.ExecutionValue {
	merged := make(map[string]*executioncontextv1.ExecutionValue)

	// Layer 1: template defaults
	for key, ev := range templateData {
		if ev == nil || ev.GetValue() == "" {
			continue
		}
		merged[key] = &executioncontextv1.ExecutionValue{
			Value:    ev.GetValue(),
			IsSecret: ev.GetIsSecret(),
		}
	}

	// Layer 2: environments (in order; later overrides earlier)
	for _, env := range environments {
		if env == nil {
			continue
		}
		for key, ev := range env.GetSpec().GetData() {
			if ev == nil || ev.GetValue() == "" {
				continue
			}
			merged[key] = &executioncontextv1.ExecutionValue{
				Value:    ev.GetValue(),
				IsSecret: ev.GetIsSecret(),
			}
		}
	}

	// Layer 3: runtime overrides (highest priority)
	for key, ev := range runtimeEnv {
		if ev == nil {
			continue
		}
		merged[key] = ev
	}

	return merged
}
