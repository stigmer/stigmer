package workflow

import (
	"fmt"

	"google.golang.org/protobuf/types/known/structpb"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/environment"
)

// ToProto converts the SDK Workflow to a platform Workflow proto message.
//
// This method creates a complete Workflow proto with:
//   - API version and kind
//   - Metadata with SDK annotations
//   - Spec converted from SDK workflow to proto WorkflowSpec
//
// Example:
//
//	wf, _ := workflow.New(ctx,
//	    workflow.WithNamespace("data-processing"),
//	    workflow.WithName("daily-sync"),
//	    workflow.WithVersion("1.0.0"),
//	)
//	proto, err := wf.ToProto()
func (w *Workflow) ToProto() (*workflowv1.Workflow, error) {
	// Convert environment variables
	envSpec, err := convertEnvironmentVariables(w.EnvironmentVariables)
	if err != nil {
		return nil, fmt.Errorf("failed to convert environment variables: %w", err)
	}

	// Convert tasks
	tasks, err := convertTasks(w.Tasks)
	if err != nil {
		return nil, fmt.Errorf("failed to convert tasks: %w", err)
	}

	// Build metadata
	metadata := &apiresource.ApiResourceMetadata{
		Name:        w.Document.Name,
		Slug:        w.Slug, // Include slug for backend resolution
		Annotations: SDKAnnotations(),
	}

	// Build WorkflowDocument
	document := &workflowv1.WorkflowDocument{
		Dsl:         w.Document.DSL,
		Namespace:   w.Document.Namespace,
		Name:        w.Document.Name,
		Version:     w.Document.Version,
		Description: w.Document.Description,
	}

	// Build complete Workflow proto
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   metadata,
		Spec: &workflowv1.WorkflowSpec{
			Description: w.Description,
			Document:    document,
			Tasks:       tasks,
			EnvSpec:     envSpec,
		},
	}, nil
}

// convertEnvironmentVariables converts SDK environment variables to proto EnvironmentSpec.
func convertEnvironmentVariables(envVars []environment.Variable) (*environmentv1.EnvironmentSpec, error) {
	if len(envVars) == 0 {
		return nil, nil
	}

	data := make(map[string]*environmentv1.EnvironmentValue)

	for _, v := range envVars {
		data[v.Name] = &environmentv1.EnvironmentValue{
			Value:       v.DefaultValue,
			IsSecret:    v.IsSecret,
			Description: v.Description,
		}
	}

	return &environmentv1.EnvironmentSpec{
		Data: data,
	}, nil
}

// convertTasks converts SDK tasks to proto WorkflowTask messages.
func convertTasks(tasks []*Task) ([]*workflowv1.WorkflowTask, error) {
	if len(tasks) == 0 {
		return nil, nil
	}

	protoTasks := make([]*workflowv1.WorkflowTask, 0, len(tasks))

	for _, task := range tasks {
		protoTask, err := convertTask(task)
		if err != nil {
			return nil, fmt.Errorf("failed to convert task %s: %w", task.Name, err)
		}
		protoTasks = append(protoTasks, protoTask)
	}

	return protoTasks, nil
}

// convertTask converts a single SDK Task to a proto WorkflowTask.
func convertTask(task *Task) (*workflowv1.WorkflowTask, error) {
	// Convert task kind to proto enum
	kind, err := convertTaskKind(task.Kind)
	if err != nil {
		return nil, fmt.Errorf("invalid task kind %s: %w", task.Kind, err)
	}

	// Convert task config to google.protobuf.Struct
	taskConfig, err := convertTaskConfig(task.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to convert task config: %w", err)
	}

	// Build proto task
	protoTask := &workflowv1.WorkflowTask{
		Name:       task.Name,
		Kind:       kind,
		TaskConfig: taskConfig,
	}

	// Add export if set
	if task.ExportAs != "" {
		protoTask.Export = &workflowv1.Export{
			As: task.ExportAs,
		}
	}

	// Add flow control if set
	if task.ThenTask != "" {
		protoTask.Flow = &workflowv1.FlowControl{
			Then: task.ThenTask,
		}
	}

	return protoTask, nil
}

