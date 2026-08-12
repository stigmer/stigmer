package harness

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	billingv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/billing/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
	"google.golang.org/grpc"
)

const (
	TestOrg        = "test-org"
	TestAPIVersion = "agentic.stigmer.ai/v1"
)

type resourceKind int

const (
	kindWorkflow resourceKind = iota
	kindWorkflowInstance
	kindWorkflowExecution
)

type cleanupEntry struct {
	kind resourceKind
	id   string
}

// FixtureDeployer creates and manages test resources via gRPC.
// It tracks created resources for cleanup and generates unique names per test.
type FixtureDeployer struct {
	clients  *Clients
	testName string
	org      string
	created  []cleanupEntry
	logger   *slog.Logger
}

// NewFixtureDeployer creates a deployer scoped to a specific test.
// All resources created through this deployer are tracked for cleanup.
func NewFixtureDeployer(clients *Clients, testName string, logger *slog.Logger) *FixtureDeployer {
	if logger == nil {
		logger = slog.Default()
	}
	return &FixtureDeployer{
		clients:  clients,
		testName: testName,
		org:      TestOrg,
		logger:   logger,
	}
}

func (f *FixtureDeployer) uniqueName(suffix string) string {
	short := uuid.New().String()[:8]
	return fmt.Sprintf("%s-%s-%s", f.testName, suffix, short)
}

// ApplyWorkflow creates or updates a workflow via the apply RPC.
// The returned workflow includes server-assigned fields (ID, status).
func (f *FixtureDeployer) ApplyWorkflow(ctx context.Context, wf *workflowv1.Workflow) (*workflowv1.Workflow, error) {
	ctx, span := Tracer().Start(ctx, "stigmer.apply",
		trace.WithAttributes(
			attribute.String("workflow.name", wf.GetMetadata().GetName()),
			attribute.String("workflow.org", wf.GetMetadata().GetOrg()),
		),
	)
	defer span.End()

	result, err := f.clients.WorkflowCommand.Apply(ctx, wf)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("apply workflow %q: %w", wf.GetMetadata().GetName(), err)
	}

	span.SetAttributes(attribute.String("workflow.id", result.GetMetadata().GetId()))

	f.created = append(f.created, cleanupEntry{
		kind: kindWorkflow,
		id:   result.GetMetadata().GetId(),
	})
	f.logger.Info("applied workflow",
		"name", result.GetMetadata().GetName(),
		"id", result.GetMetadata().GetId(),
	)
	return result, nil
}

// ApplyWorkflowInstance creates or updates a workflow instance.
func (f *FixtureDeployer) ApplyWorkflowInstance(ctx context.Context, inst *workflowinstancev1.WorkflowInstance) (*workflowinstancev1.WorkflowInstance, error) {
	result, err := f.clients.InstanceCommand.Apply(ctx, inst)
	if err != nil {
		return nil, fmt.Errorf("apply workflow instance %q: %w", inst.GetMetadata().GetName(), err)
	}

	f.created = append(f.created, cleanupEntry{
		kind: kindWorkflowInstance,
		id:   result.GetMetadata().GetId(),
	})
	f.logger.Info("applied workflow instance",
		"name", result.GetMetadata().GetName(),
		"id", result.GetMetadata().GetId(),
	)
	return result, nil
}

// CreateExecution creates and triggers a new workflow execution.
func (f *FixtureDeployer) CreateExecution(ctx context.Context, exec *workflowexecutionv1.WorkflowExecution) (*workflowexecutionv1.WorkflowExecution, error) {
	ctx, span := Tracer().Start(ctx, "stigmer.run",
		trace.WithAttributes(
			attribute.String("execution.name", exec.GetMetadata().GetName()),
			attribute.String("workflow.id", exec.GetSpec().GetWorkflowId()),
		),
	)
	defer span.End()

	result, err := f.clients.ExecutionCommand.Create(ctx, exec)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		return nil, fmt.Errorf("create workflow execution: %w", err)
	}

	span.SetAttributes(
		attribute.String("execution.id", result.GetMetadata().GetId()),
		attribute.String("execution.phase", result.GetStatus().GetPhase().String()),
	)

	f.created = append(f.created, cleanupEntry{
		kind: kindWorkflowExecution,
		id:   result.GetMetadata().GetId(),
	})
	f.logger.Info("created workflow execution",
		"name", result.GetMetadata().GetName(),
		"id", result.GetMetadata().GetId(),
		"phase", result.GetStatus().GetPhase().String(),
	)
	return result, nil
}

