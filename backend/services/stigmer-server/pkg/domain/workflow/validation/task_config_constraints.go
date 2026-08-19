package validation

import (
	"errors"
	"fmt"
	"strconv"
	"strings"

	"buf.build/go/protovalidate"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/converter"
	"google.golang.org/protobuf/proto"
)

// ValidateTaskConfigConstraints runs protovalidate over every task's
// strict-unmarshaled typed config — the declarative half of Layer-2 task-config
// validation (stigmer#805).
//
// Layer 1 (RPC-level protovalidate) cannot see inside task_config because it is
// an opaque google.protobuf.Struct on the wire; the rules declared on the typed
// task-config protos (required fields, bounds, CEL rules like wait's
// duration.non_zero) only become checkable after the strict unmarshal. This
// step closes that gap for every task, including tasks nested inside
// control-flow configs (for_each/fork/try_catch do blocks) and compensate
// lists, which no other validation layer reaches.
//
// The rendered string is "task '<name>' (<kind>): <path> – <message>" — the
// task prefix matches this package's other validators, the violation half is
// the shared cross-edition FormatViolation rendering. The cloud Java validator
// mirrors this step byte-for-byte (see InProcessWorkflowValidator); the
// conformance suite pins the exact string on both editions.
//
// A non-nil error is a fault in the validation machinery itself (never a
// user-fixable spec problem) and surfaces as a system error, mirroring the
// Layer-1 contract.
func ValidateTaskConfigConstraints(spec *workflowv1.WorkflowSpec) ([]string, error) {
	if spec == nil || len(spec.Tasks) == 0 {
		return nil, nil
	}

	var violations []string
	for _, task := range spec.Tasks {
		taskViolations, err := taskConstraintViolations(task)
		if err != nil {
			return nil, err
		}
		violations = append(violations, taskViolations...)
	}
	return violations, nil
}

// taskConstraintViolations validates one task's typed config and recurses into
// the tasks nested inside it. Iteration order is part of the cross-edition
// contract (the persist gate surfaces errors[0]): the task's own violations
// first, then nested tasks in declaration order, then the compensate list.
func taskConstraintViolations(task *workflowv1.WorkflowTask) ([]string, error) {
	var out []string

	if task.TaskConfig != nil {
		cfg, err := converter.UnmarshalTaskConfigPublic(task.Kind, task.TaskConfig)
		if err == nil {
			violations, sysErr := configConstraintViolations(cfg)
			if sysErr != nil {
				return nil, sysErr
			}
			for _, v := range violations {
				out = append(out, fmt.Sprintf("task '%s' (%s): %s", task.Name, task.Kind.String(), v))
			}
			for _, nested := range nestedTasks(cfg) {
				nestedViolations, sysErr := taskConstraintViolations(nested)
				if sysErr != nil {
					return nil, sysErr
				}
				out = append(out, nestedViolations...)
			}
		}
		// An unmarshal failure is a structural defect the conversion step has
		// already reported as INVALID — never double-report it here.
	}

	for _, comp := range task.Compensate {
		compViolations, sysErr := taskConstraintViolations(comp)
		if sysErr != nil {
			return nil, sysErr
		}
		out = append(out, compViolations...)
	}

	return out, nil
}

// configConstraintViolations runs the shared protovalidate validator over one
// typed task config. protovalidate descends into nested messages on its own,
// so a parent config's run also covers the scalar fields of tasks nested in it
// (their task_config is a Struct again — that is what the walker's recursion
// is for).
func configConstraintViolations(cfg proto.Message) ([]string, error) {
	err := grpclib.SharedValidator().Validate(cfg)
	if err == nil {
		return nil, nil
	}

	var validationErr *protovalidate.ValidationError
	if errors.As(err, &validationErr) {
		out := make([]string, 0, len(validationErr.Violations))
		for _, v := range validationErr.Violations {
			out = append(out, FormatViolation(v))
		}
		return out, nil
	}

	// Anything other than a ValidationError is a fault in the validation
	// machinery itself, not a user-fixable spec problem.
	return nil, err
}

// nestedTasks returns the WorkflowTask lists embedded in a control-flow task
// config, in declaration order — the same recursion set the converter walks
// (convertForTask/convertForkTask/convertTryTask) and the cloud Java
// TaskConfigStrictParser mirrors.
func nestedTasks(cfg proto.Message) []*workflowv1.WorkflowTask {
	switch c := cfg.(type) {
	case *tasksv1.ForTaskConfig:
		return c.Do
	case *tasksv1.ForkTaskConfig:
		var out []*workflowv1.WorkflowTask
		for _, branch := range c.Branches {
			out = append(out, branch.Do...)
		}
		return out
	case *tasksv1.TryTaskConfig:
		out := append([]*workflowv1.WorkflowTask{}, c.Try...)
		if c.Catch != nil {
			out = append(out, c.Catch.Do...)
		}
		return out
	}
	return nil
}

// FormatViolation renders one protovalidate violation as "<field.path> – <message>",
// matching the Cloud Java formatter exactly (en-dash separator, "<message>"
// sentinel when the rule is message-level, and [index] / ['key'] subscripts for
// repeated/map elements) — see prettyPrint / renderPath in
// backend/libs/java/utils/.../ProtoMessageFieldsValidator.java. Both editions
// emit identical strings for the same violation at Layer 1 (whole-resource
// validation) and Layer 2 (typed task configs). Keep the two formatters in
// lockstep.
func FormatViolation(v *protovalidate.Violation) string {
	message := v.Proto.GetMessage()
	if !v.Proto.HasField() {
		return "<message> \u2013 " + message
	}

	var sb strings.Builder
	for _, el := range v.Proto.GetField().GetElements() {
		if sb.Len() > 0 {
			sb.WriteByte('.')
		}
		// Prefer the field name; fall back to the field number when unknown.
		if el.HasFieldName() {
			sb.WriteString(el.GetFieldName())
		} else {
			sb.WriteString(strconv.Itoa(int(el.GetFieldNumber())))
		}
		// Repeated index or map key subscript, if present.
		switch {
		case el.HasIndex():
			sb.WriteString("[" + strconv.FormatUint(el.GetIndex(), 10) + "]")
		case el.HasBoolKey():
			sb.WriteString("[" + strconv.FormatBool(el.GetBoolKey()) + "]")
		case el.HasIntKey():
			sb.WriteString("[" + strconv.FormatInt(el.GetIntKey(), 10) + "]")
		case el.HasUintKey():
			sb.WriteString("[" + strconv.FormatUint(el.GetUintKey(), 10) + "]")
		case el.HasStringKey():
			sb.WriteString("['" + el.GetStringKey() + "']")
		}
	}

	return sb.String() + " \u2013 " + message
}
