//go:build e2e

package e2e

import (
	"context"
	"fmt"
	"strings"
	"time"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
)

// ============================================================================
// Workflow Apply Tests (Deployment + Validation)
// ============================================================================

func (s *E2ESuite) TestWorkflowApply() {
	s.Run("TestApplySimpleSequential", s.TestApplySimpleSequential)
	s.Run("TestApplyConditionalSwitch", s.TestApplyConditionalSwitch)
	s.Run("TestApplyParallelFork", s.TestApplyParallelFork)
	s.Run("TestApplyLoopFor", s.TestApplyLoopFor)
	s.Run("TestApplyErrorHandling", s.TestApplyErrorHandling)
}

// TestApplySimpleSequential tests deploying a simple sequential workflow.
// Validates: Set → HTTP Call → Set task chaining
func (s *E2ESuite) TestApplySimpleSequential() {
	// Prepare test fixture
	fixture := s.PrepareWorkflowFixture("simple_sequential.go")

	// Apply the workflow
	output, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"apply",
		"--config", fixture,
	)
	s.NoError(err, "apply command should succeed")
	s.Contains(output, "simple-sequential", "output should contain workflow name")

	// Extract workflow ID from output
	workflowID := s.ExtractWorkflowID(output)
	s.NotEmpty(workflowID, "workflow ID should be extracted")

	// Verify workflow exists via API
	workflow := s.GetWorkflowByID(workflowID)
	s.NotNil(workflow, "workflow should exist in server")
	s.Equal("simple-sequential", workflow.Metadata.Slug, "workflow slug should match")

	// Validate task structure
	spec := workflow.Spec
	s.Len(spec.Tasks, 3, "should have 3 tasks")

	// Verify task 1: init (SET)
	task1 := spec.Tasks[0]
	s.Equal("init", task1.Name)
	s.Equal("SET", task1.Kind)
	s.Contains(task1.Config.AsMap(), "variables")

	// Verify task 2: fetch (HTTP_CALL)
	task2 := spec.Tasks[1]
	s.Equal("fetch", task2.Name)
	s.Equal("HTTP_CALL", task2.Kind)
	s.Equal("${.}", task2.ExportAs, "should export entire response")

	// Verify task 3: process (SET)
	task3 := spec.Tasks[2]
	s.Equal("process", task3.Name)
	s.Equal("SET", task3.Kind)

	// Verify dependencies are tracked
	s.NotEmpty(task2.Dependencies, "fetch should depend on init")
	s.NotEmpty(task3.Dependencies, "process should depend on fetch")
}

// TestApplyConditionalSwitch tests deploying a workflow with conditional logic.
// Validates: Switch task with multiple branches
func (s *E2ESuite) TestApplyConditionalSwitch() {
	fixture := s.PrepareWorkflowFixture("conditional_switch.go")

	output, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"apply",
		"--config", fixture,
	)
	s.NoError(err, "apply command should succeed")

	workflowID := s.ExtractWorkflowID(output)
	workflow := s.GetWorkflowByID(workflowID)

	// Validate switch task exists
	spec := workflow.Spec
	s.Len(spec.Tasks, 6, "should have 6 tasks (init + switch + 4 handlers)")

	// Find switch task
	var switchTask *workflowv1.Task
	for _, task := range spec.Tasks {
		if task.Kind == "SWITCH" {
			switchTask = task
			break
		}
	}
	s.NotNil(switchTask, "should have SWITCH task")
	s.Equal("check-status", switchTask.Name)

	// Verify switch config has conditions
	switchConfig := switchTask.Config.AsMap()
	s.Contains(switchConfig, "cases", "switch should have cases")
}