// DeployAndExecute is a convenience method that applies a workflow, then creates
// an execution using the workflow_id shortcut (auto-resolves to default instance).
// Returns the workflow and the execution.
func (f *FixtureDeployer) DeployAndExecute(ctx context.Context, wf *workflowv1.Workflow, triggerMessage string) (*workflowv1.Workflow, *workflowexecutionv1.WorkflowExecution, error) {
	applied, err := f.ApplyWorkflow(ctx, wf)
	if err != nil {
		return nil, nil, err
	}

	execName := f.uniqueName("exec")
	exec := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: TestAPIVersion,
		Kind:       "WorkflowExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: execName,
			Org:  f.org,
		},
		Spec: &workflowexecutionv1.WorkflowExecutionSpec{
			WorkflowId:     applied.GetMetadata().GetId(),
			TriggerMessage: triggerMessage,
		},
	}

	execution, err := f.CreateExecution(ctx, exec)
	if err != nil {
		return applied, nil, err
	}

	return applied, execution, nil
}

// DeployAndExecuteWithEnv is like DeployAndExecute but also sets runtime
// environment variables on the execution spec.
func (f *FixtureDeployer) DeployAndExecuteWithEnv(ctx context.Context, wf *workflowv1.Workflow, triggerMessage string, env map[string]*executionctxv1.ExecutionValue) (*workflowv1.Workflow, *workflowexecutionv1.WorkflowExecution, error) {
	applied, err := f.ApplyWorkflow(ctx, wf)
	if err != nil {
		return nil, nil, err
	}

	execName := f.uniqueName("exec")
	exec := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: TestAPIVersion,
		Kind:       "WorkflowExecution",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: execName,
			Org:  f.org,
		},
		Spec: &workflowexecutionv1.WorkflowExecutionSpec{
			WorkflowId:     applied.GetMetadata().GetId(),
			TriggerMessage: triggerMessage,
			RuntimeEnv:     env,
		},
	}

	execution, err := f.CreateExecution(ctx, exec)
	if err != nil {
		return applied, nil, err
	}

	return applied, execution, nil
}

// Cleanup deletes all tracked resources in reverse order.
// Errors are logged but do not stop cleanup of remaining resources.
func (f *FixtureDeployer) Cleanup(ctx context.Context) {
	for i := len(f.created) - 1; i >= 0; i-- {
		entry := f.created[i]
		var err error

		switch entry.kind {
		case kindWorkflow:
			_, err = f.clients.WorkflowCommand.Delete(ctx, &workflowv1.WorkflowId{Value: entry.id})
		case kindWorkflowInstance:
			_, err = f.clients.InstanceCommand.Delete(ctx, &workflowinstancev1.WorkflowInstanceId{Value: entry.id})
		case kindWorkflowExecution:
			_, err = f.clients.ExecutionCommand.Delete(ctx, &apiresource.ApiResourceId{Value: entry.id})
		}

		if err != nil {
			f.logger.Warn("cleanup failed",
				"kind", entry.kind,
				"id", entry.id,
				"error", err,
			)
		} else {
			f.logger.Debug("cleaned up resource", "kind", entry.kind, "id", entry.id)
		}
	}
	f.created = nil
}

const (
	// seedDefaultAgentAttempts bounds the apply retries in SeedDefaultAgent.
	// The seed runs right after service boot, where one-off transients
	// (connection churn, FGA warm-up) are most likely.
	seedDefaultAgentAttempts = 3
	seedDefaultAgentBackoff  = time.Second
)

