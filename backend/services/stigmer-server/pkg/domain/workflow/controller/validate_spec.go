package workflow

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"buf.build/go/protovalidate"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/validation"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ValidateSpec validates a workflow spec without persisting it.
//
// It runs the same two validation layers as Create/Update, but with the
// opposite failure contract: it never throws for a user-fixable spec problem.
// Instead it always returns a structured ServerlessWorkflowValidation that a
// client can render field-by-field:
//
//	Layer 1: generic proto field constraints (protovalidate).
//	Layer 2: workflow-domain in-process validation (proto -> CNCF YAML +
//	         structural / cross-reference / model / budget checks).
//
// gRPC errors are reserved for input that cannot be validated at all (a nil
// workflow or spec) and for genuine internal faults (the validation machinery
// itself failing). Everything a user can fix comes back as
// ServerlessWorkflowValidation{state: INVALID, errors: [...]}.
//
// This RPC does NOT persist, authorize, or create instances.
//
// NOTE: unlike Create/Update, ValidateSpec is intentionally not built on the
// request pipeline framework. A pipeline aborts on the first step error (see
// pipeline.Execute), which is exactly what the persist path wants — an invalid
// workflow must never be stored. ValidateSpec needs the inverse: it must collect
// the verdict across both layers and always return it. Like GetByReference, this
// branching read/compute flow reads more honestly written directly.
func (c *WorkflowController) ValidateSpec(ctx context.Context, workflow *workflowv1.Workflow) (*serverlessv1.ServerlessWorkflowValidation, error) {
	if workflow == nil || workflow.Spec == nil {
		return nil, grpclib.InvalidArgumentError("workflow and workflow.spec are required")
	}

	// Layer 1: generic proto field constraints. Violations are folded into the
	// structured result (not thrown), and we short-circuit: Layer 2's converter
	// assumes well-typed input, so running it after a Layer-1 failure would only
	// re-report the same defect. This mirrors Cloud's WorkflowValidateSpecHandler.
	violations, err := protoFieldViolations(workflow)
	if err != nil {
		return nil, grpclib.InternalError(err, "workflow validation could not run")
	}
	if len(violations) > 0 {
		return &serverlessv1.ServerlessWorkflowValidation{
			State:       serverlessv1.ValidationState_INVALID,
			Errors:      violations,
			ValidatedAt: timestamppb.Now(),
		}, nil
	}

	// Layer 2: workflow-domain structural validation. The validator returns a
	// structured verdict for every state (VALID / INVALID / FAILED); only a Go
	// error signals a genuine internal fault.
	if c.validator == nil {
		return nil, grpclib.InternalError(
			fmt.Errorf("workflow validator not configured"),
			"workflow validation is unavailable",
		)
	}
	validation, err := c.validator.Validate(ctx, workflow.Spec)
	if err != nil {
		return nil, grpclib.InternalError(err, "workflow validation system error")
	}

	return validation, nil
}

// protoValidator is a process-wide, threadsafe protovalidate validator. It is
// built once on first use; a construction failure is remembered and surfaced to
// every caller as a system error rather than a panic.
var (
	protoValidatorOnce sync.Once
	protoValidator     protovalidate.Validator
	protoValidatorErr  error
)

// protoFieldViolations runs Layer-1 proto field-constraint validation on msg and
// returns each violation as a human-readable string. A return of (nil, nil)
// means the message satisfies all field constraints. A non-nil systemErr means
// the validator itself could not run (a genuine internal fault, not a user
// error) and must surface as a gRPC INTERNAL status.
//
// The per-violation format is a deliberate, byte-for-byte mirror of the Cloud
// (Java) formatter — see prettyPrint / renderPath in
// backend/libs/java/utils/.../ProtoMessageFieldsValidator.java. Both editions
// therefore emit identical Layer-1 strings ("<field.path> – <message>", with a
// "<message>" sentinel for message-level rules and [index] / ['key'] subscripts)
// for the same spec. Keep the two formatters in lockstep.
func protoFieldViolations(msg proto.Message) (violations []string, systemErr error) {
	protoValidatorOnce.Do(func() {
		protoValidator, protoValidatorErr = protovalidate.New()
	})
	if protoValidatorErr != nil {
		return nil, fmt.Errorf("failed to initialize proto validator: %w", protoValidatorErr)
	}

	err := protoValidator.Validate(msg)
	if err == nil {
		return nil, nil
	}

	var validationErr *protovalidate.ValidationError
	if errors.As(err, &validationErr) {
		violations = make([]string, 0, len(validationErr.Violations))
		for _, v := range validationErr.Violations {
			// The shared cross-edition rendering ("<field.path> – <message>")
			// lives with the Layer-2 constraints step; both layers must emit
			// identical strings for the same violation.
			violations = append(violations, validation.FormatViolation(v))
		}
		return violations, nil
	}

	// Anything other than a ValidationError is a fault in the validation
	// machinery itself, not a user-fixable spec problem.
	return nil, err
}
