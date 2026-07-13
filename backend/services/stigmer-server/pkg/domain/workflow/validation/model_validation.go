package validation

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/converter"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/registry"
)

// The model registry is the single embedded copy shared with the
// /v1/proxy/model-registry HTTP endpoint (see registry.ModelRegistryHandler).
// It is a verbatim copy of stigmer-cloud's model-registry.json; entries that
// are `$comment` section headers have no id and are skipped during indexing.
type modelEntry struct {
	ID         string `json:"id"`
	ApiModelID string `json:"apiModelId"`
	Harness    string `json:"harness"`
}

type modelRegistryData struct {
	Models []modelEntry `json:"models"`
}

// modelsByHarness maps harness name ("native", "cursor") to the set of valid
// model references: canonical ids plus provider api ids (apiModelId). Both are
// accepted because the runner resolves canonical ids via the registry and
// passes unknown-but-registered api ids to the provider verbatim — anything in
// this set is executable (stigmer/stigmer#240).
var modelsByHarness map[string]map[string]bool

// sortedModelsByHarness maps harness name to a sorted slice of canonical model
// IDs only (for deterministic suggestions — the canonical id is the documented
// form, so suggestions never surface provider api ids).
var sortedModelsByHarness map[string][]string

func init() {
	modelsByHarness = make(map[string]map[string]bool)
	sortedModelsByHarness = make(map[string][]string)

	registryJSON, err := registry.ReadEmbeddedModelRegistry()
	if err != nil {
		return
	}

	var data modelRegistryData
	if err := json.Unmarshal(registryJSON, &data); err != nil {
		return
	}

	canonicalByHarness := make(map[string][]string)

	for _, m := range data.Models {
		if m.ID == "" || m.Harness == "" {
			continue
		}
		if modelsByHarness[m.Harness] == nil {
			modelsByHarness[m.Harness] = make(map[string]bool)
		}
		modelsByHarness[m.Harness][m.ID] = true
		canonicalByHarness[m.Harness] = append(canonicalByHarness[m.Harness], m.ID)
		if m.ApiModelID != "" {
			modelsByHarness[m.Harness][m.ApiModelID] = true
		}
	}

	for harness, ids := range canonicalByHarness {
		sort.Strings(ids)
		sortedModelsByHarness[harness] = ids
	}
}

const (
	maxModelSuggestions  = 3
	maxModelEditDistance = 5
	harnessNameNative    = "native"
	harnessNameCursor    = "cursor"
)

// ValidateModelReferences checks that model IDs specified in workflow tasks
// are valid entries in the model registry for the task's effective harness.
//
// Validated task kinds:
//   - agent_call: config.model (optional) against harness from task config
//   - llm_call: model (required) against native harness
//   - eval: model (required) against native harness
//
// Returns validation errors with harness-aware closest-match suggestions.
func ValidateModelReferences(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	if len(modelsByHarness) == 0 {
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
			if cfg.Config == nil || cfg.Config.Model == "" {
				continue
			}
			model = cfg.Config.Model

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

		validSet := modelsByHarness[harness]
		if validSet == nil {
			continue
		}

		if validSet[model] {
			continue
		}

		errors = append(errors, buildModelError(task.Name, kindLabel, model, harness))
	}

	return errors
}

func resolveHarnessName(h sessionv1.Harness) string {
	switch h {
	case sessionv1.Harness_HARNESS_CURSOR:
		return harnessNameCursor
	default:
		return harnessNameNative
	}
}

func buildModelError(taskName, kindLabel, model, harness string) string {
	suggestions := suggestSimilarModels(model, sortedModelsByHarness[harness])

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

// suggestSimilarModels returns up to maxModelSuggestions model IDs from the
// candidate list sorted by Levenshtein distance to the target. Only candidates
// within maxModelEditDistance are included.
func suggestSimilarModels(target string, candidates []string) []string {
	type scored struct {
		name string
		dist int
	}

	targetLower := strings.ToLower(target)
	var matches []scored

	for _, name := range candidates {
		d := levenshtein(targetLower, strings.ToLower(name))
		if d <= maxModelEditDistance {
			matches = append(matches, scored{name, d})
		}
	}

	sort.Slice(matches, func(i, j int) bool {
		if matches[i].dist != matches[j].dist {
			return matches[i].dist < matches[j].dist
		}
		return matches[i].name < matches[j].name
	})

	limit := maxModelSuggestions
	if len(matches) < limit {
		limit = len(matches)
	}

	result := make([]string, limit)
	for i := 0; i < limit; i++ {
		result[i] = matches[i].name
	}
	return result
}