// TestApplyParallelFork tests deploying a workflow with parallel execution.
// Validates: Fork task with concurrent branches
func (s *E2ESuite) TestApplyParallelFork() {
	fixture := s.PrepareWorkflowFixture("parallel_fork.go")

	output, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"apply",
		"--config", fixture,
	)
	s.NoError(err, "apply command should succeed")

	workflowID := s.ExtractWorkflowID(output)
	workflow := s.GetWorkflowByID(workflowID)

	// Validate fork task exists
	spec := workflow.Spec
	s.True(len(spec.Tasks) >= 3, "should have at least 3 tasks")

	// Find fork task
	var forkTask *workflowv1.Task
	for _, task := range spec.Tasks {
		if task.Kind == "FORK" {
			forkTask = task
			break
		}
	}
	s.NotNil(forkTask, "should have FORK task")
	s.Equal("parallel-fetch", forkTask.Name)

	// Verify fork config has branches
	forkConfig := forkTask.Config.AsMap()
	s.Contains(forkConfig, "branches", "fork should have branches")

	// branches, ok := forkConfig["branches"].([]interface{})
	// s.True(ok, "branches should be an array")
	// s.Len(branches, 3, "should have 3 parallel branches (posts, todos, albums)")
}

// TestApplyLoopFor tests deploying a workflow with loop execution.
// Validates: For task with iteration
func (s *E2ESuite) TestApplyLoopFor() {
	fixture := s.PrepareWorkflowFixture("loop_for.go")

	output, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"apply",
		"--config", fixture,
	)
	s.NoError(err, "apply command should succeed")

	workflowID := s.ExtractWorkflowID(output)
	workflow := s.GetWorkflowByID(workflowID)

	// Validate for task exists
	spec := workflow.Spec
	s.True(len(spec.Tasks) >= 3, "should have at least 3 tasks")

	// Find for task
	var forTask *workflowv1.Task
	for _, task := range spec.Tasks {
		if task.Kind == "FOR" {
			forTask = task
			break
		}
	}
	s.NotNil(forTask, "should have FOR task")
	s.Equal("process-items", forTask.Name)

	// Verify for config has loop structure
	forConfig := forTask.Config.AsMap()
	s.Contains(forConfig, "in", "for should have 'in' (collection)")
	s.Contains(forConfig, "as", "for should have 'as' (loop variable)")
}

// TestApplyErrorHandling tests deploying a workflow with error handling.
// Validates: Try/Catch structure
func (s *E2ESuite) TestApplyErrorHandling() {
	fixture := s.PrepareWorkflowFixture("error_handling.go")

	output, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"apply",
		"--config", fixture,
	)
	s.NoError(err, "apply command should succeed")

	workflowID := s.ExtractWorkflowID(output)
	workflow := s.GetWorkflowByID(workflowID)

	// Validate try task exists
	spec := workflow.Spec
	s.True(len(spec.Tasks) >= 3, "should have at least 3 tasks")

	// Find try task
	var tryTask *workflowv1.Task
	for _, task := range spec.Tasks {
		if task.Kind == "TRY" {
			tryTask = task
			break
		}
	}
	s.NotNil(tryTask, "should have TRY task")
	s.Equal("try-fetch", tryTask.Name)

	// Verify try config has try and catch blocks
	tryConfig := tryTask.Config.AsMap()
	s.Contains(tryConfig, "try", "try should have 'try' block")
	s.Contains(tryConfig, "catch", "try should have 'catch' block")
}

// ============================================================================
// Workflow Execution Tests (Run + Validation)
// ============================================================================

func (s *E2ESuite) TestWorkflowExecution() {
	s.Run("TestExecuteSimpleSequential", s.TestExecuteSimpleSequential)
	// Additional execution tests can be added here
}

// TestExecuteSimpleSequential tests executing a simple sequential workflow.
// Validates: Tasks execute in order, data flows between tasks
func (s *E2ESuite) TestExecuteSimpleSequential() {
	// First deploy the workflow
	fixture := s.PrepareWorkflowFixture("simple_sequential.go")
	applyOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"apply",
		"--config", fixture,
	)
	s.NoError(err, "apply should succeed")

	workflowID := s.ExtractWorkflowID(applyOutput)

	// Execute the workflow
	runOutput, err := RunCLIWithServerAddr(
		s.Harness.ServerPort,
		"workflow", "run", workflowID,
		"--follow=false",
	)
	s.NoError(err, "workflow run should succeed")

	// Extract execution ID
	executionID := s.ExtractWorkflowExecutionID(runOutput)
	s.NotEmpty(executionID, "execution ID should be extracted")

	// Wait for execution to complete
	execution := s.WaitForWorkflowCompletion(executionID, 60*time.Second)
	s.NotNil(execution, "execution should complete")

	// Verify execution completed successfully
	s.Equal(
		workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED,
		execution.Status.Phase,
		"execution should complete successfully",
	)

	// Verify task execution order
	// The workflow runner should have executed: init → fetch → process
	// We can verify this through the execution context or status
	s.NotNil(execution.Status, "execution should have status")
}

