package envmerge

import (
	"sort"

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

// FilterByEnvSpec restricts a merged environment map to only the keys declared
// in the agent's or workflow's env_spec.data. This enforces least-privilege:
// an agent only receives the environment variables it explicitly declared,
// even if the linked environments contain additional secrets.
//
// Backward compatibility: if envSpecData is nil or empty, the merged map is
// returned unchanged. This preserves legacy behavior for agents/workflows
// that predate env_spec.
//
// The whitelist includes ALL keys in envSpecData, including entries with empty
// values (schema-only declarations). A key like GITHUB_TOKEN may have an empty
// value in env_spec but still be a valid key that should pass through from
// environments or runtime_env.
//
// Returns the filtered map and a sorted list of excluded keys for observability.
func FilterByEnvSpec(
	merged map[string]*executioncontextv1.ExecutionValue,
	envSpecData map[string]*environmentv1.EnvironmentValue,
) (filtered map[string]*executioncontextv1.ExecutionValue, excludedKeys []string) {
	if len(envSpecData) == 0 {
		return merged, nil
	}

	filtered = make(map[string]*executioncontextv1.ExecutionValue, len(envSpecData))
	for key, val := range merged {
		if _, declared := envSpecData[key]; declared {
			filtered[key] = val
		} else {
			excludedKeys = append(excludedKeys, key)
		}
	}

	sort.Strings(excludedKeys)
	return filtered, excludedKeys
}
