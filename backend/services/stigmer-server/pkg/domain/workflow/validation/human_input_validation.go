package validation

import (
	"fmt"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"google.golang.org/protobuf/types/known/structpb"
)

// ValidateHumanInputTimeoutPolicies validates human_input timeout policies
// against the shapes the runtime honors. FAIL/APPROVE/DENY need no shape.
// HUMAN_INPUT_TIMEOUT_ESCALATE carries the outcome-by-name contract
// (stigmer/stigmer#781): a timeout resolves to the outcome NAMED "escalate"
// and follows its `then` branch, so the policy is only valid when such an
// outcome exists with `then` set. Fail closed — a gate whose escalation has
// nowhere to go must never persist; the runner's loader carries the same
// check for hand-written YAML. Whether the `then` TARGET exists (and the
// graph stays acyclic) is ValidateCrossTaskReferences' job — this rule
// checks shape, not reachability, so the layers compose without duplication.
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
		fields := task.TaskConfig.GetFields()
		value, ok := fields["on_timeout"]
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
		if !isEscalate {
			continue
		}

		if !hasEscalateOutcomeWithThen(fields["outcomes"]) {
			errors = append(errors, fmt.Sprintf(
				"task '%s' (human_input): on_timeout policy %s requires an outcome named 'escalate' with 'then' set — the timeout resolves to that outcome and follows its 'then' branch",
				task.Name,
				escalate.String(),
			))
		}
	}
	return errors
}

// hasEscalateOutcomeWithThen reports whether the raw `outcomes` value carries
// an outcome named "escalate" whose `then` is a non-empty string — the shape
// the escalate timeout policy resolves to at runtime.
func hasEscalateOutcomeWithThen(outcomes *structpb.Value) bool {
	list := outcomes.GetListValue()
	if list == nil {
		return false
	}
	for _, entry := range list.GetValues() {
		outcome := entry.GetStructValue()
		if outcome == nil {
			continue
		}
		fields := outcome.GetFields()
		if fields["name"].GetStringValue() != "escalate" {
			continue
		}
		if fields["then"].GetStringValue() != "" {
			return true
		}
	}
	return false
}
