/*
 * Copyright 2026 Leftbin/Stigmer
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package validation

import (
	"fmt"
	"sort"
	"strings"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// ValidateCrossTaskReferences checks that all task-name references within a
// workflow point to tasks that actually exist in the same workflow.
//
// Reference fields checked:
//   - llm_call.fallbackTask / fallback_task
//   - agent_call.output.fallbackTask / fallback_task
//   - validate.fallbackTask / fallback_task
//   - switch_case.cases[].then
//   - human_input.outcomes[].then
//
// Extracts references directly from the google.protobuf.Struct task_config
// rather than unmarshaling into typed proto messages. This avoids triggering
// buf.validate constraints on optional fields (which can fail for unset
// fields with min > 0 like max_tokens, timeout, max_retries).
//
// Returns nil if all references are valid, or a ValidationErrors with
// descriptive messages (including "did you mean?" suggestions for typos).
func ValidateCrossTaskReferences(spec *workflowv1.WorkflowSpec) error {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	taskNames := buildTaskNameSet(spec.Tasks)
	var errors []ValidationError

	for _, task := range spec.Tasks {
		if task.TaskConfig == nil {
			continue
		}

		taskErrors := extractAndValidateRefs(task.Name, task.Kind, task.TaskConfig, taskNames)
		errors = append(errors, taskErrors...)
	}

	if len(errors) == 0 {
		return nil
	}
	return &ValidationErrors{Errors: errors}
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

// extractAndValidateRefs pulls task-name references from the Struct directly
// and validates each one against the known task names.
func extractAndValidateRefs(
	taskName string,
	kind workflowv1.WorkflowTaskKind,
	config *structpb.Struct,
	validNames map[string]bool,
) []ValidationError {
	var errors []ValidationError
	fields := config.GetFields()

	switch kind {
	case workflowv1.WorkflowTaskKind_llm_call,
		workflowv1.WorkflowTaskKind_validate:
		if ref := getStringField(fields, "fallbackTask", "fallback_task"); ref != "" {
			if err := validateRef(taskName, kind, "fallback_task", ref, validNames); err != nil {
				errors = append(errors, *err)
			}
		}

	case workflowv1.WorkflowTaskKind_agent_call:
		if output := getStructField(fields, "output"); output != nil {
			if ref := getStringField(output.GetFields(), "fallbackTask", "fallback_task"); ref != "" {
				if err := validateRef(taskName, kind, "output.fallback_task", ref, validNames); err != nil {
					errors = append(errors, *err)
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
			if ref := getStringField(caseStruct.GetFields(), "then"); ref != "" {
				fieldPath := fmt.Sprintf("cases[%d].then", i)
				if err := validateRef(taskName, kind, fieldPath, ref, validNames); err != nil {
					errors = append(errors, *err)
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
			if ref := getStringField(outcomeStruct.GetFields(), "then"); ref != "" {
				fieldPath := fmt.Sprintf("outcomes[%d].then", i)
				if err := validateRef(taskName, kind, fieldPath, ref, validNames); err != nil {
					errors = append(errors, *err)
				}
			}
		}
	}

	return errors
}

// getStringField returns the string value of a field, checking multiple
// possible key names (camelCase and snake_case). Returns empty string if
// the field is not found or is not a string.
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

// getStructField returns a nested Struct field value by key name.
func getStructField(fields map[string]*structpb.Value, keys ...string) *structpb.Struct {
	for _, key := range keys {
		if v, ok := fields[key]; ok {
			return v.GetStructValue()
		}
	}
	return nil
}

// getListField returns a list field value by key name.
func getListField(fields map[string]*structpb.Value, key string) []*structpb.Value {
	if v, ok := fields[key]; ok {
		if list := v.GetListValue(); list != nil {
			return list.GetValues()
		}
	}
	return nil
}

func validateRef(
	taskName string,
	kind workflowv1.WorkflowTaskKind,
	fieldPath string,
	targetName string,
	validNames map[string]bool,
) *ValidationError {
	if validNames[targetName] {
		return nil
	}

	suggestion := suggestSimilar(targetName, validNames)
	msg := fmt.Sprintf(
		"references task '%s' which does not exist in this workflow",
		targetName,
	)
	if suggestion != "" {
		msg += fmt.Sprintf(" (did you mean '%s'?)", suggestion)
	}

	return &ValidationError{
		TaskName:  taskName,
		TaskKind:  kind.String(),
		FieldPath: fieldPath,
		Message:   msg,
	}
}

// suggestSimilar finds the closest task name using Levenshtein distance.
// Returns empty string if no name is close enough (distance > 3).
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
