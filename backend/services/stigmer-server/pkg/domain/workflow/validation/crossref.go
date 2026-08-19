package validation

import (
	"fmt"
	"sort"
	"strings"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// ValidateTaskKinds checks that every task in the spec has a recognized,
// non-zero WorkflowTaskKind. Returns errors for unspecified (0) or unknown
// enum values that don't appear in the generated name map.
func ValidateTaskKinds(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}
	var errors []string
	for _, task := range spec.Tasks {
		if _, ok := workflowv1.WorkflowTaskKind_name[int32(task.Kind)]; !ok || task.Kind == 0 {
			errors = append(errors, fmt.Sprintf(
				"task '%s': unknown or unspecified task kind (value=%d)", task.Name, int32(task.Kind)))
		}
	}
	return errors
}

// ValidateCrossTaskReferences checks that all task-name references within a
// workflow point to tasks that actually exist.
//
// Checked references:
//   - llm_call.fallback_task
//   - agent_call.output.fallback_task
//   - validate.fallback_task
//   - switch_case.cases[].then
//   - human_input.outcomes[].then
//   - flow.then (on every task)
//
// Also validates unique task names and detects cycles.
func ValidateCrossTaskReferences(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	var errors []string

	taskNames := buildTaskNameSet(spec.Tasks)

	// Unique task names
	if err := validateUniqueTaskNames(spec.Tasks); err != nil {
		errors = append(errors, err...)
	}

	// flow.then references
	if err := validateFlowReferences(spec.Tasks, taskNames); err != nil {
		errors = append(errors, err...)
	}

	// Task-config cross-references (fallback_task, cases[].then, outcomes[].then)
	for _, task := range spec.Tasks {
		if task.TaskConfig == nil {
			continue
		}
		taskErrors := extractAndValidateRefs(task.Name, task.Kind, task.TaskConfig, taskNames)
		errors = append(errors, taskErrors...)
	}

	// Cycle detection
	if err := validateNoCycles(spec.Tasks, taskNames); err != nil {
		errors = append(errors, err...)
	}

	return errors
}

func buildTaskNameSet(tasks []*workflowv1.WorkflowTask) map[string]bool {
	names := make(map[string]bool, len(tasks))
	for _, t := range tasks {
		if t.Name != "" {
			names[t.Name] = true
		}
	}
	return names
}

func validateUniqueTaskNames(tasks []*workflowv1.WorkflowTask) []string {
	seen := make(map[string]int, len(tasks))
	var errors []string

	for i, task := range tasks {
		if task == nil || task.Name == "" {
			continue
		}
		if firstIdx, exists := seen[task.Name]; exists {
			errors = append(errors, fmt.Sprintf(
				"duplicate task name %q at tasks[%d]: already defined at tasks[%d]",
				task.Name, i, firstIdx,
			))
		}
		seen[task.Name] = i
	}

	return errors
}

func validateFlowReferences(tasks []*workflowv1.WorkflowTask, taskNames map[string]bool) []string {
	var errors []string

	for _, task := range tasks {
		if task == nil || task.Flow == nil || task.Flow.Then == "" {
			continue
		}
		then := task.Flow.Then
		if then == "end" {
			continue
		}
		if !taskNames[then] {
			suggestion := suggestSimilar(then, taskNames)
			msg := fmt.Sprintf("task '%s' flow.then references unknown task '%s'", task.Name, then)
			if suggestion != "" {
				msg += fmt.Sprintf(" (did you mean '%s'?)", suggestion)
			}
			errors = append(errors, msg)
		}
	}

	return errors
}

