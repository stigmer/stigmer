package workflow

import (
	"context"
	"encoding/json"

	"github.com/rs/zerolog/log"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/llmclient"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"gopkg.in/yaml.v3"
)

const maxDiagnosisRetries = 2

// DiagnoseWorkflowExecution analyzes a failed workflow execution and returns
// a root-cause diagnosis with an optional YAML fix for definition errors.
//
// Flow:
//  1. Gate on llmClient + taskKindRegistry
//  2. Resolve LLM model
//  3. Load the failed WorkflowExecution from the store
//  4. Load the parent Workflow from the store (via execution's workflow reference)
//  5. Serialize the workflow to YAML for the diagnostic prompt
//  6. Extract failure context from execution status (phase, error, per-task statuses)
//  7. Build diagnostic prompt
//  8. Call LLM
//  9. Parse response into diagnosis + optional YAML + optional fix explanation
//  10. If suggested YAML is present, validate it (reuse validateGeneratedYAML)
//  11. On validation failure, retry with error context (max 2 retries)
//  12. Return DiagnoseWorkflowExecutionOutput
func (c *WorkflowController) DiagnoseWorkflowExecution(
	ctx context.Context,
	input *workflowv1.DiagnoseWorkflowExecutionInput,
) (*workflowv1.DiagnoseWorkflowExecutionOutput, error) {
	if c.llmClient == nil {
		return nil, status.Error(codes.FailedPrecondition,
			"workflow diagnosis is not available — no LLM client configured")
	}
	if len(c.taskKindRegistry) == 0 {
		return nil, status.Error(codes.FailedPrecondition,
			"workflow diagnosis is not available — task kind registry not loaded")
	}

	provider, model, err := c.resolveModel(input.GetModel())
	if err != nil {
		return nil, err
	}

	execution, err := c.loadExecution(ctx, input.GetExecutionId())
	if err != nil {
		return nil, err
	}

	workflowYAML, err := c.loadWorkflowYAML(ctx, execution)
	if err != nil {
		return nil, err
	}

	failureCtx := buildExecutionFailureContext(execution)

	log.Info().
		Str("execution_id", input.GetExecutionId()).
		Str("org", input.GetOrg()).
		Str("model", model).
		Str("phase", failureCtx.Phase).
		Msg("Starting workflow execution diagnosis")

	taskKinds, err := llmclient.ParseTaskKindSummaries(c.taskKindRegistry)
	if err != nil {
		log.Error().Err(err).Msg("Failed to parse task kind registry")
		return nil, status.Error(codes.Internal, "failed to load task kind registry")
	}

	systemPrompt, userPrompt := llmclient.BuildDiagnosticPrompt(workflowYAML, failureCtx, taskKinds)

	var result llmclient.DiagnosticResult

	for attempt := 0; attempt <= maxDiagnosisRetries; attempt++ {
		currentUserPrompt := userPrompt
		if attempt > 0 {
			log.Info().
				Int("attempt", attempt+1).
				Msg("Retrying diagnosis with validation feedback")
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
			log.Error().Err(llmErr).Int("attempt", attempt+1).Msg("LLM call failed during diagnosis")
			return nil, llmErr
		}

		result = llmclient.SplitDiagnosticResponse(resp.Content)

		if result.SuggestedYAML == "" {
			log.Info().
				Int("attempt", attempt+1).
				Str("model", resp.Model).
				Msg("Diagnosis completed — runtime error (no YAML fix)")
			return &workflowv1.DiagnoseWorkflowExecutionOutput{
				Diagnosis: result.Diagnosis,
				ModelUsed: resp.Model,
			}, nil
		}

		validationErrors := c.validateGeneratedYAML(result.SuggestedYAML, taskKinds)
		if len(validationErrors) == 0 {
			log.Info().
				Int("attempt", attempt+1).
				Int("yaml_len", len(result.SuggestedYAML)).
				Str("model", resp.Model).
				Msg("Diagnosis completed — definition error with valid YAML fix")
			return &workflowv1.DiagnoseWorkflowExecutionOutput{
				Diagnosis:      result.Diagnosis,
				SuggestedYaml:  result.SuggestedYAML,
				FixExplanation: result.FixExplanation,
				ModelUsed:      resp.Model,
			}, nil
		}

		if attempt == maxDiagnosisRetries {
			log.Warn().
				Int("errors", len(validationErrors)).
				Msg("Diagnosis completed with validation warnings on suggested YAML")
			return &workflowv1.DiagnoseWorkflowExecutionOutput{
				Diagnosis:      result.Diagnosis,
				SuggestedYaml:  result.SuggestedYAML,
				FixExplanation: result.FixExplanation,
				Warnings:       validationErrors,
				ModelUsed:      resp.Model,
			}, nil
		}

		userPrompt = currentUserPrompt + llmclient.FormatValidationErrorsForRetry(validationErrors)
	}

	return &workflowv1.DiagnoseWorkflowExecutionOutput{
		Diagnosis:      result.Diagnosis,
		SuggestedYaml:  result.SuggestedYAML,
		FixExplanation: result.FixExplanation,
		ModelUsed:      model,
	}, nil
}

