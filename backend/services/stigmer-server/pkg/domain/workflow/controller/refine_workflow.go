package workflow

import (
	"context"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/llmclient"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// RefineWorkflow applies a natural language instruction to an existing workflow YAML.
//
// Flow:
//  1. Resolve LLM model (from input or environment default)
//  2. Parse task kind registry for prompt context
//  3. Query store for org resources (agents, MCP servers, skills, workflows)
//  4. Build system + user prompts (refinement-specific)
//  5. Call LLM
//  6. Extract YAML and explanation from response
//  7. Validate YAML structure and task kinds
//  8. On validation failure, retry with error context (max 2 retries)
//  9. Return updated YAML, explanation, warnings, and model used
func (c *WorkflowController) RefineWorkflow(
	ctx context.Context,
	input *workflowv1.RefineWorkflowInput,
) (*workflowv1.RefineWorkflowOutput, error) {
	if c.llmClient == nil {
		return nil, status.Error(codes.FailedPrecondition,
			"workflow refinement is not available — no LLM client configured")
	}
	if len(c.taskKindRegistry) == 0 {
		return nil, status.Error(codes.FailedPrecondition,
			"workflow refinement is not available — task kind registry not loaded")
	}

	provider, model, err := c.resolveModel(input.GetModel())
	if err != nil {
		return nil, err
	}

	log.Info().
		Str("org", input.GetOrg()).
		Str("model", model).
		Str("provider", provider).
		Int("instruction_len", len(input.GetInstruction())).
		Int("yaml_len", len(input.GetCurrentYaml())).
		Msg("Starting workflow refinement")

	taskKinds, err := llmclient.ParseTaskKindSummaries(c.taskKindRegistry)
	if err != nil {
		log.Error().Err(err).Msg("Failed to parse task kind registry")
		return nil, status.Error(codes.Internal, "failed to load task kind registry")
	}

	orgCtx := c.buildOrgContext(ctx, input.GetOrg())

	systemPrompt, userPrompt := llmclient.BuildRefinementPrompt(
		input.GetCurrentYaml(), input.GetInstruction(), taskKinds, orgCtx,
	)

	var (
		refinedYAML string
		explanation string
		warnings    []string
	)

	for attempt := 0; attempt <= maxGenerationRetries; attempt++ {
		currentUserPrompt := userPrompt
		if attempt > 0 {
			log.Info().
				Int("attempt", attempt+1).
				Int("errors", len(warnings)).
				Msg("Retrying workflow refinement with validation feedback")
		}

		resp, llmErr := c.llmClient.ChatCompletion(ctx, llmclient.ChatCompletionRequest{
			Provider:     provider,
			Model:        model,
			SystemPrompt: systemPrompt,
			UserPrompt:   currentUserPrompt,
			MaxTokens:    8192,
			Temperature:  0.2,
		})
		if llmErr != nil {
			log.Error().Err(llmErr).Int("attempt", attempt+1).Msg("LLM call failed during refinement")
			return nil, llmErr
		}

		refinedYAML, explanation = llmclient.SplitYAMLAndExplanation(resp.Content)

		validationErrors := c.validateGeneratedYAML(refinedYAML, taskKinds)
		if len(validationErrors) == 0 {
			log.Info().
				Int("attempt", attempt+1).
				Int("yaml_len", len(refinedYAML)).
				Str("model", resp.Model).
				Msg("Workflow refinement succeeded")
			return &workflowv1.RefineWorkflowOutput{
				Yaml:        refinedYAML,
				Explanation: explanation,
				Warnings:    warnings,
				ModelUsed:   resp.Model,
			}, nil
		}

		if attempt == maxGenerationRetries {
			log.Warn().
				Int("errors", len(validationErrors)).
				Msg("Workflow refinement completed with validation warnings after max retries")
			warnings = append(warnings, validationErrors...)
			return &workflowv1.RefineWorkflowOutput{
				Yaml:        refinedYAML,
				Explanation: explanation,
				Warnings:    warnings,
				ModelUsed:   resp.Model,
			}, nil
		}

		warnings = validationErrors
		userPrompt = currentUserPrompt + llmclient.FormatValidationErrorsForRetry(validationErrors)
	}

	return &workflowv1.RefineWorkflowOutput{
		Yaml:        refinedYAML,
		Explanation: explanation,
		Warnings:    warnings,
	}, nil
}
