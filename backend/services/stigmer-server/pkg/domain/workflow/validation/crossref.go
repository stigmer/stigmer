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

// ValidateTaskConfigRequiredFields checks that task-type-specific required
// fields are present in each task's config struct.
func ValidateTaskConfigRequiredFields(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	var errors []string
	for _, task := range spec.Tasks {
		if task.TaskConfig == nil {
			continue
		}
		fields := task.TaskConfig.GetFields()

		switch task.Kind {
		case workflowv1.WorkflowTaskKind_eval:
			if model := getStringField(fields, "model"); model == "" {
				errors = append(errors, fmt.Sprintf("task '%s' (eval): required field 'model' is missing or empty", task.Name))
			}
			if subject := getStringField(fields, "subject"); subject == "" {
				errors = append(errors, fmt.Sprintf("task '%s' (eval): required field 'subject' is missing or empty", task.Name))
			}
			if rubric := getStringField(fields, "rubric"); rubric == "" {
				errors = append(errors, fmt.Sprintf("task '%s' (eval): required field 'rubric' is missing or empty", task.Name))
			}

		case workflowv1.WorkflowTaskKind_http_call:
			if method := getStringField(fields, "method"); method == "" {
				errors = append(errors, fmt.Sprintf("task '%s' (http_call): required field 'method' is missing or empty", task.Name))
			}
			endpoint := getStructField(fields, "endpoint")
			if endpoint == nil {
				errors = append(errors, fmt.Sprintf("task '%s' (http_call): required field 'endpoint' is missing", task.Name))
			} else if uri := getStringField(endpoint.GetFields(), "uri"); uri == "" {
				errors = append(errors, fmt.Sprintf("task '%s' (http_call): required field 'endpoint.uri' is missing or empty", task.Name))
			}

		case workflowv1.WorkflowTaskKind_grpc_call:
			if service := getStringField(fields, "service"); service == "" {
				errors = append(errors, fmt.Sprintf("task '%s' (grpc_call): required field 'service' is missing or empty", task.Name))
			}
			if method := getStringField(fields, "method"); method == "" {
				errors = append(errors, fmt.Sprintf("task '%s' (grpc_call): required field 'method' is missing or empty", task.Name))
			}

		case workflowv1.WorkflowTaskKind_activity_call:
			if activity := getStringField(fields, "activity"); activity == "" {
				errors = append(errors, fmt.Sprintf("task '%s' (activity_call): required field 'activity' is missing or empty", task.Name))
			}

		case workflowv1.WorkflowTaskKind_agent_call:
			// RunConfig's buf.validate gte-0 rules cannot run at Layer 1
			// (task_config is an opaque Struct there), so the bounds are
			// enforced here. Keep the strings in lockstep with the cloud
			// Java validator.
			if rc := getStructField(fields, "run_config"); rc != nil {
				rcFields := rc.GetFields()
				if v, ok := rcFields["max_cost_usd"]; ok && v.GetNumberValue() < 0 {
					errors = append(errors, fmt.Sprintf("task '%s' (agent_call): run_config.max_cost_usd must be >= 0", task.Name))
				}
				if v, ok := rcFields["max_tool_rounds"]; ok && v.GetNumberValue() < 0 {
					errors = append(errors, fmt.Sprintf("task '%s' (agent_call): run_config.max_tool_rounds must be >= 0", task.Name))
				}
			}

			// Surface constraint on the shared WorkspaceEntry vocabulary
			// (the schedule discipline, workflow-flavored): sources must
			// be git_repo — no client is connected to serve a local_path
			// when a workflow task fires. Refusing at write time beats a
			// deterministic provisioning failure at run time. The https
			// rule mirrors GitRepoSource's proto CEL, unreachable at
			// Layer 1 through the Struct envelope.
			for i, v := range getListField(fields, "workspace_entries") {
				entry := v.GetStructValue()
				if entry == nil {
					continue
				}
				source := getStructField(entry.GetFields(), "source")
				if source == nil {
					errors = append(errors, fmt.Sprintf("task '%s' (agent_call): workspace_entries[%d] requires a source", task.Name, i))
					continue
				}
				gitRepo := getStructField(source.GetFields(), "git_repo")
				if gitRepo == nil {
					errors = append(errors, fmt.Sprintf("task '%s' (agent_call): workspace_entries[%d] must use a git_repo source — no client is connected to serve a local_path when a workflow task fires", task.Name, i))
					continue
				}
				if url := getStringField(gitRepo.GetFields(), "url"); !strings.HasPrefix(url, "https://") {
					errors = append(errors, fmt.Sprintf("task '%s' (agent_call): workspace_entries[%d] url must use HTTPS (e.g. https://github.com/org/repo). SSH URLs are not supported.", task.Name, i))
				}
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
