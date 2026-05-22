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

// validateWorkflowSpecStep validates WorkflowSpec by converting it to CNCF
// Serverless Workflow DSL YAML and running structural + cross-reference
// validation. The generated YAML is stored in pipeline context for use by
// the populateServerlessValidation step.
//
// This step performs Layer 2 of workflow validation:
//  1. Layer 1: Proto Validation - Already handled by ValidateProtoStep (buf validate rules)
//  2. Layer 2: In-process validation - Converts proto to CNCF YAML, validates structure
//
// Validation Result Storage:
// The validation result (ServerlessWorkflowValidation) is stored in pipeline context
// using ServerlessValidationKey. The populateServerlessValidation step retrieves this
// result to populate WorkflowStatus.serverless_workflow_validation.
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
