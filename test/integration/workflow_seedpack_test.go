//go:build integration

package integration

import (
	"context"
	"os"
	"testing"
	"time"

	executionctxv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/executioncontext/v1"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// requireSeedpackPrereqs skips the test if the workflow-runner or required
// LLM API keys are unavailable. All seedpack workflows use llm_call.
func requireSeedpackPrereqs(t *testing.T) {
	t.Helper()
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	if testHarness.UnifiedRunner == nil {
		t.Skip("unified runner not available")
	}
	hasAnthropic := os.Getenv("ANTHROPIC_API_KEY") != ""
	hasOpenAI := os.Getenv("OPENAI_API_KEY") != ""
	if !hasAnthropic && !hasOpenAI {
		t.Skip("no LLM API keys set (need ANTHROPIC_API_KEY or OPENAI_API_KEY) — skipping seedpack workflow tests")
	}
}

// plainEnv builds a RuntimeEnv map from string key-value pairs.
func plainEnv(kvs ...string) map[string]*executionctxv1.ExecutionValue {
	env := make(map[string]*executionctxv1.ExecutionValue, len(kvs)/2)
	for i := 0; i < len(kvs)-1; i += 2 {
		env[kvs[i]] = &executionctxv1.ExecutionValue{Value: kvs[i+1]}
	}
	return env
}

// TestSeedpackWorkflow_ContentReviewPipeline exercises the content-review-pipeline
// seedpack workflow end-to-end:
//
//	draft_content (llm_call) → review_content (human_input, approve) → finalize (transform)
//
// The test supplies a TOPIC, waits for the human_input gate, submits approval,
// and asserts the workflow completes with an approved status in the output.
func TestSeedpackWorkflow_ContentReviewPipeline(t *testing.T) {
	requireSeedpackPrereqs(t)
	if os.Getenv("ANTHROPIC_API_KEY") == "" {
		t.Skip("ANTHROPIC_API_KEY not set — content-review-pipeline uses claude-sonnet-4.5")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	wf, err := harness.LoadSeedpackWorkflow("content-review-pipeline.yaml")
	require.NoError(t, err, "loading seedpack workflow YAML should succeed")

	wf.Metadata.Name = "integration-test-seedpack-content-review"
	wf.Metadata.Org = "test-org"
	wf.Spec.Document.Namespace = "test-org"
	wf.Spec.Document.Name = "integration-test-seedpack-content-review"

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "seedpack-content", suiteLogger)
	defer deployer.Cleanup(ctx)

	env := plainEnv(
		"TOPIC", "The benefits of automated integration testing",
		"GUIDELINES", "Keep it concise, under 200 words.",
	)

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, wf, "seedpack content review test", env)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	t.Logf("execution created: id=%s, waiting for review_content human_input gate...", executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "review_content", 3*time.Minute)
	require.NoError(t, err, "review_content should reach WAITING_APPROVAL")

	t.Logf("submitting approval for task 'review_content' on execution %s", executionID)
	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "review_content",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err, "submitting approval should succeed")

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "draft_content",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "review_content",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "finalize",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	output := result.GetStatus().GetOutput()
	if assert.NotNil(t, output, "execution should produce output") {
		fields := output.GetFields()
		assert.Contains(t, fields, "status", "output should contain 'status' key")
		assert.Contains(t, fields, "topic", "output should contain 'topic' key")
		assert.Contains(t, fields, "content", "output should contain 'content' key")
	}

	t.Logf("content-review-pipeline seedpack workflow completed successfully")
}

