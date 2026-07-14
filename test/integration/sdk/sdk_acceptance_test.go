//go:build integration

package sdk_test

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	stigmer "github.com/stigmer/stigmer/sdk/go/v3"
	workflowv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/sdk/go/v3/proto/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func grpcAddress(t *testing.T) string {
	t.Helper()
	addr := os.Getenv("STIGMER_GRPC_ADDRESS")
	if addr == "" {
		t.Skip("STIGMER_GRPC_ADDRESS not set — run via: make test-sdk")
	}
	return addr
}

func workflowRunnerAvailable() bool {
	return os.Getenv("STIGMER_WORKFLOW_RUNNER_AVAILABLE") == "true"
}

func fgaEnabled() bool {
	return os.Getenv("STIGMER_FGA_ENABLED") == "true"
}

func TestSDKAcceptance_Go(t *testing.T) {
	addr := grpcAddress(t)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	client, err := stigmer.NewClient(
		stigmer.WithBaseURL(addr),
		stigmer.WithInsecure(),
	)
	require.NoError(t, err, "SDK client creation must succeed")
	defer client.Close()

	require.NoError(t, client.Connect(ctx), "SDK client must connect to the server")

	testName := strings.ReplaceAll(t.Name(), "/", "-")

	t.Run("Tier1_AgentCRUD", func(t *testing.T) {
		agentName := fmt.Sprintf("sdk-smoke-go-%s", testName)

		created, err := client.Agent.Apply(ctx, &stigmer.AgentInput{
			Name:         agentName,
			Org:          "test-org",
			Description:  "SDK acceptance smoke test agent (Go)",
			Instructions: "You are a test agent. Respond with exactly: hello from sdk smoke test",
		})
		require.NoError(t, err, "Agent.Apply must succeed")
		require.NotEmpty(t, created.GetMetadata().GetId(), "created agent must have an ID")
		agentID := created.GetMetadata().GetId()
		t.Logf("created agent: id=%s, name=%s", agentID, created.GetMetadata().GetName())

		fetched, err := client.Agent.Get(ctx, agentID)
		require.NoError(t, err, "Agent.Get must succeed")
		assert.Equal(t, agentName, fetched.GetMetadata().GetName(), "agent name must match")
		assert.Equal(t, "test-org", fetched.GetMetadata().GetOrg(), "agent org must match")
		assert.Equal(t, "SDK acceptance smoke test agent (Go)", fetched.GetSpec().GetDescription(), "agent description must match")

		listResult, err := client.Agent.List(ctx, &stigmer.ListParams{Org: "test-org"})
		if fgaEnabled() && err != nil {
			t.Logf("Agent.List failed with FGA enabled (known limitation — conditional tuple on shared store): %v", err)
		} else {
			require.NoError(t, err, "Agent.List must succeed")
			require.Greater(t, listResult.TotalCount, int32(0), "agent list must contain at least one entry")
		}

		_, err = client.Agent.Delete(ctx, agentID)
		require.NoError(t, err, "Agent.Delete must succeed")

		_, err = client.Agent.Get(ctx, agentID)
		require.Error(t, err, "Agent.Get on deleted agent must return an error")
		if fgaEnabled() {
			assert.True(t, stigmer.IsNotFound(err) || stigmer.IsPermissionDenied(err),
				"error must be NOT_FOUND or PERMISSION_DENIED (FGA authorize-before-load), got: %v", err)
		} else {
			assert.True(t, stigmer.IsNotFound(err), "error must be NOT_FOUND, got: %v", err)
		}
	})

	t.Run("Tier2_WorkflowExecution", func(t *testing.T) {
		if !workflowRunnerAvailable() {
			t.Skip("unified runner not available — skipping workflow execution test")
		}

		workflowName := fmt.Sprintf("sdk-smoke-wf-go-%s", testName)

		applied, err := client.Workflow.Apply(ctx, &stigmer.WorkflowInput{
			Name: workflowName,
			Org:  "test-org",
			Document: &stigmer.WorkflowDocumentInput{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      workflowName,
				Version:   "1.0.0",
			},
			Tasks: []*stigmer.WorkflowTaskInput{
				{
					Name: "setGreeting",
					Kind: workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: map[string]any{
						"variables": map[string]any{
							"greeting": "hello-from-go-sdk-smoke-test",
						},
					},
					Export: &stigmer.ExportInput{As: "${.}"},
				},
			},
		})
		require.NoError(t, err, "Workflow.Apply must succeed")
		workflowID := applied.GetMetadata().GetId()
		t.Logf("applied workflow: id=%s", workflowID)

		execution, err := client.WorkflowExecution.Create(ctx, &stigmer.WorkflowExecutionInput{
			Name:           fmt.Sprintf("sdk-smoke-exec-go-%s", testName),
			Org:            "test-org",
			WorkflowId:     workflowID,
			TriggerMessage: "SDK acceptance smoke test",
		})
		require.NoError(t, err, "WorkflowExecution.Create must succeed")
		executionID := execution.GetMetadata().GetId()
		t.Logf("created execution: id=%s", executionID)

		pollCtx, pollCancel := context.WithTimeout(ctx, 90*time.Second)
		defer pollCancel()

		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()

		var result *workflowexecutionv1.WorkflowExecution
		for {
			select {
			case <-pollCtx.Done():
				t.Fatalf("timed out waiting for execution to complete; last phase: %s",
					result.GetStatus().GetPhase().String())
			case <-ticker.C:
				result, err = client.WorkflowExecution.Get(ctx, executionID)
				require.NoError(t, err, "WorkflowExecution.Get must succeed during polling")

				phase := result.GetStatus().GetPhase()
				if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
					t.Logf("execution completed: id=%s", executionID)
					goto done
				}
				if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
					phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED {
					t.Fatalf("execution reached terminal failure phase: %s", phase.String())
				}
			}
		}
	done:
		assert.Equal(t,
			workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
			result.GetStatus().GetPhase(),
			"execution must reach COMPLETED phase",
		)

		for _, task := range result.GetStatus().GetTasks() {
			if task.GetTaskName() == "setGreeting" {
				assert.Equal(t,
					workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED,
					task.GetStatus(),
					"setGreeting task must be COMPLETED",
				)
			}
		}

		_, err = client.Workflow.Delete(ctx, workflowID)
		assert.NoError(t, err, "workflow cleanup deletion should succeed")
	})
}
