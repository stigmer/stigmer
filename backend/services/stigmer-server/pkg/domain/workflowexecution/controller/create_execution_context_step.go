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
//  1. Workflow.spec.env_spec.data (template defaults)
//  2. WorkflowInstance.env_refs resolved via environmentClient (in order)
//  3. WorkflowExecution.spec.runtime_env (execution-time overrides)
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

	// 3. Load Workflow from store to get env_spec (follows WE controller's "same service" pattern)
	workflow := &workflowv1.Workflow{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID, workflow); err != nil {
		return fmt.Errorf("load workflow %s: %w", workflowID, err)
	}

	// 4. Resolve environments from instance env_refs
	environments, err := s.resolveEnvironments(ctx, instance.GetSpec().GetEnvRefs())
	if err != nil {
		return err
	}

	// 5. Merge all layers
	merged := envmerge.MergeEnvironmentLayers(
		workflow.GetSpec().GetEnvSpec().GetData(),
		environments,
		execution.GetSpec().GetRuntimeEnv(),
	)

	log.Info().
		Str("execution_id", executionID).
		Int("merged_count", len(merged)).
		Int("env_refs_count", len(instance.GetSpec().GetEnvRefs())).
		Msg("Merged environment layers for execution context")

	// 6. Build and persist ExecutionContext
	ec := &executioncontextv1.ExecutionContext{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "ExecutionContext",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: fmt.Sprintf("exec-ctx-%s", executionID),
			Org:  executionOrg,
		},
		Spec: &executioncontextv1.ExecutionContextSpec{
			ExecutionId: executionID,
			Data:        merged,
		},
	}

	created, err := s.executionCtxClient.Create(ctx.Context(), ec)
	if err != nil {
		return fmt.Errorf("create execution context for %s: %w", executionID, err)
	}

	log.Info().
		Str("execution_context_id", created.GetMetadata().GetId()).
		Str("execution_id", executionID).
		Int("data_entries", len(merged)).
		Msg("Successfully created execution context")

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