// TestSeedpackWorkflow_SupportTicketTriage exercises the support-ticket-triage
// seedpack workflow end-to-end:
//
//	classify_ticket (llm_call) → route_by_severity (switch_case)
//	  ├─ critical → escalation_approval (human_input) → build_escalation_summary
//	  ├─ high → build_high_summary
//	  └─ default → build_standard_summary
//
// The LLM classification is non-deterministic. If the ticket is classified as
// critical, the test submits approval at the escalation gate. Otherwise it
// asserts the workflow completes through the non-critical path.
func TestSeedpackWorkflow_SupportTicketTriage(t *testing.T) {
	requireSeedpackPrereqs(t)
	if os.Getenv("OPENAI_API_KEY") == "" {
		t.Skip("OPENAI_API_KEY not set — support-ticket-triage uses gpt-4o-mini")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	wf, err := harness.LoadSeedpackWorkflow("support-ticket-triage.yaml")
	require.NoError(t, err, "loading seedpack workflow YAML should succeed")

	wf.Metadata.Name = "integration-test-seedpack-triage"
	wf.Metadata.Org = "test-org"
	wf.Spec.Document.Namespace = "test-org"
	wf.Spec.Document.Name = "integration-test-seedpack-triage"

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "seedpack-triage", suiteLogger)
	defer deployer.Cleanup(ctx)

	env := plainEnv(
		"TICKET_DESCRIPTION", "I cannot log into my account. I have tried resetting my password three times but the reset email never arrives. This is blocking my team from accessing project files.",
		"CUSTOMER_EMAIL", "test-user@example.com",
	)

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, wf, "seedpack triage test", env)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	t.Logf("execution created: id=%s, waiting for triage to complete...", executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	// The LLM might classify this as critical (triggering the human_input gate)
	// or as high/standard (completing without human input). Poll for either
	// terminal phase or the escalation_approval waiting state.
	var result *workflowexecutionv1.WorkflowExecution
	deadline := time.Now().Add(3 * time.Minute)
	interval := 500 * time.Millisecond

	for time.Now().Before(deadline) {
		exec, pollErr := clients.ExecutionQuery.Get(ctx, &workflowexecutionv1.WorkflowExecutionId{Value: executionID})
		if pollErr != nil {
			time.Sleep(interval)
			continue
		}

		phase := exec.GetStatus().GetPhase()

		// Completed via non-critical path (no human_input needed).
		if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED {
			result = exec
			t.Logf("triage completed via non-critical path (no human_input gate)")
			break
		}

		if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
			phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED ||
			phase == workflowexecutionv1.ExecutionPhase_EXECUTION_TERMINATED {
			result = exec
			break
		}

		// Check if escalation_approval task is waiting for approval.
		for _, task := range exec.GetStatus().GetTasks() {
			if task.GetTaskName() == "escalation_approval" &&
				task.GetStatus() == workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_WAITING_APPROVAL {

				t.Logf("ticket classified as critical — submitting escalation approval")
				_, approveErr := clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
					&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
						ExecutionId: executionID,
						TaskName:    "escalation_approval",
						Outcome:     "approve",
						Reviewer:    "integration-test",
					})
				require.NoError(t, approveErr, "submitting escalation approval should succeed")

				result, err = waiter.WaitForPhase(ctx, executionID,
					workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
				require.NoError(t, err)
				break
			}
		}

		if result != nil {
			break
		}

		time.Sleep(interval)
		if interval < 2*time.Second {
			interval = time.Duration(float64(interval) * 1.5)
		}
	}

	require.NotNil(t, result, "execution should have reached a terminal phase")
	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)

	harness.AssertTaskStatus(t, result, "classify_ticket",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "route_by_severity",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	output := result.GetStatus().GetOutput()
	if assert.NotNil(t, output, "execution should produce output") {
		fields := output.GetFields()
		assert.Contains(t, fields, "status", "output should contain 'status' key")
		assert.Contains(t, fields, "category", "output should contain 'category' key")
		assert.Contains(t, fields, "summary", "output should contain 'summary' key")
		assert.Contains(t, fields, "action", "output should contain 'action' key")
	}

	t.Logf("support-ticket-triage seedpack workflow completed successfully")
}

