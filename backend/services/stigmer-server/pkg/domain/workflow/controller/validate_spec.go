package workflow

import (
	"context"
	"fmt"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	grpclib "github.com/stigmer/stigmer/backend/libs/go/grpc"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"google.golang.org/grpc/codes"
)

// ValidateSpec validates a workflow spec without persisting it.
//
// Runs the same two-layer validation pipeline used by Create/Update:
//
//	Layer 1: Proto field constraints (buf validate / protovalidate)
//	Layer 2: Temporal-based structural validation (Go activity: proto → YAML → Zigflow)
//
// Returns ServerlessWorkflowValidation with VALID, INVALID, or FAILED state.
// Does NOT persist, authorize, create instances, or produce any side effects.
func (c *WorkflowController) ValidateSpec(ctx context.Context, workflow *workflowv1.Workflow) (*serverlessv1.ServerlessWorkflowValidation, error) {
	if workflow == nil || workflow.Spec == nil {
		return nil, grpclib.InvalidArgumentError("workflow and workflow.spec are required")
	}

	reqCtx := pipeline.NewRequestContext(ctx, workflow)

	p := c.buildValidateSpecPipeline()

	if err := p.Execute(reqCtx); err != nil {
		log.Warn().Err(err).Msg("ValidateSpec pipeline failed")
		return nil, err
	}

	validation, ok := reqCtx.Get(ServerlessValidationKey).(*serverlessv1.ServerlessWorkflowValidation)
	if !ok || validation == nil {
		return nil, grpclib.WrapError(
			fmt.Errorf("validation result not found in pipeline context"),
			codes.Internal,
			"Workflow validation completed but result was not captured",
		)
	}

	return validation, nil
}

// buildValidateSpecPipeline constructs a minimal pipeline for spec-only validation.
// Only the validation steps from the create pipeline -- no slug, no persist, no instances.
func (c *WorkflowController) buildValidateSpecPipeline() *pipeline.Pipeline[*workflowv1.Workflow] {
	return pipeline.NewPipeline[*workflowv1.Workflow]("workflow-validate-spec").
		AddStep(steps.NewValidateProtoStep[*workflowv1.Workflow]()).  // Layer 1: Proto field constraints
		AddStep(newValidateWorkflowSpecStep(c.validator)).            // Layer 2: Temporal (proto → YAML → Zigflow)
		Build()
}
