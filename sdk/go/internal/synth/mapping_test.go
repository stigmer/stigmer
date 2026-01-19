package synth

import (
	"testing"

	"github.com/stigmer/stigmer/sdk/go/workflow"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestSetTaskMapping verifies SET task field name mapping.
func TestSetTaskMapping(t *testing.T) {
	// Create workflow with SET task
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-set"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.SetTask("init",
				workflow.SetVar("x", "1"),
				workflow.SetVar("y", "2"),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	// Convert to proto manifest
	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert SET task")
	require.Len(t, manifest.Workflows, 1, "should have 1 workflow")
	require.Len(t, manifest.Workflows[0].Spec.Tasks, 1, "should have 1 task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	// Verify proto field names
	assert.Contains(t, taskConfig.Fields, "variables", "should have 'variables' field")

	// Should NOT have Go field names
	assert.NotContains(t, taskConfig.Fields, "Variables", "should not have Go field name 'Variables'")
}

// TestHttpCallTaskMapping verifies HTTP_CALL task field name mapping.
func TestHttpCallTaskMapping(t *testing.T) {
	// Create workflow with HTTP_CALL task
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-http"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.HttpCallTask("fetch",
				workflow.WithHTTPGet(),
				workflow.WithURI("https://api.example.com/data"),
				workflow.WithHeader("Authorization", "Bearer token"),
				workflow.WithTimeout(60),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	// Convert to proto manifest
	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert HTTP_CALL task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	// Verify proto field names
	assert.Contains(t, taskConfig.Fields, "method", "should have 'method' field")
	assert.Contains(t, taskConfig.Fields, "endpoint", "should have 'endpoint' field")
	assert.Contains(t, taskConfig.Fields, "headers", "should have 'headers' field")
	assert.Contains(t, taskConfig.Fields, "timeout_seconds", "should have 'timeout_seconds' field")

	// Verify nested endpoint structure
	endpoint := taskConfig.Fields["endpoint"].GetStructValue()
	require.NotNil(t, endpoint, "endpoint should be a struct")
	assert.Contains(t, endpoint.Fields, "uri", "endpoint should have 'uri' field")

	// Should NOT have Go field names
	assert.NotContains(t, taskConfig.Fields, "Method", "should not have Go field name 'Method'")
	assert.NotContains(t, taskConfig.Fields, "URI", "should not have Go field name 'URI'")
	assert.NotContains(t, taskConfig.Fields, "TimeoutSeconds", "should not have Go field name 'TimeoutSeconds'")
}

// TestSwitchTaskMapping verifies SWITCH task field name mapping.
// This is a critical test for the mapping layer fixes.
func TestSwitchTaskMapping(t *testing.T) {
	// Create workflow with SWITCH task
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-switch"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.SwitchTask("check",
				workflow.WithCase("${.x > 5}", "high"),
				workflow.WithCase("${.x > 0}", "low"),
				workflow.WithDefault("zero"),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	// Convert to proto manifest
	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert SWITCH task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	// Verify proto field names
	assert.Contains(t, taskConfig.Fields, "cases", "should have 'cases' field")

	// Verify cases structure
	casesList := taskConfig.Fields["cases"].GetListValue()
	require.NotNil(t, casesList, "cases should be a list")
	require.Len(t, casesList.Values, 3, "should have 3 cases (2 conditions + 1 default)")

	// Check first case has correct proto field names
	firstCase := casesList.Values[0].GetStructValue()
	require.NotNil(t, firstCase, "first case should be a struct")

	assert.Contains(t, firstCase.Fields, "name", "case should have 'name' field")
	assert.Contains(t, firstCase.Fields, "when", "case should have 'when' field (not 'condition')")
	assert.Contains(t, firstCase.Fields, "then", "case should have 'then' field")

	// Should NOT have Go field names
	assert.NotContains(t, firstCase.Fields, "condition", "should not have Go field name 'condition'")
	assert.NotContains(t, firstCase.Fields, "Condition", "should not have Go field name 'Condition'")

	// Verify default case has empty "when"
	defaultCase := casesList.Values[2].GetStructValue()
	require.NotNil(t, defaultCase, "default case should be a struct")
	assert.Equal(t, "", defaultCase.Fields["when"].GetStringValue(), "default case should have empty 'when'")
	assert.Equal(t, "default", defaultCase.Fields["name"].GetStringValue(), "default case should have name 'default'")
}

// TestForTaskMapping verifies FOR task field name mapping and nested task conversion.
func TestForTaskMapping(t *testing.T) {
	// Create workflow with FOR task
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-for"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.ForTask("loop",
				workflow.WithIn("${.items}"),
				workflow.WithDo(
					workflow.SetTask("process", workflow.SetVar("x", "${.item}")),
				),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	// Convert to proto manifest
	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert FOR task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	// Verify proto field names
	assert.Contains(t, taskConfig.Fields, "each", "should have 'each' field")
	assert.Contains(t, taskConfig.Fields, "in", "should have 'in' field")
	assert.Contains(t, taskConfig.Fields, "do", "should have 'do' field")

	// Verify "each" default value
	assert.Equal(t, "item", taskConfig.Fields["each"].GetStringValue(), "'each' should default to 'item'")

	// Verify nested tasks are fully converted (not just name/kind)
	doTasks := taskConfig.Fields["do"].GetListValue()
	require.NotNil(t, doTasks, "do should be a list")
	require.Len(t, doTasks.Values, 1, "should have 1 nested task")

	nestedTask := doTasks.Values[0].GetStructValue()
	require.NotNil(t, nestedTask, "nested task should be a struct")

	// Verify nested task has all required fields
	assert.Contains(t, nestedTask.Fields, "name", "nested task should have 'name'")
	assert.Contains(t, nestedTask.Fields, "kind", "nested task should have 'kind'")
	assert.Contains(t, nestedTask.Fields, "task_config", "nested task should have 'task_config' (full task object)")

	// Should NOT just have name/kind
	taskConfigField := nestedTask.Fields["task_config"].GetStructValue()
	require.NotNil(t, taskConfigField, "nested task should have full task_config struct")
}

// TestForkTaskMapping verifies FORK task field name mapping and nested task conversion.
func TestForkTaskMapping(t *testing.T) {
	// Create workflow with FORK task
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-fork"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.ForkTask("parallel",
				workflow.WithBranch("branch1",
					workflow.SetTask("task1", workflow.SetVar("x", "1")),
				),
				workflow.WithBranch("branch2",
					workflow.SetTask("task2", workflow.SetVar("y", "2")),
				),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	// Convert to proto manifest
	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert FORK task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	// Verify proto field names
	assert.Contains(t, taskConfig.Fields, "branches", "should have 'branches' field")
	assert.Contains(t, taskConfig.Fields, "compete", "should have 'compete' field")

	// Verify "compete" default value
	assert.Equal(t, false, taskConfig.Fields["compete"].GetBoolValue(), "'compete' should default to false")

	// Verify branches structure
	branchesList := taskConfig.Fields["branches"].GetListValue()
	require.NotNil(t, branchesList, "branches should be a list")
	require.Len(t, branchesList.Values, 2, "should have 2 branches")

	// Check first branch has correct structure
	firstBranch := branchesList.Values[0].GetStructValue()
	require.NotNil(t, firstBranch, "first branch should be a struct")

	assert.Contains(t, firstBranch.Fields, "name", "branch should have 'name' field")
	assert.Contains(t, firstBranch.Fields, "do", "branch should have 'do' field (nested tasks)")

	// Verify nested tasks in branch
	doTasks := firstBranch.Fields["do"].GetListValue()
	require.NotNil(t, doTasks, "branch 'do' should be a list")
	require.Len(t, doTasks.Values, 1, "branch should have 1 nested task")

	nestedTask := doTasks.Values[0].GetStructValue()
	require.NotNil(t, nestedTask, "nested task should be a struct")

	// Verify nested task has full structure
	assert.Contains(t, nestedTask.Fields, "name", "nested task should have 'name'")
	assert.Contains(t, nestedTask.Fields, "kind", "nested task should have 'kind'")
	assert.Contains(t, nestedTask.Fields, "task_config", "nested task should have 'task_config'")
}

// TestTryTaskMapping verifies TRY task field name mapping and nested task conversion.
func TestTryTaskMapping(t *testing.T) {
	// Create workflow with TRY task
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-try"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.TryTask("attempt",
				workflow.WithTry(
					workflow.HttpCallTask("risky",
						workflow.WithHTTPGet(),
						workflow.WithURI("https://api.example.com/flaky"),
					),
				),
				workflow.WithCatch([]string{"NetworkError"}, "err",
					workflow.SetTask("logError", workflow.SetVar("error", "${err}")),
				),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	// Convert to proto manifest
	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert TRY task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	// Verify proto field names
	assert.Contains(t, taskConfig.Fields, "try", "should have 'try' field (not 'tasks')")
	assert.Contains(t, taskConfig.Fields, "catch", "should have 'catch' field")

	// Should NOT have Go field names
	assert.NotContains(t, taskConfig.Fields, "tasks", "should not have Go field name 'tasks'")
	assert.NotContains(t, taskConfig.Fields, "Tasks", "should not have Go field name 'Tasks'")

	// Verify "try" contains nested tasks
	tryTasks := taskConfig.Fields["try"].GetListValue()
	require.NotNil(t, tryTasks, "try should be a list")
	require.Len(t, tryTasks.Values, 1, "should have 1 try task")

	tryTask := tryTasks.Values[0].GetStructValue()
	require.NotNil(t, tryTask, "try task should be a struct")
	assert.Contains(t, tryTask.Fields, "task_config", "try task should have full task_config")

	// Verify "catch" is singular (not array)
	catchBlock := taskConfig.Fields["catch"].GetStructValue()
	require.NotNil(t, catchBlock, "catch should be a struct (singular, not array)")

	// Verify catch block structure
	assert.Contains(t, catchBlock.Fields, "as", "catch should have 'as' field")
	assert.Contains(t, catchBlock.Fields, "do", "catch should have 'do' field")

	// Proto doesn't support "errors" field, so it should not be present
	assert.NotContains(t, catchBlock.Fields, "errors", "proto doesn't support 'errors' field in catch")

	// Verify catch "do" contains nested tasks
	catchTasks := catchBlock.Fields["do"].GetListValue()
	require.NotNil(t, catchTasks, "catch 'do' should be a list")
	require.Len(t, catchTasks.Values, 1, "should have 1 catch task")

	catchTask := catchTasks.Values[0].GetStructValue()
	require.NotNil(t, catchTask, "catch task should be a struct")
	assert.Contains(t, catchTask.Fields, "task_config", "catch task should have full task_config")
}

// TestGrpcCallTaskMapping verifies GRPC_CALL task field name mapping.
func TestGrpcCallTaskMapping(t *testing.T) {
	// Create workflow with GRPC_CALL task
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-grpc"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.GrpcCallTask("callService",
				workflow.WithService("UserService"),
				workflow.WithGrpcMethod("GetUser"),
				workflow.WithGrpcBody(map[string]any{"userId": "123"}),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	// Convert to proto manifest
	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert GRPC_CALL task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	// Verify proto field names
	assert.Contains(t, taskConfig.Fields, "service", "should have 'service' field")
	assert.Contains(t, taskConfig.Fields, "method", "should have 'method' field")
	assert.Contains(t, taskConfig.Fields, "body", "should have 'body' field")
}

// TestListenTaskMapping verifies LISTEN task field name mapping.
func TestListenTaskMapping(t *testing.T) {
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-listen"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.ListenTask("waitEvent",
				workflow.WithEvent("approval.granted"),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert LISTEN task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	assert.Contains(t, taskConfig.Fields, "event", "should have 'event' field")
}

// TestWaitTaskMapping verifies WAIT task field name mapping.
func TestWaitTaskMapping(t *testing.T) {
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-wait"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.WaitTask("delay",
				workflow.WithDuration("5s"),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert WAIT task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	assert.Contains(t, taskConfig.Fields, "duration", "should have 'duration' field")
}

// TestCallActivityTaskMapping verifies CALL_ACTIVITY task field name mapping.
func TestCallActivityTaskMapping(t *testing.T) {
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-activity"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.CallActivityTask("process",
				workflow.WithActivity("DataProcessor"),
				workflow.WithActivityInput(map[string]any{"data": "value"}),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert CALL_ACTIVITY task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	assert.Contains(t, taskConfig.Fields, "activity", "should have 'activity' field")
	assert.Contains(t, taskConfig.Fields, "input", "should have 'input' field")
}

// TestRaiseTaskMapping verifies RAISE task field name mapping.
func TestRaiseTaskMapping(t *testing.T) {
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-raise"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.RaiseTask("throwError",
				workflow.WithError("ValidationError"),
				workflow.WithErrorMessage("Invalid input"),
				workflow.WithErrorData(map[string]any{"field": "email"}),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert RAISE task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	assert.Contains(t, taskConfig.Fields, "error", "should have 'error' field")
	assert.Contains(t, taskConfig.Fields, "message", "should have 'message' field")
	assert.Contains(t, taskConfig.Fields, "data", "should have 'data' field")
}

// TestRunTaskMapping verifies RUN task field name mapping.
func TestRunTaskMapping(t *testing.T) {
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-run"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.RunTask("executeSubWorkflow",
				workflow.WithWorkflow("sub-workflow"),
				workflow.WithWorkflowInput(map[string]any{"key": "value"}),
			),
		),
	)
	require.NoError(t, err, "should create workflow")

	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert RUN task")

	task := manifest.Workflows[0].Spec.Tasks[0]
	taskConfig := task.TaskConfig

	assert.Contains(t, taskConfig.Fields, "workflow", "should have 'workflow' field")
	assert.Contains(t, taskConfig.Fields, "input", "should have 'input' field")
}