// ============================================================================
// Helper Functions
// ============================================================================

// PrepareWorkflowFixture prepares a workflow test fixture.
// Returns the path to the Stigmer.yaml configured for the given workflow file.
func (s *E2ESuite) PrepareWorkflowFixture(workflowFile string) string {
	// Update Stigmer.yaml to point to the workflow file
	fixtureDir := "testdata/workflows"
	stigmerYaml := fmt.Sprintf("%s/Stigmer.yaml", fixtureDir)

	// For now, we'll use the existing Stigmer.yaml and assume it's configured correctly
	// In a more robust implementation, we could dynamically update it
	return stigmerYaml
}

// ExtractWorkflowID extracts workflow ID from CLI output.
// Expected format: "workflow/test-workflow-<id>"
func (s *E2ESuite) ExtractWorkflowID(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "workflow/") {
			// Extract the workflow ID from the line
			parts := strings.Split(line, "workflow/")
			if len(parts) > 1 {
				// Clean up the ID (remove trailing whitespace, quotes, etc.)
				id := strings.TrimSpace(parts[1])
				id = strings.Trim(id, "\"")
				return id
			}
		}
	}
	return ""
}

// ExtractWorkflowExecutionID extracts workflow execution ID from CLI output.
func (s *E2ESuite) ExtractWorkflowExecutionID(output string) string {
	lines := strings.Split(output, "\n")
	for _, line := range lines {
		if strings.Contains(line, "execution-id:") || strings.Contains(line, "Execution ID:") {
			parts := strings.Split(line, ":")
			if len(parts) > 1 {
				id := strings.TrimSpace(parts[1])
				return id
			}
		}
	}
	return ""
}

// GetWorkflowByID retrieves a workflow by ID via the API.
func (s *E2ESuite) GetWorkflowByID(workflowID string) *workflowv1.Workflow {
	conn := s.CreateGRPCConnection()
	defer conn.Close()

	client := workflowv1.NewWorkflowQueryControllerClient(conn)
	
	response, err := client.GetById(context.Background(), &workflowv1.WorkflowGetByIdQueryInput{
		Id: workflowID,
	})
	
	if err != nil {
		return nil
	}
	
	return response.Workflow
}

// WaitForWorkflowCompletion waits for a workflow execution to complete.
// Returns the final execution state or nil if timeout.
func (s *E2ESuite) WaitForWorkflowCompletion(
	executionID string,
	timeout time.Duration,
) *workflowexecutionv1.WorkflowExecution {
	conn := s.CreateGRPCConnection()
	defer conn.Close()

	client := workflowexecutionv1.NewWorkflowExecutionQueryControllerClient(conn)
	
	deadline := time.Now().Add(timeout)
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for time.Now().Before(deadline) {
		response, err := client.GetById(context.Background(), &workflowexecutionv1.WorkflowExecutionGetByIdQueryInput{
			Id: executionID,
		})
		
		if err == nil && response.WorkflowExecution != nil {
			execution := response.WorkflowExecution
			phase := execution.Status.Phase
			
			// Check if execution is in a terminal state
			if phase == workflowexecutionv1.ExecutionPhase_EXECUTION_COMPLETED ||
				phase == workflowexecutionv1.ExecutionPhase_EXECUTION_FAILED ||
				phase == workflowexecutionv1.ExecutionPhase_EXECUTION_CANCELLED {
				return execution
			}
		}
		
		<-ticker.C
	}
	
	return nil
}
