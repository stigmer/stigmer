package workflowexecution

import (
	"fmt"

	"github.com/rs/zerolog/log"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	executioncontextv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/envmerge"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/environment"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/executioncontext"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
)

// createExecutionContextStep builds and persists an ExecutionContext with a fully-merged
// environment for the workflow execution.
//
// Resolution chain:
//   - Resolve workflow_instance_id from pipeline context (ResolvedWorkflowInstanceIDKey) or execution spec
//   - workflowInstanceClient.Get -> WorkflowInstance.env_refs + workflow_id
//   - store.GetResource(workflow_id) -> Workflow.env_spec (follows WE controller's "same service" store-access pattern)
//
// Merge priority (lowest to highest):
//  1. WorkflowInstance.env_refs resolved via environmentClient (in order)
//  2. WorkflowExecution.spec.runtime_env (execution-time overrides)
type createExecutionContextStep struct {
	store                  store.Store
	workflowInstanceClient *workflowinstance.Client
	environmentClient      *environment.Client
	executionCtxClient     *executioncontext.Client
}

func (c *WorkflowExecutionController) newCreateExecutionContextStep() *createExecutionContextStep {
	return &createExecutionContextStep{
		store:                  c.store,
		workflowInstanceClient: c.workflowInstanceClient,
		environmentClient:      c.environmentClient,
		executionCtxClient:     c.executionContextClient,
	}
}

func (s *createExecutionContextStep) Name() string {
	return "CreateExecutionContext"
}

func (s *createExecutionContextStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecution]) error {
	execution := ctx.NewState()
	executionID := execution.GetMetadata().GetId()
	executionOrg := execution.GetMetadata().GetOrg()

	if s.workflowInstanceClient == nil || s.environmentClient == nil || s.executionCtxClient == nil {
		log.Warn().
			Str("execution_id", executionID).
			Msg("ExecutionContext clients not available, skipping execution context creation")
		return nil
	}

	log.Debug().
		Str("execution_id", executionID).
		Msg("Creating execution context with merged environment")

	// 1. Resolve workflow_instance_id
	workflowInstanceID := s.resolveWorkflowInstanceID(ctx)
	if workflowInstanceID == "" {
		return fmt.Errorf("workflow_instance_id not resolved from context or execution spec")
	}

	log.Debug().
		Str("execution_id", executionID).
		Str("workflow_instance_id", workflowInstanceID).
		Msg("Resolved workflow instance ID")

	// 2. Load WorkflowInstance to get env_refs and workflow_id
	instance, err := s.workflowInstanceClient.Get(ctx.Context(), workflowInstanceID)
	if err != nil {
		return fmt.Errorf("load workflow instance %s: %w", workflowInstanceID, err)
	}

	workflowID := instance.GetSpec().GetWorkflowId()

	// 3. Load Workflow from store to get env declarations (follows WE controller's "same service" pattern)
	workflow := &workflowv1.Workflow{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID, workflow); err != nil {
		return fmt.Errorf("load workflow %s: %w", workflowID, err)
	}

	// 4. Resolve environments from instance env_refs
	environments, err := s.resolveEnvironments(ctx, instance.GetSpec().GetEnvironmentRefs())
	if err != nil {
		return err
	}

	// 5. Merge all layers
	merged := envmerge.MergeEnvironmentLayers(
		environments,
		execution.GetSpec().GetRuntimeEnv(),
	)

	// 6. Filter merged env vars by workflow env declarations (least-privilege whitelist).
	// Workflows only receive variables they explicitly declared. If env is
	// nil or empty, all vars pass through for backward compatibility.
	workflowEnvDecls := workflow.GetSpec().GetEnv()
	filtered, excludedKeys := envmerge.FilterByDeclaredKeys(merged, workflowEnvDecls)
	if len(excludedKeys) > 0 {
		log.Warn().
			Str("execution_id", executionID).
			Str("workflow_id", workflowID).
			Strs("excluded_keys", excludedKeys).
			Msg("Filtered env vars not declared in workflow env")
	}

	// 6.1 Validate that all required (non-optional) declared env vars are
	// present after merging and filtering. Workflows access MCP servers
	// through agent tasks whose executions are validated separately, so
	// this primarily catches missing workflow-level required vars.
	if missingRequired := envmerge.ValidateRequiredKeys(filtered, workflowEnvDecls); len(missingRequired) > 0 {
		log.Warn().
			Str("execution_id", executionID).
			Str("workflow_id", workflowID).
			Strs("missing_required", missingRequired).
			Msg("Required env vars missing after environment merge — execution may fail")
	}

	log.Info().
		Str("execution_id", executionID).
		Int("merged_count", len(merged)).
		Int("filtered_count", len(filtered)).
		Int("env_refs_count", len(instance.GetSpec().GetEnvironmentRefs())).
		Msg("Merged environment layers for execution context")

	// 7. Build and persist ExecutionContext
	ec := &executioncontextv1.ExecutionContext{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ExecutionContext",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("exec-ctx-%s", executionID),
			Org:  executionOrg,
		},
		Spec: &executioncontextv1.ExecutionContextSpec{
			ExecutionId: executionID,
			Data:        filtered,
		},
	}

	created, err := s.executionCtxClient.Create(ctx.Context(), ec)
	if err != nil {
		return fmt.Errorf("create execution context for %s: %w", executionID, err)
	}

	log.Info().
		Str("execution_context_id", created.GetMetadata().GetId()).
		Str("execution_id", executionID).
		Int("data_entries", len(filtered)).
		Msg("Successfully created execution context")

	// 8. Clear runtime_env from the execution now that it has been consumed.
	// runtime_env is a transient creation-time input; its contents are now
	// materialized in the ExecutionContext. Clearing it ensures secrets never
	// appear in the persisted execution or in Temporal workflow history.
	if execution.GetSpec() != nil && len(execution.GetSpec().GetRuntimeEnv()) > 0 {
		log.Debug().
			Str("execution_id", executionID).
			Int("cleared_entries", len(execution.GetSpec().GetRuntimeEnv())).
			Msg("Clearing runtime_env from execution (consumed into ExecutionContext)")

		execution.Spec.RuntimeEnv = nil
		ctx.SetNewState(execution)
	}

	return nil
}

// resolveWorkflowInstanceID determines the workflow_instance_id from pipeline context
// (set by createDefaultInstanceIfNeededStep) or from the execution spec.
func (s *createExecutionContextStep) resolveWorkflowInstanceID(ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecution]) string {
	// The createDefaultInstanceIfNeededStep always sets workflow_instance_id on execution.spec
	// regardless of whether it was user-provided or auto-resolved from default instance.
	execution := ctx.NewState()
	return execution.GetSpec().GetWorkflowInstanceId()
}

// resolveEnvironments fetches each referenced Environment resource in order.
func (s *createExecutionContextStep) resolveEnvironments(
	ctx *pipeline.RequestContext[*workflowexecutionv1.WorkflowExecution],
	refs []*apiresource.ApiResourceReference,
) ([]*environmentv1.Environment, error) {
	if len(refs) == 0 {
		return nil, nil
	}

	environments := make([]*environmentv1.Environment, 0, len(refs))
	for _, ref := range refs {
		env, err := s.environmentClient.GetByReference(ctx.Context(), ref)
		if err != nil {
			return nil, fmt.Errorf("resolve environment ref (org=%s, slug=%s): %w",
				ref.GetOrg(), ref.GetSlug(), err)
		}
		environments = append(environments, env)
	}

	log.Debug().
		Int("count", len(environments)).
		Msg("Resolved environment references")

	return environments, nil
}