// convertTaskKind converts SDK TaskKind to proto WorkflowTaskKind enum.
func convertTaskKind(kind TaskKind) (apiresource.WorkflowTaskKind, error) {
	switch kind {
	case TaskKindSet:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_SET, nil
	case TaskKindHttpCall:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL, nil
	case TaskKindGrpcCall:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_GRPC_CALL, nil
	case TaskKindSwitch:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH, nil
	case TaskKindFor:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_FOR, nil
	case TaskKindFork:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_FORK, nil
	case TaskKindTry:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_TRY, nil
	case TaskKindListen:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_LISTEN, nil
	case TaskKindWait:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_WAIT, nil
	case TaskKindCallActivity:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_CALL_ACTIVITY, nil
	case TaskKindRaise:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_RAISE, nil
	case TaskKindRun:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_RUN, nil
	case TaskKindAgentCall:
		return apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL, nil
	default:
		return 0, fmt.Errorf("unknown task kind: %s", kind)
	}
}

// convertTaskConfig converts SDK TaskConfig to google.protobuf.Struct.
//
// The SDK task configs are Go structs that need to be converted to the dynamic
// protobuf Struct format for storage in the proto message.
func convertTaskConfig(config TaskConfig) (*structpb.Struct, error) {
	if config == nil {
		return nil, fmt.Errorf("task config cannot be nil")
	}

	// Convert the config struct to a map for structpb conversion
	configMap, err := taskConfigToMap(config)
	if err != nil {
		return nil, fmt.Errorf("failed to convert config to map: %w", err)
	}

	// Convert map to protobuf Struct
	protoStruct, err := structpb.NewStruct(configMap)
	if err != nil {
		return nil, fmt.Errorf("failed to create protobuf struct: %w", err)
	}

	return protoStruct, nil
}

// taskConfigToMap converts a TaskConfig to a map[string]interface{}.
//
// This handles all the different task config types and extracts their fields
// into a map that can be converted to protobuf Struct.
func taskConfigToMap(config TaskConfig) (map[string]interface{}, error) {
	switch c := config.(type) {
	case *SetTaskConfig:
		return setTaskConfigToMap(c), nil
	case *HttpCallTaskConfig:
		return httpCallTaskConfigToMap(c), nil
	case *GrpcCallTaskConfig:
		return grpcCallTaskConfigToMap(c), nil
	case *AgentCallTaskConfig:
		return agentCallTaskConfigToMap(c), nil
	case *WaitTaskConfig:
		return waitTaskConfigToMap(c), nil
	case *ListenTaskConfig:
		return listenTaskConfigToMap(c), nil
	case *CallActivityTaskConfig:
		return callActivityTaskConfigToMap(c), nil
	case *RaiseTaskConfig:
		return raiseTaskConfigToMap(c), nil
	case *RunTaskConfig:
		return runTaskConfigToMap(c), nil
	case *SwitchTaskConfig:
		return switchTaskConfigToMap(c), nil
	case *ForTaskConfig:
		return forTaskConfigToMap(c), nil
	case *ForkTaskConfig:
		return forkTaskConfigToMap(c), nil
	case *TryTaskConfig:
		return tryTaskConfigToMap(c), nil
	default:
		return nil, fmt.Errorf("unsupported task config type: %T", config)
	}
}

// setTaskConfigToMap converts SetTaskConfig to map.
func setTaskConfigToMap(c *SetTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Variables != nil && len(c.Variables) > 0 {
		// Convert map[string]string to map[string]interface{} for structpb compatibility
		vars := make(map[string]interface{})
		for k, v := range c.Variables {
			vars[k] = v
		}
		m["variables"] = vars
	}
	return m
}

// httpCallTaskConfigToMap converts HttpCallTaskConfig to map.
func httpCallTaskConfigToMap(c *HttpCallTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	
	if c.Method != "" {
		m["method"] = c.Method
	}
	
	// Build endpoint struct
	if c.URI != "" {
		endpoint := map[string]interface{}{
			"uri": c.URI,
		}
		m["endpoint"] = endpoint
	}
	
	if c.Headers != nil && len(c.Headers) > 0 {
		// Convert map[string]string to map[string]interface{}
		headers := make(map[string]interface{})
		for k, v := range c.Headers {
			headers[k] = v
		}
		m["headers"] = headers
	}
	
	if c.Body != nil && len(c.Body) > 0 {
		m["body"] = c.Body
	}
	
	if c.TimeoutSeconds > 0 {
		m["timeout_seconds"] = c.TimeoutSeconds
	}
	
	return m
}

