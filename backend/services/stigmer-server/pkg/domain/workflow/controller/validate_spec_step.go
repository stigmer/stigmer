package workflow

import (
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/validation"
)

const (
	ServerlessValidationKey = "serverless_validation"
)

// validateWorkflowSpecStep is the Create/Update persist-path validation gate. It
// performs Layer 2 of workflow validation (proto -> CNCF Serverless Workflow DSL
// YAML plus structural / cross-reference checks) and does two things at once:
//
//  1. Produce: it stores the ServerlessWorkflowValidation result in pipeline
//     context under ServerlessValidationKey, so populateServerlessValidation can
//     persist the generated YAML and state onto WorkflowStatus.
//  2. Gate: it returns an error for any non-VALID state, which aborts the
//     pipeline. This is intentional and correct for Create/Update — an invalid
//     workflow must never be persisted.
//
// This produce-and-gate behavior is exactly why ValidateSpec does NOT reuse this
// step: the validateSpec RPC must return the structured verdict for INVALID
// specs rather than abort. See ValidateSpec in validate_spec.go, which composes
// the same two layers directly with a non-throwing contract.
//
// Layer 1 (generic proto field constraints) runs before this step via
// steps.ValidateProtoStep in the Create/Update pipelines.
type validateWorkflowSpecStep struct {
	validator validation.WorkflowValidator
}

func newValidateWorkflowSpecStep(validator validation.WorkflowValidator) *validateWorkflowSpecStep {
	return &validateWorkflowSpecStep{validator: validator}
}

func (s *validateWorkflowSpecStep) Name() string {
	return "ValidateWorkflowSpec"
}

func (s *validateWorkflowSpecStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	if s.validator == nil {
		log.Warn().Msg("Skipping workflow validation - validator not available")
		return nil
	}

	workflow := ctx.Input()

	if workflow == nil || workflow.Spec == nil {
		return fmt.Errorf("workflow or workflow spec is nil")
	}

	spec := workflow.Spec

	log.Debug().Msg("Starting Layer 2: In-process validation (converts + validates)")

	validationResult, err := s.validator.Validate(ctx.Context(), spec)
	if err != nil {
		log.Error().
			Err(err).
			Msg("Layer 2: Validation execution failed")
		return fmt.Errorf("workflow validation system error: %w", err)
	}

	ctx.Set(ServerlessValidationKey, validationResult)

	switch validationResult.State {
	case serverlessv1.ValidationState_VALID:
		log.Info().
			Int("warnings", len(validationResult.Warnings)).
			Msg("Layer 2: Validation passed (state: VALID)")
		return nil

	case serverlessv1.ValidationState_INVALID:
		log.Warn().
			Int("errors", len(validationResult.Errors)).
			Int("warnings", len(validationResult.Warnings)).
			Msg("Layer 2: Validation failed (state: INVALID)")

		errorMessage := "workflow structure validation failed"
		if len(validationResult.Errors) > 0 {
			errorMessage = validationResult.Errors[0]
		}

		return fmt.Errorf("workflow validation failed: %s", errorMessage)

	case serverlessv1.ValidationState_FAILED:
		log.Error().
			Int("errors", len(validationResult.Errors)).
			Msg("Layer 2: Validation system error (state: FAILED)")

		systemError := "validation system encountered an error"
		if len(validationResult.Errors) > 0 {
			systemError = validationResult.Errors[0]
		}

		return fmt.Errorf("workflow validation system error: %s", systemError)

	default:
		log.Error().
			Str("state", validationResult.State.String()).
			Msg("Layer 2: Unknown validation state")
		return fmt.Errorf("workflow validation returned unknown state: %s", validationResult.State.String())
	}
}