// SeedDefaultAgent creates the system default "assistant" agent in test-org
// via the Agent Apply RPC. This agent is required by tests that create sessions
// without specifying an explicit agent.
//
// The seed is load-bearing for every session-dependent test in a suite, and a
// half-seeded agent is worse than no agent: AgentCreateHandler has no rollback,
// so a mid-pipeline failure leaves the agent row and its default-agent label
// persisted without FGA tuples or a default instance. findDefault keeps
// serving that agent, and every session create is then denied trying to
// lazily recreate the instance (oss#541; service-side contract tracked in
// stigmer-cloud#385). Two consequences here:
//
//   - Transient failures are retried a bounded number of times, because a
//     failed first apply can poison the rest of the run.
//   - Success is verified against the response, not the RPC status: a re-apply
//     after a partial failure routes to update and "succeeds" while the agent
//     is still missing its default instance, so the status alone can lie.
//
// Callers must treat a returned error as fatal for the suite.
func SeedDefaultAgent(ctx context.Context, conn grpc.ClientConnInterface) error {
	return seedDefaultAgent(ctx, NewClients(conn).AgentCommand, seedDefaultAgentBackoff)
}

// seedDefaultAgent is the client-injectable core of SeedDefaultAgent; the
// backoff grows linearly per attempt (tests pass ~0 to avoid real sleeps).
func seedDefaultAgent(ctx context.Context, agents agentv1.AgentCommandControllerClient, backoff time.Duration) error {
	agent := &agentv1.Agent{
		ApiVersion: TestAPIVersion,
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       "assistant",
			Org:        TestOrg,
			Visibility: apiresource.ApiResourceVisibility_visibility_public,
			Labels: map[string]string{
				"stigmer.ai/system":        "true",
				"stigmer.ai/default-agent": "true",
			},
		},
		Spec: &agentv1.AgentSpec{
			Description:  "General-purpose AI assistant.",
			Instructions: "You are a general-purpose AI assistant.",
		},
	}

	var lastErr error
	for attempt := 1; attempt <= seedDefaultAgentAttempts; attempt++ {
		if attempt > 1 {
			select {
			case <-ctx.Done():
				return fmt.Errorf("seed default agent: %w (last attempt error: %v)", ctx.Err(), lastErr)
			case <-time.After(time.Duration(attempt-1) * backoff):
			}
		}

		applied, err := agents.Apply(ctx, agent)
		if err != nil {
			lastErr = fmt.Errorf("apply default agent (attempt %d/%d): %w", attempt, seedDefaultAgentAttempts, err)
			continue
		}
		if applied.GetStatus().GetDefaultInstanceId() == "" {
			// Retrying cannot heal this state (re-apply routes to update, which
			// converges nothing) — report it precisely instead of looping.
			return fmt.Errorf(
				"default agent %s applied but has no default instance bound — "+
					"half-created state from an earlier failed create; every session "+
					"create against it will be denied (oss#541, stigmer-cloud#385)",
				applied.GetMetadata().GetId())
		}
		return nil
	}
	return lastErr
}

// ProvisionTestBillingAccount creates a billing account for the given org
// and seeds generous credits ($100) so agent/workflow executions do not hit
// the balance gate. The idempotencyKey must be unique per suite (and per
// org) to avoid conflicts across concurrent test runs.
func ProvisionTestBillingAccount(ctx context.Context, conn grpc.ClientConnInterface, org, idempotencyKey string) error {
	billing := billingv1.NewBillingCommandControllerClient(conn)

	_, err := billing.GetOrCreateBillingAccount(ctx, &billingv1.GetOrCreateBillingAccountInput{
		OrgId: org,
	})
	if err != nil {
		return fmt.Errorf("getOrCreateBillingAccount: %w", err)
	}

	_, err = billing.AdjustCredits(ctx, &billingv1.AdjustCreditsInput{
		OrgId:          org,
		AmountMicros:   100_000_000, // $100 in micro-USD
		Reason:         "integration test seed",
		IdempotencyKey: idempotencyKey,
	})
	if err != nil {
		return fmt.Errorf("adjustCredits: %w", err)
	}

	return nil
}