// grpcCallTaskConfigToMap converts GrpcCallTaskConfig to map.
func grpcCallTaskConfigToMap(c *GrpcCallTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	
	if c.Service != "" {
		m["service"] = c.Service
	}
	
	if c.Method != "" {
		m["method"] = c.Method
	}
	
	if c.Body != nil && len(c.Body) > 0 {
		m["body"] = c.Body
	}
	
	return m
}

// agentCallTaskConfigToMap converts AgentCallTaskConfig to map.
func agentCallTaskConfigToMap(c *AgentCallTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	
	if c.Agent != "" {
		m["agent"] = c.Agent
	}
	
	if c.Message != "" {
		m["message"] = c.Message
	}
	
	if c.Env != nil && len(c.Env) > 0 {
		// Convert map[string]string to map[string]interface{}
		env := make(map[string]interface{})
		for k, v := range c.Env {
			env[k] = v
		}
		m["env"] = env
	}
	
	if c.Config != nil && len(c.Config) > 0 {
		m["config"] = c.Config
	}
	
	return m
}

// waitTaskConfigToMap converts WaitTaskConfig to map.
func waitTaskConfigToMap(c *WaitTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Duration != "" {
		m["duration"] = c.Duration
	}
	return m
}

// listenTaskConfigToMap converts ListenTaskConfig to map.
func listenTaskConfigToMap(c *ListenTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Event != "" {
		m["event"] = c.Event
	}
	return m
}

// callActivityTaskConfigToMap converts CallActivityTaskConfig to map.
func callActivityTaskConfigToMap(c *CallActivityTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Activity != "" {
		m["activity"] = c.Activity
	}
	if c.Input != nil && len(c.Input) > 0 {
		m["input"] = c.Input
	}
	return m
}

// raiseTaskConfigToMap converts RaiseTaskConfig to map.
func raiseTaskConfigToMap(c *RaiseTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Error != "" {
		m["error"] = c.Error
	}
	return m
}

// runTaskConfigToMap converts RunTaskConfig to map.
func runTaskConfigToMap(c *RunTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.WorkflowName != "" {
		m["workflow_name"] = c.WorkflowName
	}
	if c.Input != nil && len(c.Input) > 0 {
		m["input"] = c.Input
	}
	return m
}

// switchTaskConfigToMap converts SwitchTaskConfig to map.
func switchTaskConfigToMap(c *SwitchTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Cases != nil && len(c.Cases) > 0 {
		// Convert array of maps to []interface{} for structpb
		cases := make([]interface{}, len(c.Cases))
		for i, caseMap := range c.Cases {
			cases[i] = caseMap
		}
		m["cases"] = cases
	}
	if c.DefaultTask != "" {
		m["default_task"] = c.DefaultTask
	}
	return m
}

// forTaskConfigToMap converts ForTaskConfig to map.
func forTaskConfigToMap(c *ForTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.In != "" {
		m["in"] = c.In
	}
	if c.Do != nil && len(c.Do) > 0 {
		// Convert array of maps to []interface{} for structpb
		do := make([]interface{}, len(c.Do))
		for i, doMap := range c.Do {
			do[i] = doMap
		}
		m["do"] = do
	}
	return m
}

// forkTaskConfigToMap converts ForkTaskConfig to map.
func forkTaskConfigToMap(c *ForkTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Branches != nil && len(c.Branches) > 0 {
		// Convert array of maps to []interface{} for structpb
		branches := make([]interface{}, len(c.Branches))
		for i, branch := range c.Branches {
			branches[i] = branch
		}
		m["branches"] = branches
	}
	return m
}

// tryTaskConfigToMap converts TryTaskConfig to map.
func tryTaskConfigToMap(c *TryTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Tasks != nil && len(c.Tasks) > 0 {
		// Convert array of maps to []interface{} for structpb
		tasks := make([]interface{}, len(c.Tasks))
		for i, task := range c.Tasks {
			tasks[i] = task
		}
		m["tasks"] = tasks
	}
	if c.Catch != nil && len(c.Catch) > 0 {
		// Convert array of maps to []interface{} for structpb
		catch := make([]interface{}, len(c.Catch))
		for i, catchMap := range c.Catch {
			catch[i] = catchMap
		}
		m["catch"] = catch
	}
	return m
}
