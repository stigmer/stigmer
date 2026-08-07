//go:build integration

package integration

import (
	"testing"
	"time"

	"github.com/google/uuid"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// Service-tier create-time validation (stigmer/stigmer#357): FAST is
// fail-closed against the model registry — it requires a pinned model whose
// registry entry prices a fast variant. The refusal happens before any side
// effect (no session, no execution, no workflow), so these cases run
// offline: no provider keys, no runner round trip.
//
// The OSS Go server pins the same rules with the same messages in
// validate_service_tier_test.go (unit) — this suite proves the cloud Java
// pipeline (ValidateServiceTierStep) enforces them through the real gRPC
// boundary.
func TestAgentExecution_ServiceTier_FailClosed(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := harness.TestContext(t, 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	agent := harness.CreateAgent(t, ctx, clients, "test-service-tier",
		"You are a helpful assistant. Respond briefly.")

	createWithConfig := func(cfg *agentexecv1.ExecutionConfig) (*agentexecv1.AgentExecution, error) {
		return clients.AgentExecutionCommand.Create(ctx, &agentexecv1.AgentExecution{
			ApiVersion: harness.TestAPIVersion,
			Kind:       "AgentExecution",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: "test-tier-" + uuid.New().String()[:8],
				Org:  harness.TestOrg,
			},
			Spec: &agentexecv1.AgentExecutionSpec{
				AgentId:         agent.GetMetadata().GetId(),
				Message:         "Reply with exactly: hello",
				ExecutionConfig: cfg,
			},
		})
	}

	t.Run("fast without model_name is refused", func(t *testing.T) {
		_, err := createWithConfig(&agentexecv1.ExecutionConfig{
			ServiceTier: agentexecv1.ServiceTier_SERVICE_TIER_FAST,
		})
		require.Error(t, err, "fast with no pinned model must be refused at create")
		st, ok := status.FromError(err)
		require.True(t, ok, "expected a gRPC status error, got: %v", err)
		require.Equal(t, codes.InvalidArgument, st.Code())
		require.Contains(t, st.Message(), "requires execution_config.model_name",
			"the refusal must name the missing model, not just reject")
	})

	t.Run("fast on a model with no fast variant is refused", func(t *testing.T) {
		_, err := createWithConfig(&agentexecv1.ExecutionConfig{
			ModelName:   "claude-haiku-4-5",
			ServiceTier: agentexecv1.ServiceTier_SERVICE_TIER_FAST,
		})
		require.Error(t, err, "fast on an unpriced model must be refused at create")
		st, ok := status.FromError(err)
		require.True(t, ok, "expected a gRPC status error, got: %v", err)
		require.Equal(t, codes.InvalidArgument, st.Code())
		require.Contains(t, st.Message(), "prices no fast variant",
			"the refusal must explain the registry gap")
		require.Contains(t, st.Message(), "models with a fast tier",
			"the refusal must list actionable alternatives")
	})

	t.Run("fast on a fast-priced model is accepted", func(t *testing.T) {
		exec, err := createWithConfig(&agentexecv1.ExecutionConfig{
			ModelName:   "composer-2.5",
			ServiceTier: agentexecv1.ServiceTier_SERVICE_TIER_FAST,
		})
		require.NoError(t, err, "fast on a registry-priced model must pass validation")
		require.Equal(t, agentexecv1.ServiceTier_SERVICE_TIER_FAST,
			exec.GetSpec().GetExecutionConfig().GetServiceTier(),
			"the persisted execution must carry the requested tier")

		// No provider round trip in this suite — cancel so nothing dangles.
		_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
			Id: exec.GetMetadata().GetId(),
		})
		require.NoError(t, err, "cleanup cancel should succeed")
	})

	t.Run("explicit standard needs no model", func(t *testing.T) {
		exec, err := createWithConfig(&agentexecv1.ExecutionConfig{
			ServiceTier: agentexecv1.ServiceTier_SERVICE_TIER_STANDARD,
		})
		require.NoError(t, err, "standard is always valid — every model has a base price")

		_, err = clients.AgentExecutionCommand.Cancel(ctx, &agentexecv1.CancelAgentExecutionInput{
			Id: exec.GetMetadata().GetId(),
		})
		require.NoError(t, err, "cleanup cancel should succeed")
	})
}

// The workflow surface applies the same rules plus the harness dimension:
// an agent_call pinning fast on a model whose fast variant is priced under
// a different harness must be refused at workflow apply time — the
// execution path could never apply the tier (silent no-op, the class #357
// exists to kill).
func TestWorkflow_AgentCall_ServiceTierFailClosed(t *testing.T) {
	require.NotNil(t, grpcConn)

	ctx, cancel := harness.TestContext(t, 2*time.Minute)
	defer cancel()

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "tier-validation", suiteLogger)
	defer deployer.Cleanup(ctx)

	buildWorkflow := func(name string, runConfig map[string]any) *workflowv1.Workflow {
		taskConfig, err := structpb.NewStruct(map[string]any{
			"agent":      "support-triage",
			"message":    "classify",
			"harness":    "cursor",
			"run_config": runConfig,
		})
		require.NoError(t, err)
		return &workflowv1.Workflow{
			ApiVersion: harness.TestAPIVersion,
			Kind:       "Workflow",
			Metadata: &apiresource.ApiResourceMetadata{
				Name: name + "-" + uuid.New().String()[:8],
				Org:  harness.TestOrg,
			},
			Spec: &workflowv1.WorkflowSpec{
				Document: &workflowv1.WorkflowDocument{
					Dsl:       "1.0.0",
					Namespace: harness.TestOrg,
					Name:      name,
					Version:   "1.0.0",
				},
				Tasks: []*workflowv1.WorkflowTask{
					{
						Name:       "triage",
						Kind:       workflowv1.WorkflowTaskKind_agent_call,
						TaskConfig: taskConfig,
					},
				},
			},
		}
	}

	t.Run("fast on an unpriced model is refused at apply", func(t *testing.T) {
		_, err := deployer.ApplyWorkflow(ctx, buildWorkflow("tier-unpriced", map[string]any{
			"model_name":   "claude-haiku-4-5",
			"service_tier": "fast",
		}))
		require.Error(t, err, "fast on an unpriced model must fail workflow validation")
		require.Contains(t, err.Error(), "prices no fast variant")
		require.Contains(t, err.Error(), "on harness 'cursor'",
			"the refusal must be harness-scoped")
	})

	t.Run("fast on a fast-priced model applies cleanly", func(t *testing.T) {
		_, err := deployer.ApplyWorkflow(ctx, buildWorkflow("tier-priced", map[string]any{
			"model_name":   "composer-2.5",
			"service_tier": "fast",
		}))
		require.NoError(t, err, "fast on a registry-priced cursor model must validate")
	})
}
