package validation

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/converter"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// WorkflowValidator validates a WorkflowSpec and returns a ServerlessWorkflowValidation.
// This is the interface that the pipeline step depends on.
type WorkflowValidator interface {
	Validate(ctx context.Context, spec *workflowv1.WorkflowSpec) (*serverlessv1.ServerlessWorkflowValidation, error)
}

// InProcessValidator validates WorkflowSpec proto entirely in-process without
// Temporal. It converts the spec to CNCF Serverless Workflow DSL YAML, runs
// cross-reference validation, and produces budget warnings.
//
// This replaces the Temporal-based ServerlessWorkflowValidator that dispatched
// validation to the now-deleted Go workflow-runner.
type InProcessValidator struct {
	converter *converter.Converter
}

// NewInProcessValidator creates a new in-process workflow validator.
func NewInProcessValidator() *InProcessValidator {
	return &InProcessValidator{
		converter: converter.NewConverter(),
	}
}

// Validate converts WorkflowSpec proto to CNCF YAML and validates it.
//
// Returns ServerlessWorkflowValidation with:
//   - VALID: Conversion succeeded, no structural errors
//   - INVALID: User error (bad structure, missing fields, invalid references)
//   - FAILED: System error (converter crash)
//
// The yaml field always contains the generated CNCF YAML when conversion
// succeeds (even for INVALID state), as it aids debugging.
func (v *InProcessValidator) Validate(ctx context.Context, spec *workflowv1.WorkflowSpec) (*serverlessv1.ServerlessWorkflowValidation, error) {
	if spec == nil {
		return &serverlessv1.ServerlessWorkflowValidation{
			State:       serverlessv1.ValidationState_FAILED,
			Errors:      []string{"WorkflowSpec cannot be nil"},
			ValidatedAt: timestamppb.Now(),
		}, nil
	}

	log.Debug().Msg("Starting in-process workflow validation")

	// Step 0: Task kind validation (fail fast for unknown kinds)
	if kindErrors := ValidateTaskKinds(spec); len(kindErrors) > 0 {
		return &serverlessv1.ServerlessWorkflowValidation{
			State:       serverlessv1.ValidationState_INVALID,
			Errors:      kindErrors,
			ValidatedAt: timestamppb.Now(),
		}, nil
	}

	// Step 1: Convert proto to CNCF YAML
	yaml, err := v.converter.ProtoToYAML(spec)
	if err != nil {
		log.Error().Err(err).Msg("YAML generation failed")
		return &serverlessv1.ServerlessWorkflowValidation{
			State:       serverlessv1.ValidationState_INVALID,
			Errors:      []string{fmt.Sprintf("Failed to generate YAML: %v", err)},
			ValidatedAt: timestamppb.Now(),
		}, nil
	}

	log.Debug().Int("yaml_length", len(yaml)).Msg("YAML generation succeeded")

	var errors []string
	var warnings []string

	// Step 2: Cross-reference validation (unique names, flow.then targets, cycles)
	if crossRefErrors := ValidateCrossTaskReferences(spec); len(crossRefErrors) > 0 {
		errors = append(errors, crossRefErrors...)
	}

	// Step 2b: Task config required field validation
	if configErrors := ValidateTaskConfigRequiredFields(spec); len(configErrors) > 0 {
		errors = append(errors, configErrors...)
	}

	// Step 2c: Model reference validation (harness-aware)
	if modelErrors := ValidateModelReferences(spec); len(modelErrors) > 0 {
		errors = append(errors, modelErrors...)
	}

	// Step 2d: Human-input timeout policy validation (fail closed on
	// policies the runtime cannot honor)
	if policyErrors := ValidateHumanInputTimeoutPolicies(spec); len(policyErrors) > 0 {
		errors = append(errors, policyErrors...)
	}

	// Step 3: Budget warnings
	if budgetWarnings := CheckBudgetWarnings(spec.Budget, spec.Tasks); len(budgetWarnings) > 0 {
		warnings = append(warnings, budgetWarnings...)
	}

	// Step 4: Expression warnings ($context.env.* → should be $env.*)
	if exprWarnings := CheckExpressionWarnings(spec); len(exprWarnings) > 0 {
		warnings = append(warnings, exprWarnings...)
	}

	if len(errors) > 0 {
		log.Warn().
			Int("errors", len(errors)).
			Int("warnings", len(warnings)).
			Msg("Validation failed (state: INVALID)")
		return &serverlessv1.ServerlessWorkflowValidation{
			State:       serverlessv1.ValidationState_INVALID,
			Yaml:        yaml,
			Errors:      errors,
			Warnings:    warnings,
			ValidatedAt: timestamppb.Now(),
		}, nil
	}

	log.Info().
		Int("warnings", len(warnings)).
		Msg("Validation passed (state: VALID)")

	return &serverlessv1.ServerlessWorkflowValidation{
		State:       serverlessv1.ValidationState_VALID,
		Yaml:        yaml,
		Errors:      errors,
		Warnings:    warnings,
		ValidatedAt: timestamppb.Now(),
	}, nil
}
