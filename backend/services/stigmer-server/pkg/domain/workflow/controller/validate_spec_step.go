package workflow

import (
	"fmt"

	"github.com/rs/zerolog/log"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/temporal"
)

// Context keys for inter-step communication
const (
	ServerlessValidationKey = "serverless_validation"
)

// validateWorkflowSpecStep validates WorkflowSpec using Temporal workflow validation.
//
// This step performs Layer 2 of workflow validation:
// 1. Layer 1: Proto Validation - Already handled by ValidateProtoStep (buf validate rules)
// 2. Layer 2: Comprehensive Validation - Deep validation via Temporal workflow
//    (executes ValidateWorkflow activity in workflow-runner using Zigflow parser)
//
// The step should be added to the request pipeline AFTER ValidateProtoStep:
//
//	.AddStep(steps.NewValidateProtoStep[*workflowv1.Workflow]())  // Layer 1: Proto
//	.AddStep(newValidateWorkflowSpecStep(validator))              // Layer 2: Temporal (SSOT)
//
// Single Source of Truth:
// We rely on workflow-runner's ValidateWorkflow activity as the authoritative validator.
// The Go activity:
// - Converts WorkflowSpec proto → Serverless Workflow YAML
// - Validates YAML using Zigflow parser
// - Returns ServerlessWorkflowValidation with state (VALID/INVALID/FAILED)
//
// Validation Result Storage:
// The validation result (ServerlessWorkflowValidation) is stored in pipeline context
// using ServerlessValidationKey. Subsequent pipeline steps (like populateServerlessValidation)
// can retrieve this result to populate WorkflowStatus.serverless_workflow_validation.
//
// Error Handling:
// - Layer 2 INVALID: User errors (bad structure, conversion failure) → error returned
// - Layer 2 FAILED: System errors (Temporal/activity failures) → error returned
//
// Performance:
// - Layer 1: <50ms (proto validation)
// - Layer 2: 50-200ms (Temporal workflow: conversion + validation)
// - Total: 100-250ms (acceptable for creation UX)
type validateWorkflowSpecStep struct {
	validator *temporal.ServerlessWorkflowValidator
}

func newValidateWorkflowSpecStep(validator *temporal.ServerlessWorkflowValidator) *validateWorkflowSpecStep {
	return &validateWorkflowSpecStep{validator: validator}
}

func (s *validateWorkflowSpecStep) Name() string {
	return "ValidateWorkflowSpec"
}

func (s *validateWorkflowSpecStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	// Skip validation if validator is not available (e.g., Temporal not running)
	if s.validator == nil {
		log.Warn().Msg("Skipping workflow validation - Temporal validator not available")
		return nil
	}

	workflow := ctx.Input()

	if workflow == nil || workflow.Spec == nil {
		return fmt.Errorf("workflow or workflow spec is nil")
	}

	spec := workflow.Spec

	log.Debug().Msg("Starting Layer 2: Temporal validation (converts + validates)")

	// Execute validation via Temporal workflow
	// This calls ValidateWorkflowWorkflow which executes the ValidateWorkflow activity
	// The activity converts proto → YAML and validates using Zigflow
	validation, err := s.validator.Validate(ctx.Context(), spec)
	if err != nil {
		log.Error().
			Err(err).
			Msg("Layer 2: Temporal workflow execution failed")
		return fmt.Errorf("workflow validation system error: %w", err)
	}

	// Store validation result in context for later use (e.g., by populateServerlessValidation step)
	ctx.Set(ServerlessValidationKey, validation)

	// Check validation state
	switch validation.State {
	case serverlessv1.ValidationState_VALID:
		log.Info().
			Int("warnings", len(validation.Warnings)).
			Msg("✓ Layer 2: Validation passed (state: VALID)")
		log.Info().Msg("Workflow validation completed successfully: All layers passed")
		return nil

	case serverlessv1.ValidationState_INVALID:
		log.Warn().
			Int("errors", len(validation.Errors)).
			Int("warnings", len(validation.Warnings)).
			Msg("Layer 2: Validation failed (state: INVALID)")

		errorMessage := "workflow structure validation failed"
		if len(validation.Errors) > 0 {
			errorMessage = validation.Errors[0]
		}

		return fmt.Errorf("workflow validation failed: %s", errorMessage)

	case serverlessv1.ValidationState_FAILED:
		log.Error().
			Int("errors", len(validation.Errors)).
			Msg("Layer 2: Validation system error (state: FAILED)")

		systemError := "validation system encountered an error"
		if len(validation.Errors) > 0 {
			systemError = validation.Errors[0]
		}

		return fmt.Errorf("workflow validation system error: %s", systemError)

	default:
		log.Error().
			Str("state", validation.State.String()).
			Msg("Layer 2: Unknown validation state")
		return fmt.Errorf("workflow validation returned unknown state: %s", validation.State.String())
	}
}