// =============================================================================
// Context Variable Injection Tests
// =============================================================================

// TestContextInitTask_Creation verifies createContextInitTask() generates correct SET task.
func TestContextInitTask_Creation(t *testing.T) {
	// Create a mock Ref implementation for testing
	type testRef struct {
		value interface{}
	}
	
	// Mock ToValue() method
	contextVars := map[string]interface{}{
		"apiURL": &testStringRef{value: "https://api.example.com"},
		"retries": &testIntRef{value: 3},
		"isProd": &testBoolRef{value: true},
		"config": &testObjectRef{value: map[string]interface{}{
			"timeout": 30,
		}},
	}
	
	task, err := createContextInitTask(contextVars)
	require.NoError(t, err, "should create context init task")
	
	// Verify task structure
	assert.Equal(t, "__stigmer_init_context", task.Name, "should have correct task name")
	assert.Equal(t, "WORKFLOW_TASK_KIND_SET", task.Kind.String(), "should be SET task")
	
	// Verify task config has variables
	taskConfig := task.TaskConfig
	require.NotNil(t, taskConfig, "task config should not be nil")
	assert.Contains(t, taskConfig.Fields, "variables", "should have 'variables' field")
	
	// Verify variables content
	variables := taskConfig.Fields["variables"].GetStructValue()
	require.NotNil(t, variables, "variables should be a struct")
	
	assert.Contains(t, variables.Fields, "apiURL", "should have apiURL variable")
	assert.Contains(t, variables.Fields, "retries", "should have retries variable")
	assert.Contains(t, variables.Fields, "isProd", "should have isProd variable")
	assert.Contains(t, variables.Fields, "config", "should have config variable")
	
	// Verify values
	assert.Equal(t, "https://api.example.com", variables.Fields["apiURL"].GetStringValue())
	assert.Equal(t, float64(3), variables.Fields["retries"].GetNumberValue()) // JSON numbers are float64
	assert.Equal(t, true, variables.Fields["isProd"].GetBoolValue())
	
	configValue := variables.Fields["config"].GetStructValue()
	require.NotNil(t, configValue, "config should be a struct")
	assert.Equal(t, float64(30), configValue.Fields["timeout"].GetNumberValue())
}

