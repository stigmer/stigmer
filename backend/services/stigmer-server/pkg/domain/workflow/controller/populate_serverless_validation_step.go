package workflow

import (
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
)

// populateServerlessValidationStep copies the ServerlessWorkflowValidation
// result from pipeline context into workflow.status.serverless_workflow_validation.
//
// This ensures the generated CNCF YAML and validation state are persisted with
// the workflow so that HydrateWorkflowExecution can read the YAML at execution time.
//
// The validation result is placed in context by validateWorkflowSpecStep.
// Only VALID results reach this step (INVALID/FAILED abort the pipeline earlier).
type populateServerlessValidationStep struct{}

func newPopulateServerlessValidationStep() *populateServerlessValidationStep {
	return &populateServerlessValidationStep{}
}

func (s *populateServerlessValidationStep) Name() string {
	return "PopulateServerlessValidation"
}

func (s *populateServerlessValidationStep) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	wf := ctx.NewState()
	workflowID := ""
	if wf.GetMetadata() != nil {
		workflowID = wf.GetMetadata().GetId()
	}

	validation, ok := ctx.Get(ServerlessValidationKey).(*serverlessv1.ServerlessWorkflowValidation)
	if !ok || validation == nil {
		log.Warn().
			Str("workflow_id", workflowID).
			Msg("Serverless validation result not found in context - skipping population")
		return nil
	}

	log.Debug().
		Str("workflow_id", workflowID).
		Int("yaml_length", len(validation.Yaml)).
		Str("state", validation.State.String()).
		Msg("Populating serverless validation in workflow status")

	if wf.Status == nil {
		wf.Status = &workflowv1.WorkflowStatus{}
	}
	wf.Status.ServerlessWorkflowValidation = validation

	ctx.SetNewState(wf)

	log.Debug().
		Str("workflow_id", workflowID).
		Msg("Successfully populated serverless validation")

	return nil
}

// populateServerlessValidationStepForUpdate is identical to the create variant
// but returns an error if validation is missing (since update always re-validates).
type populateServerlessValidationStepForUpdate struct{}

func newPopulateServerlessValidationStepForUpdate() *populateServerlessValidationStepForUpdate {
	return &populateServerlessValidationStepForUpdate{}
}

func (s *populateServerlessValidationStepForUpdate) Name() string {
	return "PopulateServerlessValidation"
}

func (s *populateServerlessValidationStepForUpdate) Execute(ctx *pipeline.RequestContext[*workflowv1.Workflow]) error {
	wf := ctx.NewState()
	workflowID := ""
	if wf.GetMetadata() != nil {
		workflowID = wf.GetMetadata().GetId()
	}

	raw := ctx.Get(ServerlessValidationKey)
	if raw == nil {
		log.Warn().
			Str("workflow_id", workflowID).
			Msg("Serverless validation result not found in context - validator may be disabled")
		return nil
	}
	validation, ok := raw.(*serverlessv1.ServerlessWorkflowValidation)
	if !ok || validation == nil {
		return fmt.Errorf("serverless validation result not found in context for workflow %s", workflowID)
	}

	if wf.Status == nil {
		wf.Status = &workflowv1.WorkflowStatus{}
	}
	wf.Status.ServerlessWorkflowValidation = validation

	ctx.SetNewState(wf)

	log.Debug().
		Str("workflow_id", workflowID).
		Int("yaml_length", len(validation.Yaml)).
		Msg("Refreshed serverless validation on update")

	return nil
}
