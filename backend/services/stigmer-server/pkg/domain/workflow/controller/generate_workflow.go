package workflow

import (
	"context"
	"fmt"
	"strings"

	"github.com/rs/zerolog/log"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	skillv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/skill/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/llmclient"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"gopkg.in/yaml.v3"
)

const maxGenerationRetries = 2

// GenerateWorkflowFromPrompt generates a workflow YAML from a natural language description.
//
// Flow:
//  1. Resolve LLM model (from input or environment default)
//  2. Parse task kind registry for prompt context
//  3. Query store for org resources (agents, MCP servers, skills, workflows)
//  4. Build system + user prompts
//  5. Call LLM
//  6. Extract YAML and explanation from response
//  7. Validate YAML structure and task kinds
//  8. On validation failure, retry with error context (max 2 retries)
//  9. Return generated YAML, explanation, warnings, and model used
func (c *WorkflowController) GenerateWorkflowFromPrompt(
	ctx context.Context,
	input *workflowv1.GenerateWorkflowFromPromptInput,
) (*workflowv1.GenerateWorkflowFromPromptOutput, error) {
	if c.llmClient == nil {
		return nil, status.Error(codes.FailedPrecondition,
			"workflow generation is not available — no LLM client configured")
	}
	if len(c.taskKindRegistry) == 0 {
		return nil, status.Error(codes.FailedPrecondition,
			"workflow generation is not available — task kind registry not loaded")
	}

	provider, model, err := c.resolveModel(input.GetModel())
	if err != nil {
		return nil, err
	}

	log.Info().
		Str("org", input.GetOrg()).
		Str("model", model).
		Str("provider", provider).
		Int("prompt_len", len(input.GetPrompt())).
		Msg("Starting workflow generation from prompt")

	taskKinds, err := llmclient.ParseTaskKindSummaries(c.taskKindRegistry)
	if err != nil {
		log.Error().Err(err).Msg("Failed to parse task kind registry")
		return nil, status.Error(codes.Internal, "failed to load task kind registry")
	}

	orgCtx := c.buildOrgContext(ctx, input.GetOrg())

	systemPrompt, userPrompt := llmclient.BuildGenerationPrompt(
		input.GetPrompt(), taskKinds, orgCtx, input.GetTaskKindHints(),
	)

	var (
		generatedYAML string
		explanation   string
		warnings      []string
	)

	for attempt := 0; attempt <= maxGenerationRetries; attempt++ {
		currentUserPrompt := userPrompt
		if attempt > 0 {
			log.Info().
				Int("attempt", attempt+1).
				Int("errors", len(warnings)).
				Msg("Retrying workflow generation with validation feedback")
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
			log.Error().Err(llmErr).Int("attempt", attempt+1).Msg("LLM call failed")
			return nil, llmErr
		}

		generatedYAML, explanation = llmclient.SplitYAMLAndExplanation(resp.Content)

		validationErrors := c.validateGeneratedYAML(generatedYAML, taskKinds)
		if len(validationErrors) == 0 {
			log.Info().
				Int("attempt", attempt+1).
				Int("yaml_len", len(generatedYAML)).
				Str("model", resp.Model).
				Msg("Workflow generation succeeded")
			return &workflowv1.GenerateWorkflowFromPromptOutput{
				Yaml:        generatedYAML,
				Explanation: explanation,
				Warnings:    warnings,
				ModelUsed:   resp.Model,
			}, nil
		}

		// On the last attempt, return what we have with validation errors as warnings
		if attempt == maxGenerationRetries {
			log.Warn().
				Int("errors", len(validationErrors)).
				Msg("Workflow generation completed with validation warnings after max retries")
			warnings = append(warnings, validationErrors...)
			return &workflowv1.GenerateWorkflowFromPromptOutput{
				Yaml:        generatedYAML,
				Explanation: explanation,
				Warnings:    warnings,
				ModelUsed:   resp.Model,
			}, nil
		}

		// Append validation errors to user prompt for retry
		warnings = validationErrors
		userPrompt = currentUserPrompt + llmclient.FormatValidationErrorsForRetry(validationErrors)
	}

	// Unreachable, but satisfies the compiler
	return &workflowv1.GenerateWorkflowFromPromptOutput{
		Yaml:        generatedYAML,
		Explanation: explanation,
		Warnings:    warnings,
	}, nil
}