// TestContextInitTask_EmptyVars verifies behavior with empty context vars.
func TestContextInitTask_EmptyVars(t *testing.T) {
	contextVars := map[string]interface{}{}
	
	task, err := createContextInitTask(contextVars)
	require.NoError(t, err, "should create task even with empty vars")
	
	// Verify task has empty variables
	taskConfig := task.TaskConfig
	variables := taskConfig.Fields["variables"].GetStructValue()
	require.NotNil(t, variables, "variables should exist")
	assert.Equal(t, 0, len(variables.Fields), "variables should be empty")
}

// TestWorkflowWithContextVars verifies context variables are injected into workflow.
func TestWorkflowWithContextVars(t *testing.T) {
	// Create a simple workflow
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-context"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.SetTask("userTask", workflow.SetVar("x", "1")),
		),
	)
	require.NoError(t, err, "should create workflow")
	
	// Create context vars
	contextVars := map[string]interface{}{
		"apiURL": &testStringRef{value: "https://api.example.com"},
		"retries": &testIntRef{value: 3},
	}
	
	// Convert with context
	manifest, err := ToWorkflowManifestWithContext(contextVars, wf)
	require.NoError(t, err, "should convert workflow with context")
	
	require.Len(t, manifest.Workflows, 1, "should have 1 workflow")
	tasks := manifest.Workflows[0].Spec.Tasks
	
	// Should have 2 tasks: context init + user task
	require.Len(t, tasks, 2, "should have context init task + user task")
	
	// First task should be context init
	initTask := tasks[0]
	assert.Equal(t, "__stigmer_init_context", initTask.Name, "first task should be context init")
	assert.Equal(t, "WORKFLOW_TASK_KIND_SET", initTask.Kind.String(), "should be SET task")
	
	// Verify init task has variables
	initConfig := initTask.TaskConfig
	variables := initConfig.Fields["variables"].GetStructValue()
	require.NotNil(t, variables, "should have variables")
	assert.Contains(t, variables.Fields, "apiURL", "should have apiURL")
	assert.Contains(t, variables.Fields, "retries", "should have retries")
	
	// Second task should be user's task
	userTask := tasks[1]
	assert.Equal(t, "userTask", userTask.Name, "second task should be user task")
}