func validateNoCycles(tasks []*workflowv1.WorkflowTask, taskNames map[string]bool) []string {
	graph := make(map[string]string, len(tasks))
	for _, task := range tasks {
		if task == nil || task.Flow == nil || task.Flow.Then == "" {
			continue
		}
		graph[task.Name] = task.Flow.Then
	}

	visited := make(map[string]bool, len(taskNames))
	path := make(map[string]bool, len(taskNames))
	pathOrder := make([]string, 0, len(taskNames))

	var errors []string

	var dfs func(node string)
	dfs = func(node string) {
		if path[node] {
			startIdx := -1
			for i, n := range pathOrder {
				if n == node {
					startIdx = i
					break
				}
			}
			cycleParts := append(pathOrder[startIdx:], node)
			errors = append(errors, fmt.Sprintf(
				"circular dependency detected: %s",
				strings.Join(cycleParts, " -> "),
			))
			return
		}

		if visited[node] {
			return
		}

		visited[node] = true
		path[node] = true
		pathOrder = append(pathOrder, node)

		if next, hasEdge := graph[node]; hasEdge && next != "end" {
			if taskNames[next] {
				dfs(next)
			}
		}

		path[node] = false
		pathOrder = pathOrder[:len(pathOrder)-1]
	}

	for name := range taskNames {
		if !visited[name] {
			dfs(name)
		}
	}

	return errors
}

func extractAndValidateRefs(
	taskName string,
	kind workflowv1.WorkflowTaskKind,
	config *structpb.Struct,
	validNames map[string]bool,
) []string {
	var errors []string
	fields := config.GetFields()

	switch kind {
	case workflowv1.WorkflowTaskKind_llm_call,
		workflowv1.WorkflowTaskKind_validate:
		if ref := getStringField(fields, "fallbackTask", "fallback_task"); ref != "" {
			if !validNames[ref] {
				suggestion := suggestSimilar(ref, validNames)
				msg := fmt.Sprintf("task '%s' (%s) fallback_task references unknown task '%s'",
					taskName, kind.String(), ref)
				if suggestion != "" {
					msg += fmt.Sprintf(" (did you mean '%s'?)", suggestion)
				}
				errors = append(errors, msg)
			}
		}

	case workflowv1.WorkflowTaskKind_agent_call:
		if output := getStructField(fields, "output"); output != nil {
			if ref := getStringField(output.GetFields(), "fallbackTask", "fallback_task"); ref != "" {
				if !validNames[ref] {
					suggestion := suggestSimilar(ref, validNames)
					msg := fmt.Sprintf("task '%s' (agent_call) output.fallback_task references unknown task '%s'",
						taskName, ref)
					if suggestion != "" {
						msg += fmt.Sprintf(" (did you mean '%s'?)", suggestion)
					}
					errors = append(errors, msg)
				}
			}
		}

	case workflowv1.WorkflowTaskKind_switch_case:
		cases := getListField(fields, "cases")
		for i, c := range cases {
			caseStruct := c.GetStructValue()
			if caseStruct == nil {
				continue
			}
			if ref := getStringField(caseStruct.GetFields(), "then"); ref != "" && ref != "end" {
				if !validNames[ref] {
					suggestion := suggestSimilar(ref, validNames)
					msg := fmt.Sprintf("task '%s' (switch_case) cases[%d].then references unknown task '%s'",
						taskName, i, ref)
					if suggestion != "" {
						msg += fmt.Sprintf(" (did you mean '%s'?)", suggestion)
					}
					errors = append(errors, msg)
				}
			}
		}

	case workflowv1.WorkflowTaskKind_human_input:
		outcomes := getListField(fields, "outcomes")
		for i, o := range outcomes {
			outcomeStruct := o.GetStructValue()
			if outcomeStruct == nil {
				continue
			}
			if ref := getStringField(outcomeStruct.GetFields(), "then"); ref != "" && ref != "end" {
				if !validNames[ref] {
					suggestion := suggestSimilar(ref, validNames)
					msg := fmt.Sprintf("task '%s' (human_input) outcomes[%d].then references unknown task '%s'",
						taskName, i, ref)
					if suggestion != "" {
						msg += fmt.Sprintf(" (did you mean '%s'?)", suggestion)
					}
					errors = append(errors, msg)
				}
			}
		}
	}

	return errors
}

