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
	envresolution "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/environment/resolution"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/executioncontext"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/downstream/workflowinstance"
)

// recreateExecutionContextStep re-resolves environment variables and creates
// a fresh ExecutionContext for the recovered execution.
//
// The previous run's orchestrator deleted the ExecutionContext on exit. Without
// this step, the recovered workflow would hydrate with an empty environment,
// causing tasks that depend on API keys, secrets, or config to fail.
//
// Re-resolves env from current WorkflowInstance environment_refs and Workflow
// env declarations, which is desirable: if the user fixed an API key, recovery
// gets the fix.
//
// Known limitation: runtime_env overrides from the original execution are not
// preserved (stripped before persist). Only environment-ref-based values are available.
type recreateExecutionContextStep struct {
	store                  store.Store
	workflowInstanceClient *workflowinstance.Client
	environmentResolution  *envresolution.RuntimeResolutionService
	executionCtxClient     *executioncontext.Client
}

func newRecreateExecutionContextStep(
	s store.Store,
	wiClient *workflowinstance.Client,
	envResolution *envresolution.RuntimeResolutionService,
	ecClient *executioncontext.Client,
) *recreateExecutionContextStep {
	return &recreateExecutionContextStep{
		store:                  s,
		workflowInstanceClient: wiClient,
		environmentResolution:  envResolution,
		executionCtxClient:     ecClient,
	}
}

func (s *recreateExecutionContextStep) Name() string {
	return "RecreateExecutionContext"
}

func (s *recreateExecutionContextStep) Execute(ctx *pipeline.RequestContext[*workflowexecutionv1.RecoverWorkflowExecutionInput]) error {
	if ctx.Get("alreadyInTargetState") == true {
		return nil
	}

	if s.workflowInstanceClient == nil || s.environmentResolution == nil || s.executionCtxClient == nil {
		log.Warn().Msg("ExecutionContext dependencies not available, skipping EC recreation during recovery")
		return nil
	}

	execution := ctx.Get(LoadedExecutionKey).(*workflowexecutionv1.WorkflowExecution)
	executionID := execution.GetMetadata().GetId()
	executionOrg := execution.GetMetadata().GetOrg()
	workflowInstanceID := execution.GetSpec().GetWorkflowInstanceId()

	log.Debug().
		Str("execution_id", executionID).
		Str("workflow_instance_id", workflowInstanceID).
		Msg("Recreating ExecutionContext for recovered execution")

	// Step 1: Delete stale EC if it still exists (TTL may not have expired)
	s.deleteStaleEC(ctx, executionID)

	// Step 2: Load WorkflowInstance for env_refs
	instance, err := s.workflowInstanceClient.Get(ctx.Context(), workflowInstanceID)
	if err != nil {
		log.Warn().
			Str("execution_id", executionID).
			Str("workflow_instance_id", workflowInstanceID).
			Err(err).
			Msg("WorkflowInstance not found during recovery EC recreation. " +
				"Proceeding without environment — workflow tasks may fail if they need env vars.")
		return nil
	}

	workflowID := instance.GetSpec().GetWorkflowId()

	// Step 3: Load Workflow for env declarations
	workflow := &workflowv1.Workflow{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_workflow, workflowID, workflow); err != nil {
		log.Warn().
			Str("execution_id", executionID).
			Str("workflow_id", workflowID).
			Err(err).
			Msg("Workflow not found during recovery EC recreation. Proceeding without environment.")
		return nil
	}

	// Step 4: Resolve environments from instance env_refs
	environments, err := s.resolveEnvironments(ctx, instance.GetSpec().GetEnvironmentRefs())
	if err != nil {
		log.Warn().
			Str("execution_id", executionID).
			Err(err).
			Msg("Failed to resolve environments during recovery. Proceeding without environment.")
		return nil
	}

	// Step 5: Merge (no runtime_env — it was stripped at create time)
	merged := envmerge.MergeEnvironmentLayers(environments, nil)

	// Step 6: Filter by workflow env declarations
	workflowEnvDecls := workflow.GetSpec().GetEnv()
	filtered, _ := envmerge.FilterByDeclaredKeys(merged, workflowEnvDecls)

	if len(filtered) == 0 {
		log.Info().
			Str("execution_id", executionID).
			Msg("No environment variables to recreate for recovered execution")
		return nil
	}

	// Step 7: Create fresh ExecutionContext
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
		return fmt.Errorf("recreate execution context for recovered execution %s: %w", executionID, err)
	}

	log.Info().
		Str("execution_context_id", created.GetMetadata().GetId()).
		Str("execution_id", executionID).
		Int("data_entries", len(filtered)).
		Int("merged_count", len(merged)).
		Msg("Recreated ExecutionContext for recovered execution")

	return nil
}

// deleteStaleEC removes any existing ExecutionContext for this execution (best-effort).
func (s *recreateExecutionContextStep) deleteStaleEC(
	ctx *pipeline.RequestContext[*workflowexecutionv1.RecoverWorkflowExecutionInput],
	executionID string,
) {
	existing := &executioncontextv1.ExecutionContext{}
	err := s.store.FindByField(ctx.Context(),
		apiresourcekind.ApiResourceKind_execution_context,
		"spec.executionId", executionID, existing)
	if err != nil {
		return
	}

	ecID := existing.GetMetadata().GetId()
	if ecID == "" {
		return
	}

	log.Info().
		Str("execution_context_id", ecID).
		Str("execution_id", executionID).
		Msg("Deleting stale ExecutionContext before recreation")

	if deleteErr := s.store.DeleteResource(ctx.Context(),
		apiresourcekind.ApiResourceKind_execution_context, ecID); deleteErr != nil {
		log.Warn().
			Str("execution_context_id", ecID).
			Err(deleteErr).
			Msg("Failed to delete stale ExecutionContext (proceeding anyway)")
	}
}

func (s *recreateExecutionContextStep) resolveEnvironments(
	ctx *pipeline.RequestContext[*workflowexecutionv1.RecoverWorkflowExecutionInput],
	refs []*apiresource.ApiResourceReference,
) ([]*environmentv1.Environment, error) {
	if len(refs) == 0 {
		return nil, nil
	}

	environments := make([]*environmentv1.Environment, 0, len(refs))
	for _, ref := range refs {
		// Runtime resolution, not the GetByReference RPC: the RPC surface
		// redacts secret values (oss#405); this internal path returns them
		// decrypted for the execution-context merge.
		env, err := s.environmentResolution.ResolveByReference(ctx.Context(), ref)
		if err != nil {
			return nil, fmt.Errorf("resolve environment ref (org=%s, slug=%s): %w",
				ref.GetOrg(), ref.GetSlug(), err)
		}
		environments = append(environments, env)
	}

	return environments, nil
}