// TestWorkflowWithoutContextVars verifies no init task is injected when no context vars.
func TestWorkflowWithoutContextVars(t *testing.T) {
	// Create a simple workflow
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-no-context"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.SetTask("userTask", workflow.SetVar("x", "1")),
		),
	)
	require.NoError(t, err, "should create workflow")
	
	// Convert with nil context vars
	manifest, err := ToWorkflowManifestWithContext(nil, wf)
	require.NoError(t, err, "should convert workflow without context")
	
	require.Len(t, manifest.Workflows, 1, "should have 1 workflow")
	tasks := manifest.Workflows[0].Spec.Tasks
	
	// Should have only 1 task (user task, no context init)
	require.Len(t, tasks, 1, "should only have user task, no context init")
	
	userTask := tasks[0]
	assert.Equal(t, "userTask", userTask.Name, "should be user task")
	assert.NotEqual(t, "__stigmer_init_context", userTask.Name, "should not be context init task")
}

// TestBackwardCompatibility verifies ToWorkflowManifest() still works without context.
func TestBackwardCompatibility(t *testing.T) {
	// Create workflow using old function (no context)
	wf, err := workflow.New(
		nil, // No context needed for mapping tests
		workflow.WithName("test-backward-compat"),
		workflow.WithNamespace("test"),
		workflow.WithTasks(
			workflow.SetTask("task1", workflow.SetVar("x", "1")),
		),
	)
	require.NoError(t, err, "should create workflow")
	
	// Use old ToWorkflowManifest function
	manifest, err := ToWorkflowManifest(wf)
	require.NoError(t, err, "should convert using old function")
	
	require.Len(t, manifest.Workflows, 1, "should have 1 workflow")
	tasks := manifest.Workflows[0].Spec.Tasks
	
	// Should only have user task (backward compatible behavior)
	require.Len(t, tasks, 1, "should only have user task")
	assert.Equal(t, "task1", tasks[0].Name, "should be user task")
}

// =============================================================================
// Mock Ref Implementations for Testing
// =============================================================================

type testStringRef struct {
	value string
}

func (r *testStringRef) ToValue() interface{} {
	return r.value
}

type testIntRef struct {
	value int
}

func (r *testIntRef) ToValue() interface{} {
	return r.value
}

type testBoolRef struct {
	value bool
}

func (r *testBoolRef) ToValue() interface{} {
	return r.value
}

type testObjectRef struct {
	value map[string]interface{}
}

func (r *testObjectRef) ToValue() interface{} {
	return r.value
}