// loadExecution retrieves a WorkflowExecution from the store by ID.
func (c *WorkflowController) loadExecution(
	ctx context.Context,
	executionID string,
) (*workflowexecutionv1.WorkflowExecution, error) {
	execution := &workflowexecutionv1.WorkflowExecution{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_workflow_execution, executionID, execution); err != nil {
		log.Error().Err(err).Str("execution_id", executionID).Msg("Workflow execution not found")
		return nil, status.Errorf(codes.NotFound, "workflow execution %q not found", executionID)
	}
	return execution, nil
}

// loadWorkflowYAML resolves the parent workflow from an execution and
// serializes it to YAML for inclusion in the diagnostic prompt.
func (c *WorkflowController) loadWorkflowYAML(
	ctx context.Context,
	execution *workflowexecutionv1.WorkflowExecution,
) (string, error) {
	workflowID := execution.GetSpec().GetWorkflowId()
	if workflowID == "" {
		workflowID = resolveWorkflowIDFromInstance(ctx, c, execution.GetSpec().GetWorkflowInstanceId())
	}
	if workflowID == "" {
		return "", status.Error(codes.FailedPrecondition,
			"cannot determine parent workflow — execution has no workflow_id or workflow_instance_id")
	}

	wf := &workflowv1.Workflow{}
	if err := c.store.GetResource(ctx, apiresourcekind.ApiResourceKind_workflow, workflowID, wf); err != nil {
		log.Error().Err(err).Str("workflow_id", workflowID).Msg("Parent workflow not found")
		return "", status.Errorf(codes.NotFound, "parent workflow %q not found", workflowID)
	}

	yamlStr, err := workflowProtoToYAML(wf)
	if err != nil {
		log.Error().Err(err).Msg("Failed to serialize workflow to YAML")
		return "", status.Error(codes.Internal, "failed to serialize workflow for diagnosis")
	}

	return yamlStr, nil
}

// resolveWorkflowIDFromInstance attempts to load a WorkflowInstance and extract
// the parent workflow ID. Returns empty string if resolution fails.
func resolveWorkflowIDFromInstance(ctx context.Context, c *WorkflowController, instanceID string) string {
	if instanceID == "" {
		return ""
	}

	// WorkflowInstance references the workflow through its spec.
	// Load the instance proto and extract the workflow reference.
	type instanceSpec struct {
		WorkflowID string `json:"workflowId"`
	}
	type instanceProto struct {
		Spec *instanceSpec `json:"spec"`
	}

	data, err := c.store.ListResources(ctx, apiresourcekind.ApiResourceKind_workflow_instance)
	if err != nil {
		return ""
	}

	for _, d := range data {
		var inst instanceProto
		if err := json.Unmarshal(d, &inst); err != nil {
			continue
		}
		if inst.Spec != nil && inst.Spec.WorkflowID != "" {
			return inst.Spec.WorkflowID
		}
	}

	return ""
}

// workflowProtoToYAML converts a Workflow protobuf to YAML using protojson
// as an intermediate format.
func workflowProtoToYAML(wf *workflowv1.Workflow) (string, error) {
	marshaler := protojson.MarshalOptions{
		UseProtoNames:   true,
		EmitUnpopulated: false,
	}

	jsonBytes, err := marshaler.Marshal(wf)
	if err != nil {
		return "", err
	}

	var intermediate map[string]any
	if err := json.Unmarshal(jsonBytes, &intermediate); err != nil {
		return "", err
	}

	yamlBytes, err := yaml.Marshal(intermediate)
	if err != nil {
		return "", err
	}

	return string(yamlBytes), nil
}

// buildExecutionFailureContext extracts failure data from a WorkflowExecution
// for inclusion in the diagnostic prompt.
func buildExecutionFailureContext(execution *workflowexecutionv1.WorkflowExecution) llmclient.ExecutionFailureContext {
	ctx := llmclient.ExecutionFailureContext{
		ExecutionID: execution.GetMetadata().GetId(),
		Phase:       execution.GetStatus().GetPhase().String(),
		Error:       execution.GetStatus().GetError(),
	}

	for _, task := range execution.GetStatus().GetTasks() {
		tc := llmclient.TaskFailureContext{
			Name:  task.GetTaskName(),
			Kind:  task.GetTaskType().String(),
			Phase: task.GetStatus().String(),
			Error: task.GetError(),
		}

		if task.GetStartedAt() != "" && task.GetCompletedAt() != "" {
			tc.Duration = task.GetStartedAt() + " → " + task.GetCompletedAt()
		}

		ctx.Tasks = append(ctx.Tasks, tc)
	}

	return ctx
}