// resolveModel determines the provider and model to use, preferring the
// user's explicit choice, then falling back to environment-configured defaults.
func (c *WorkflowController) resolveModel(requestedModel string) (provider, model string, err error) {
	if requestedModel != "" {
		p := resolveProviderFromModel(requestedModel)
		return p, requestedModel, nil
	}
	return llmclient.ResolveDefaultModel()
}

func resolveProviderFromModel(model string) string {
	m := strings.ToLower(model)
	switch {
	case strings.HasPrefix(m, "claude"):
		return "anthropic"
	case strings.HasPrefix(m, "gpt"), strings.HasPrefix(m, "o1"),
		strings.HasPrefix(m, "o3"), strings.HasPrefix(m, "o4"):
		return "openai"
	default:
		return "openai"
	}
}

// buildOrgContext queries the store for resources available in the org,
// providing the LLM with context about what agents, MCP servers, skills,
// and workflows exist so it can reference them in generated workflows.
func (c *WorkflowController) buildOrgContext(ctx context.Context, org string) llmclient.OrgContext {
	orgCtx := llmclient.OrgContext{}

	orgCtx.Agents = c.listResourceSummaries(ctx, apiresourcekind.ApiResourceKind_agent,
		func(data []byte) (string, string) {
			var a agentv1.Agent
			if err := proto.Unmarshal(data, &a); err != nil {
				return "", ""
			}
			return a.GetMetadata().GetName(), a.GetSpec().GetDescription()
		})

	orgCtx.McpServers = c.listResourceSummaries(ctx, apiresourcekind.ApiResourceKind_mcp_server,
		func(data []byte) (string, string) {
			var m mcpserverv1.McpServer
			if err := proto.Unmarshal(data, &m); err != nil {
				return "", ""
			}
			return m.GetMetadata().GetName(), m.GetSpec().GetDescription()
		})

	orgCtx.Skills = c.listResourceSummaries(ctx, apiresourcekind.ApiResourceKind_skill,
		func(data []byte) (string, string) {
			var s skillv1.Skill
			if err := proto.Unmarshal(data, &s); err != nil {
				return "", ""
			}
			return s.GetMetadata().GetName(), s.GetSpec().GetDescription()
		})

	orgCtx.Workflows = c.listResourceSummaries(ctx, apiresourcekind.ApiResourceKind_workflow,
		func(data []byte) (string, string) {
			var w workflowv1.Workflow
			if err := proto.Unmarshal(data, &w); err != nil {
				return "", ""
			}
			return w.GetMetadata().GetName(), w.GetSpec().GetDescription()
		})

	log.Debug().
		Int("agents", len(orgCtx.Agents)).
		Int("mcp_servers", len(orgCtx.McpServers)).
		Int("skills", len(orgCtx.Skills)).
		Int("workflows", len(orgCtx.Workflows)).
		Msg("Built org context for workflow generation")

	return orgCtx
}

// listResourceSummaries loads all resources of a kind from the store and
// extracts slug + description using the provided extractor function.
// Errors are logged but do not fail generation — missing context is
// preferable to a hard failure.
func (c *WorkflowController) listResourceSummaries(
	ctx context.Context,
	kind apiresourcekind.ApiResourceKind,
	extract func([]byte) (slug, description string),
) []llmclient.ResourceSummary {
	resources, err := c.store.ListResources(ctx, kind)
	if err != nil {
		log.Warn().Err(err).Str("kind", kind.String()).
			Msg("Failed to list resources for generation context — continuing without")
		return nil
	}

	var summaries []llmclient.ResourceSummary
	for _, data := range resources {
		slug, desc := extract(data)
		if slug == "" {
			continue
		}
		summaries = append(summaries, llmclient.ResourceSummary{
			Slug:        slug,
			Description: desc,
		})
	}
	return summaries
}