// ValidateTaskConfigSurfaceRules checks the task-config semantics the config
// protos cannot declare.
//
// Until stigmer#805 this function (then ValidateTaskConfigRequiredFields) also
// hand-checked per-kind required fields, bounds, and oneof shapes — workarounds
// for declared proto rules that could not fire through the opaque task_config
// Struct. Those checks retired when ValidateTaskConfigConstraints armed the
// declared rules over the strict-unmarshaled typed configs; each retirement is
// probe-tested in task_config_constraints_test.go against the proto rule that
// subsumed it. What remains is genuinely contextual:
//
//   - agent_call workspace_entries must use git_repo sources: WorkspaceSource's
//     oneof legitimately offers local_path on the session surface, but no
//     client is connected to serve one when a workflow task fires — a
//     workflow-surface restriction, not a schema fact, so it cannot live on
//     the shared proto. (Source presence and git_repo.url's HTTPS shape ARE
//     schema facts — WorkspaceEntry.source's required rule and the
//     git_repo_source.url.https CEL enforce them via the constraints step.)
//
// Keep the strings in lockstep with the cloud Java validator.
func ValidateTaskConfigSurfaceRules(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	var errors []string
	for _, task := range spec.Tasks {
		if task.Kind != workflowv1.WorkflowTaskKind_agent_call || task.TaskConfig == nil {
			continue
		}
		for i, v := range getListField(task.TaskConfig.GetFields(), "workspace_entries") {
			entry := v.GetStructValue()
			if entry == nil {
				continue
			}
			source := getStructField(entry.GetFields(), "source")
			if source == nil {
				// Absence is the constraints step's required-rule to report.
				continue
			}
			if getStructField(source.GetFields(), "git_repo") == nil {
				errors = append(errors, fmt.Sprintf("task '%s' (agent_call): workspace_entries[%d] must use a git_repo source — no client is connected to serve a local_path when a workflow task fires", task.Name, i))
			}
		}
	}
	return errors
}

func getStringField(fields map[string]*structpb.Value, keys ...string) string {
	for _, key := range keys {
		if v, ok := fields[key]; ok {
			if s := v.GetStringValue(); s != "" {
				return s
			}
		}
	}
	return ""
}

func getStructField(fields map[string]*structpb.Value, keys ...string) *structpb.Struct {
	for _, key := range keys {
		if v, ok := fields[key]; ok {
			return v.GetStructValue()
		}
	}
	return nil
}

func getListField(fields map[string]*structpb.Value, key string) []*structpb.Value {
	if v, ok := fields[key]; ok {
		if list := v.GetListValue(); list != nil {
			return list.GetValues()
		}
	}
	return nil
}

func suggestSimilar(target string, names map[string]bool) string {
	const maxDistance = 3
	bestName := ""
	bestDist := maxDistance + 1

	sorted := make([]string, 0, len(names))
	for n := range names {
		sorted = append(sorted, n)
	}
	sort.Strings(sorted)

	for _, name := range sorted {
		d := levenshtein(strings.ToLower(target), strings.ToLower(name))
		if d < bestDist {
			bestDist = d
			bestName = name
		}
	}

	if bestDist <= maxDistance {
		return bestName
	}
	return ""
}

func levenshtein(a, b string) int {
	la, lb := len(a), len(b)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}

	prev := make([]int, lb+1)
	curr := make([]int, lb+1)

	for j := 0; j <= lb; j++ {
		prev[j] = j
	}

	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 0
			if a[i-1] != b[j-1] {
				cost = 1
			}
			curr[j] = min(
				curr[j-1]+1,
				min(prev[j]+1, prev[j-1]+cost),
			)
		}
		prev, curr = curr, prev
	}

	return prev[lb]
}