// TestSeedpackWorkflow_ResearchAndSummarize exercises the research-and-summarize
// seedpack workflow end-to-end:
//
//	initial_analysis (llm_call) → parallel_processing (fork)
//	  ├─ executive_summary branch: summarize (llm_call)
//	  └─ key_findings branch: extract_findings (llm_call, structured)
//	→ merge_results (transform/jq) → review_report (human_input) → finalize_report (transform/jq)
//
// This is the most complex seedpack workflow: 3 LLM calls (one in parallel fork),
// JQ transforms, and a human approval gate.
func TestSeedpackWorkflow_ResearchAndSummarize(t *testing.T) {
	requireSeedpackPrereqs(t)
	hasAnthropic := os.Getenv("ANTHROPIC_API_KEY") != ""
	hasOpenAI := os.Getenv("OPENAI_API_KEY") != ""
	if !hasAnthropic || !hasOpenAI {
		t.Skip("both ANTHROPIC_API_KEY and OPENAI_API_KEY required — research-and-summarize uses claude-sonnet-4.5 and gpt-4o-mini")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	wf, err := harness.LoadSeedpackWorkflow("research-and-summarize.yaml")
	require.NoError(t, err, "loading seedpack workflow YAML should succeed")

	wf.Metadata.Name = "integration-test-seedpack-research"
	wf.Metadata.Org = "test-org"
	wf.Spec.Document.Namespace = "test-org"
	wf.Spec.Document.Name = "integration-test-seedpack-research"

	clients := harness.NewClients(grpcConn)
	deployer := harness.NewFixtureDeployer(clients, "seedpack-research", suiteLogger)
	defer deployer.Cleanup(ctx)

	env := plainEnv(
		"TOPIC", "Benefits of automated integration testing for software quality",
		"SOURCE_MATERIAL", `Automated integration testing validates that different components of a software
system work together correctly. Key benefits include: early detection of
interface mismatches, regression prevention, increased deployment confidence,
and documentation of expected system behavior. Studies show teams with
comprehensive integration test suites deploy 30% more frequently with
50% fewer production incidents.`,
		"DEPTH", "brief",
	)

	_, execution, err := deployer.DeployAndExecuteWithEnv(ctx, wf, "seedpack research test", env)
	require.NoError(t, err)

	executionID := execution.GetMetadata().GetId()
	t.Logf("execution created: id=%s, waiting for review_report human_input gate...", executionID)

	waiter := harness.NewExecutionWaiter(clients.ExecutionQuery, suiteLogger)

	// Wait for the LLM calls + fork to complete and reach the human_input gate.
	// This may take a while: initial_analysis + parallel (summarize, extract_findings) + merge.
	_, err = waiter.WaitForTaskWaitingApproval(ctx, executionID, "review_report", 4*time.Minute)
	require.NoError(t, err, "review_report should reach WAITING_APPROVAL")

	t.Logf("submitting approval for task 'review_report' on execution %s", executionID)
	_, err = clients.ExecutionCommand.SubmitWorkflowTaskApproval(ctx,
		&workflowexecutionv1.SubmitWorkflowTaskApprovalInput{
			ExecutionId: executionID,
			TaskName:    "review_report",
			Outcome:     "approve",
			Reviewer:    "integration-test",
		})
	require.NoError(t, err, "submitting approval should succeed")

	result, err := waiter.WaitForPhase(ctx, executionID,
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED, 90*time.Second)
	require.NoError(t, err)

	harness.AssertPhase(t, result, workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED)
	harness.AssertTaskStatus(t, result, "initial_analysis",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "parallel_processing",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "merge_results",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "review_report",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)
	harness.AssertTaskStatus(t, result, "finalize_report",
		workflowexecutionv1.WorkflowTaskStatus_WORKFLOW_TASK_COMPLETED)

	output := result.GetStatus().GetOutput()
	if assert.NotNil(t, output, "execution should produce output") {
		fields := output.GetFields()
		assert.Contains(t, fields, "status", "output should contain 'status' key")
		assert.Contains(t, fields, "topic", "output should contain 'topic' key")
		assert.Contains(t, fields, "executive_summary", "output should contain 'executive_summary' key")
		assert.Contains(t, fields, "key_findings", "output should contain 'key_findings' key")
	}

	t.Logf("research-and-summarize seedpack workflow completed successfully")
}

// TestSeedpackWorkflow_LoadAll is a fast validation test that verifies all
// seedpack workflow YAML files can be parsed into valid Workflow protos.
// Does not execute any workflows — just validates the YAML-to-proto conversion.
func TestSeedpackWorkflow_LoadAll(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	seedpackWorkflows := []string{
		"content-review-pipeline.yaml",
		"support-ticket-triage.yaml",
		"research-and-summarize.yaml",
	}

	for _, filename := range seedpackWorkflows {
		t.Run(filename, func(t *testing.T) {
			wf, err := harness.LoadSeedpackWorkflow(filename)
			require.NoError(t, err, "loading %s should succeed", filename)
			require.NotNil(t, wf.Spec, "workflow spec should not be nil")
			require.NotEmpty(t, wf.Spec.Tasks, "workflow should have at least one task")
			require.NotEmpty(t, wf.Metadata.Name, "workflow should have a name")

			t.Logf("loaded %s: name=%s, tasks=%d",
				filename, wf.Metadata.Name, len(wf.Spec.Tasks))
		})
	}
}

// TestSeedpackWorkflow_ApplyAll verifies that every seedpack workflow YAML
// can be applied to the server via the WorkflowCommand.Apply gRPC API.
// Unlike the full E2E tests above, this does NOT require LLM API keys or
// the workflow runner — it only needs the Java service to be running.
// This catches server-side validation failures (schema checks, persistence
// errors, business rules) that pass local proto parsing but fail on apply.
func TestSeedpackWorkflow_ApplyAll(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")
	clients := harness.NewClients(grpcConn)

	seedpackWorkflows := []string{
		"content-review-pipeline.yaml",
		"support-ticket-triage.yaml",
		"research-and-summarize.yaml",
	}

	for _, filename := range seedpackWorkflows {
		t.Run(filename, func(t *testing.T) {
			wf, err := harness.LoadSeedpackWorkflow(filename)
			require.NoError(t, err, "loading %s should succeed", filename)

			wf.Metadata.Name = "apply-test-" + wf.Metadata.Name
			wf.Metadata.Org = "test-org"
			wf.Spec.Document.Namespace = "test-org"
			wf.Spec.Document.Name = wf.Metadata.Name

			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()

			applied, err := clients.WorkflowCommand.Apply(ctx, wf)
			require.NoError(t, err, "server-side apply of %s should succeed", filename)
			require.NotEmpty(t, applied.GetMetadata().GetId(),
				"applied workflow should have a server-assigned ID")

			t.Logf("applied %s: id=%s", filename, applied.GetMetadata().GetId())

			_, _ = clients.WorkflowCommand.Delete(ctx,
				&workflowv1.WorkflowId{Value: applied.GetMetadata().GetId()})
		})
	}
}