// validateGeneratedYAML performs lightweight structural validation on the
// LLM-generated YAML to catch common issues before returning to the caller.
//
// This is NOT the full Temporal-based validation — it's a quick check that:
//   - The YAML is syntactically valid
//   - Required top-level fields exist (apiVersion, kind, metadata, spec)
//   - Every task uses a known task kind from the registry
//
// This validation supports the retry loop: if issues are found, they're fed
// back to the LLM as error context for the next attempt.
func (c *WorkflowController) validateGeneratedYAML(
	yamlContent string,
	taskKinds []llmclient.TaskKindSummary,
) []string {
	var errors []string

	var doc map[string]any
	if err := yaml.Unmarshal([]byte(yamlContent), &doc); err != nil {
		return []string{fmt.Sprintf("YAML parse error: %v", err)}
	}

	// Check required top-level fields
	for _, field := range []string{"apiVersion", "kind", "metadata", "spec"} {
		if _, ok := doc[field]; !ok {
			errors = append(errors, fmt.Sprintf("missing required top-level field: %s", field))
		}
	}

	if apiVersion, ok := doc["apiVersion"].(string); ok {
		if apiVersion != "agentic.stigmer.ai/v1" {
			errors = append(errors, fmt.Sprintf(
				"apiVersion must be 'agentic.stigmer.ai/v1', got '%s'", apiVersion))
		}
	}

	if kind, ok := doc["kind"].(string); ok {
		if kind != "Workflow" {
			errors = append(errors, fmt.Sprintf(
				"kind must be 'Workflow', got '%s'", kind))
		}
	}

	// Validate metadata has required fields
	if metadata, ok := doc["metadata"].(map[string]any); ok {
		if _, ok := metadata["name"]; !ok {
			errors = append(errors, "metadata.name is required")
		}
		if _, ok := metadata["org"]; !ok {
			errors = append(errors, "metadata.org is required")
		}
	}

	// Validate spec structure
	spec, ok := doc["spec"].(map[string]any)
	if !ok {
		if len(errors) == 0 {
			errors = append(errors, "spec must be a YAML mapping")
		}
		return errors
	}

	// Validate document section
	if docSection, ok := spec["document"].(map[string]any); ok {
		for _, field := range []string{"dsl", "namespace", "name", "version"} {
			if _, ok := docSection[field]; !ok {
				errors = append(errors, fmt.Sprintf("spec.document.%s is required", field))
			}
		}
	} else {
		errors = append(errors, "spec.document is required")
	}

	// Validate tasks
	tasks, ok := spec["tasks"].([]any)
	if !ok || len(tasks) == 0 {
		errors = append(errors, "spec.tasks must contain at least one task")
		return errors
	}

	validKinds := buildValidKindSet(taskKinds)
	taskNames := make(map[string]bool)

	for i, task := range tasks {
		taskMap, ok := task.(map[string]any)
		if !ok {
			errors = append(errors, fmt.Sprintf("task[%d] must be a YAML mapping", i))
			continue
		}

		// Each task is a map with one key (the task name) whose value is the task definition
		for taskName, taskDef := range taskMap {
			if taskNames[taskName] {
				errors = append(errors, fmt.Sprintf("duplicate task name: '%s'", taskName))
			}
			taskNames[taskName] = true

			taskDefMap, ok := taskDef.(map[string]any)
			if !ok {
				errors = append(errors, fmt.Sprintf("task '%s' must be a YAML mapping", taskName))
				continue
			}

			kindFound := false
			for key := range taskDefMap {
				if key == "export" || key == "then" {
					continue
				}
				if !validKinds[key] {
					errors = append(errors, fmt.Sprintf(
						"task '%s' uses unknown task kind '%s'", taskName, key))
				}
				kindFound = true
			}
			if !kindFound {
				errors = append(errors, fmt.Sprintf(
					"task '%s' has no task kind specified", taskName))
			}
		}
	}

	return errors
}

func buildValidKindSet(taskKinds []llmclient.TaskKindSummary) map[string]bool {
	kinds := make(map[string]bool, len(taskKinds))
	for _, tk := range taskKinds {
		kinds[tk.Kind] = true
	}
	return kinds
}
