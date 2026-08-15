package validation

import (
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"google.golang.org/protobuf/types/known/structpb"
)

// ValidateHumanInputTimeoutPolicies rejects human_input timeout policies the
// runtime cannot honor. HUMAN_INPUT_TIMEOUT_ESCALATE is declared in the proto
// but has no runner implementation (stigmer/stigmer#779; implementation
// tracked in stigmer/stigmer#781): before this rule a
// workflow carrying it validated, applied, and then silently behaved as FAIL
// at the gate's first timeout. Fail closed here — a config that cannot run
// must never persist. The runner's loader carries the same refusal for
// already-persisted YAML.
//
// The rule reads the raw task_config Struct like its siblings
// (ValidateTaskConfigRequiredFields et al.) so the error speaks the author's
// own vocabulary. protojson accepts an enum by name or by number, so both
// spellings are checked.
func ValidateHumanInputTimeoutPolicies(spec *workflowv1.WorkflowSpec) []string {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil
	}

	escalate := tasksv1.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_ESCALATE

	var errors []string
	for _, task := range spec.Tasks {
		if task == nil || task.Kind != workflowv1.WorkflowTaskKind_human_input || task.TaskConfig == nil {
			continue
		}
		value, ok := task.TaskConfig.GetFields()["on_timeout"]
		if !ok {
			continue
		}

		isEscalate := false
		switch v := value.GetKind().(type) {
		case *structpb.Value_StringValue:
			isEscalate = v.StringValue == escalate.String()
		case *structpb.Value_NumberValue:
			isEscalate = v.NumberValue == float64(escalate.Number())
		}

		if isEscalate {
			errors = append(errors, fmt.Sprintf(
				"task '%s' (human_input): on_timeout policy %s is not implemented yet — use %s, %s, or %s (custom outcomes with 'then' cover reviewer-driven branching)",
				task.Name,
				escalate.String(),
				tasksv1.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_FAIL.String(),
				tasksv1.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_APPROVE.String(),
				tasksv1.HumanInputTimeoutPolicy_HUMAN_INPUT_TIMEOUT_DENY.String(),
			))
		}
	}
	return errors
}
