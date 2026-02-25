package workflow

import (
	"fmt"

	"buf.build/go/protovalidate"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/sdk/go/gen/types"
	"github.com/stigmer/stigmer/sdk/go/metadata"
)

// validator is the global protovalidate validator instance.
var validator protovalidate.Validator

func init() {
	// Initialize validator once at package load time
	var err error
	validator, err = protovalidate.New()
	if err != nil {
		panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
	}
}

// ToProto converts the SDK Workflow to a platform Workflow proto message.
//
// This method delegates directly to Args fields - no conversion needed since:
//   - Args.Document is already *workflowv1.WorkflowDocument
//   - Args.Tasks is already []*workflowv1.WorkflowTask (converted in AddTask)
//   - Args.EnvSpec is already *environmentv1.EnvironmentSpec
//
// Example:
//
//	wf, _ := workflow.New(ctx, "data-processing/daily-sync", &workflow.WorkflowArgs{
//	    Description: "Sync data daily",
//	})
//	wf.HttpGet("fetch", "https://api.example.com", nil)
//	proto, err := wf.ToProto()
func (w *Workflow) ToProto() (*workflowv1.Workflow, error) {
	// Nil-safety check
	if w.Args == nil {
		return nil, fmt.Errorf("workflow: Args is nil, cannot convert to proto")
	}

	// Build metadata with SDK annotations
	meta := &apiresource.ApiResourceMetadata{
		Name:        w.Name,
		Slug:        w.Slug,
		Annotations: metadata.SDKAnnotations(),
		Visibility:  apiresource.ApiResourceVisibility_visibility_private,
	}

	// Build complete Workflow proto - pure delegation to Args
	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata:   meta,
		Spec: &workflowv1.WorkflowSpec{
			Description: w.Args.Description,
			Document:    w.Args.Document, // Direct use - already proto type
			Tasks:       w.Args.Tasks,    // Direct use - already proto types
			EnvSpec:     w.Args.EnvSpec,  // Direct use - populated via RequireSecret/Config
		},
	}

	// Validate the proto message against buf.validate rules
	if err := validator.Validate(workflow); err != nil {
		return nil, fmt.Errorf("workflow validation failed: %w", err)
	}

	return workflow, nil
}

// validateTaskConfigStruct validates a task config by unmarshaling it back to typed proto.
// This enables buf.validate rules on the typed proto messages to be applied.
func validateTaskConfigStruct(kind workflowv1.WorkflowTaskKind, config *structpb.Struct) error {
	if config == nil {
		return fmt.Errorf("task_config cannot be nil")
	}

	// Convert Struct to JSON bytes
	jsonBytes, err := config.MarshalJSON()
	if err != nil {
		return fmt.Errorf("failed to marshal Struct to JSON: %w", err)
	}

	// Create appropriate proto message based on kind
	var protoMsg proto.Message

	switch kind {
	case workflowv1.WorkflowTaskKind_set_vars:
		protoMsg = &tasksv1.SetTaskConfig{}
	case workflowv1.WorkflowTaskKind_http_call:
		protoMsg = &tasksv1.HttpCallTaskConfig{}
	case workflowv1.WorkflowTaskKind_grpc_call:
		protoMsg = &tasksv1.GrpcCallTaskConfig{}
	case workflowv1.WorkflowTaskKind_switch_case:
		protoMsg = &tasksv1.SwitchTaskConfig{}
	case workflowv1.WorkflowTaskKind_for_each:
		protoMsg = &tasksv1.ForTaskConfig{}
	case workflowv1.WorkflowTaskKind_fork:
		protoMsg = &tasksv1.ForkTaskConfig{}
	case workflowv1.WorkflowTaskKind_try_catch:
		protoMsg = &tasksv1.TryTaskConfig{}
	case workflowv1.WorkflowTaskKind_listen:
		protoMsg = &tasksv1.ListenTaskConfig{}
	case workflowv1.WorkflowTaskKind_wait:
		protoMsg = &tasksv1.WaitTaskConfig{}
	case workflowv1.WorkflowTaskKind_activity_call:
		protoMsg = &tasksv1.CallActivityTaskConfig{}
	case workflowv1.WorkflowTaskKind_raise_error:
		protoMsg = &tasksv1.RaiseTaskConfig{}
	case workflowv1.WorkflowTaskKind_run_workflow:
		protoMsg = &tasksv1.RunTaskConfig{}
	case workflowv1.WorkflowTaskKind_agent_call:
		protoMsg = &tasksv1.AgentCallTaskConfig{}
	default:
		return fmt.Errorf("unsupported task kind: %v", kind)
	}

	// Unmarshal JSON to proto message
	err = protojson.Unmarshal(jsonBytes, protoMsg)
	if err != nil {
		return fmt.Errorf("failed to unmarshal JSON to proto: %w", err)
	}

	// Validate the unmarshaled proto message
	if err := validator.Validate(protoMsg); err != nil {
		return fmt.Errorf("task config validation failed: %w", err)
	}

	return nil
}

// convertTask converts a single SDK Task to a proto WorkflowTask.
func convertTask(task *Task) (*workflowv1.WorkflowTask, error) {
	// TaskKind is now the proto enum type directly - no conversion needed
	kind := task.Kind

	// Validate task kind is not unspecified
	if kind == workflowv1.WorkflowTaskKind_workflow_task_kind_unspecified {
		return nil, fmt.Errorf("task kind cannot be unspecified for task %s", task.Name)
	}

	// Convert task config to google.protobuf.Struct
	taskConfig, err := convertTaskConfig(task.Config)
	if err != nil {
		return nil, fmt.Errorf("failed to convert task config: %w", err)
	}

	// Validate task config by unmarshaling to typed proto and running buf.validate rules
	if err := validateTaskConfigStruct(kind, taskConfig); err != nil {
		return nil, err
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

// NOTE: convertTaskKind function removed - TaskKind is now the proto enum type directly.
// No conversion needed since SDK uses workflowv1.WorkflowTaskKind as the source of truth.

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

// normalizeMapForProto normalizes a map[string]interface{} for protobuf compatibility.
// This handles converting typed slices (like []map[string]any) to []interface{}.
func normalizeMapForProto(m map[string]interface{}) map[string]interface{} {
	if m == nil {
		return nil
	}

	result := make(map[string]interface{})
	for k, v := range m {
		result[k] = normalizeValueForProto(v)
	}
	return result
}

// normalizeValueForProto normalizes a value for protobuf compatibility.
func normalizeValueForProto(v interface{}) interface{} {
	// Check if it's a Ref type (TaskFieldRef, StringRef, etc.)
	// These need to be converted to their expression string
	if ref, ok := v.(Ref); ok {
		return ref.Expression()
	}

	switch val := v.(type) {
	case map[string]interface{}:
		return normalizeMapForProto(val)
	case []map[string]interface{}:
		// Convert []map[string]interface{} (same as []map[string]any) to []interface{}
		result := make([]interface{}, len(val))
		for i, item := range val {
			result[i] = normalizeMapForProto(item)
		}
		return result
	case []interface{}:
		// Recursively normalize array elements
		result := make([]interface{}, len(val))
		for i, item := range val {
			result[i] = normalizeValueForProto(item)
		}
		return result
	default:
		return v
	}
}

// taskToMap converts a Task to a map[string]interface{} for nested task serialization.
// This is used by builders like WithLoopBody, TryBlock, etc. that need to serialize tasks.
func taskToMap(task *Task) (map[string]interface{}, error) {
	m := map[string]interface{}{
		"name": task.Name,
		"kind": task.Kind.String(),
	}

	// Convert config if present
	if task.Config != nil {
		configMap, err := taskConfigToMap(task.Config)
		if err != nil {
			return nil, fmt.Errorf("failed to convert task config: %w", err)
		}
		m["config"] = configMap
	}

	// Add export if set
	if task.ExportAs != "" {
		m["export"] = map[string]interface{}{
			"as": task.ExportAs,
		}
	}

	// Add flow control if set
	if task.ThenTask != "" {
		m["then"] = task.ThenTask
	}

	return m, nil
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
	if c.Endpoint != nil && c.Endpoint.Uri != nil {
		uriStr := CoerceToString(c.Endpoint.Uri)
		if uriStr != "" {
			endpoint := map[string]interface{}{
				"uri": uriStr,
			}
			m["endpoint"] = endpoint
		}
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
		m["body"] = normalizeMapForProto(c.Body)
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

	if c.Request != nil && len(c.Request) > 0 {
		m["request"] = normalizeMapForProto(c.Request)
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

	if c.Config != nil {
		// Config is *types.AgentExecutionConfig, convert to map
		configMap := make(map[string]interface{})
		if c.Config.Model != "" {
			configMap["model"] = c.Config.Model
		}
		if c.Config.Timeout > 0 {
			configMap["timeout"] = c.Config.Timeout
		}
		if c.Config.Temperature > 0 {
			configMap["temperature"] = c.Config.Temperature
		}
		if len(configMap) > 0 {
			m["config"] = configMap
		}
	}

	return m
}

// waitTaskConfigToMap converts WaitTaskConfig to map.
// The proto WaitTaskConfig uses a oneof wait_type with a nested Duration message,
// so we must produce {"duration": {"seconds": N}} rather than a flat {"seconds": N}.
func waitTaskConfigToMap(c *WaitTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Seconds > 0 {
		m["duration"] = map[string]interface{}{
			"seconds": c.Seconds,
		}
	}
	return m
}

// listenTaskConfigToMap converts ListenTaskConfig to map.
func listenTaskConfigToMap(c *ListenTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.To != nil {
		// Convert ListenTo to map
		toMap := make(map[string]interface{})
		if c.To.Mode != "" {
			toMap["mode"] = c.To.Mode
		}
		if c.To.Signals != nil && len(c.To.Signals) > 0 {
			signals := make([]interface{}, len(c.To.Signals))
			for i, sig := range c.To.Signals {
				sigMap := make(map[string]interface{})
				if sig.Id != "" {
					sigMap["id"] = sig.Id
				}
				if sig.Type != "" {
					sigMap["type"] = sig.Type
				}
				signals[i] = sigMap
			}
			toMap["signals"] = signals
		}
		m["to"] = toMap
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
	if c.Workflow != "" {
		m["workflow"] = c.Workflow
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
		// Convert []*types.SwitchCase to []interface{} for structpb
		cases := make([]interface{}, len(c.Cases))
		for i, switchCase := range c.Cases {
			caseMap := make(map[string]interface{})
			if switchCase.Name != "" {
				caseMap["name"] = switchCase.Name
			}
			if switchCase.When != "" {
				caseMap["when"] = switchCase.When
			}
			if switchCase.Then != "" {
				caseMap["then"] = switchCase.Then
			}
			cases[i] = caseMap
		}
		m["cases"] = cases
	}
	return m
}

// workflowTaskToMap converts types.WorkflowTask to map[string]interface{}.
func workflowTaskToMap(task *types.WorkflowTask) map[string]interface{} {
	m := make(map[string]interface{})
	if task.Name != "" {
		m["name"] = task.Name
	}
	if task.Kind != "" {
		// Convert SDK TaskKind string to proto enum constant name
		// e.g., "set_vars" -> "set_vars" (direct mapping with new naming)
		m["kind"] = convertTaskKindStringToProtoEnumName(task.Kind)
	}
	if task.TaskConfig != nil && len(task.TaskConfig) > 0 {
		m["taskConfig"] = task.TaskConfig
	}
	if task.Export != nil && task.Export.As != "" {
		m["export"] = map[string]interface{}{
			"as": task.Export.As,
		}
	}
	if task.Flow != nil && task.Flow.Then != "" {
		m["flow"] = map[string]interface{}{
			"then": task.Flow.Then,
		}
	}
	return m
}

// convertTaskKindStringToProtoEnumName converts SDK TaskKind string to proto enum constant name.
// With the new DDD-aligned naming, the SDK TaskKind values match the proto enum values directly.
// Example: "set_vars" -> "set_vars"
func convertTaskKindStringToProtoEnumName(kind string) string {
	// The SDK TaskKind values now match the proto enum values directly
	return kind
}

// forkBranchToMap converts types.ForkBranch to map[string]interface{}.
func forkBranchToMap(branch *types.ForkBranch) map[string]interface{} {
	m := make(map[string]interface{})
	if branch.Name != "" {
		m["name"] = branch.Name
	}
	if branch.Do != nil && len(branch.Do) > 0 {
		do := make([]interface{}, len(branch.Do))
		for i, task := range branch.Do {
			do[i] = workflowTaskToMap(task)
		}
		m["do"] = do
	}
	return m
}

// forTaskConfigToMap converts ForTaskConfig to map.
func forTaskConfigToMap(c *ForTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Each != "" {
		m["each"] = c.Each
	}
	if c.In != nil {
		// Use CoerceToString to handle Task references, strings, and expressions
		inStr := CoerceToString(c.In)
		if inStr != "" {
			m["in"] = inStr
		}
	}
	if c.Do != nil && len(c.Do) > 0 {
		// Convert []*types.WorkflowTask to []interface{} for structpb
		do := make([]interface{}, len(c.Do))
		for i, task := range c.Do {
			do[i] = workflowTaskToMap(task)
		}
		m["do"] = do
	}
	return m
}

// forkTaskConfigToMap converts ForkTaskConfig to map.
func forkTaskConfigToMap(c *ForkTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Branches != nil && len(c.Branches) > 0 {
		// Convert []*types.ForkBranch to []interface{} for structpb
		branches := make([]interface{}, len(c.Branches))
		for i, branch := range c.Branches {
			branches[i] = forkBranchToMap(branch)
		}
		m["branches"] = branches
	}
	return m
}

// tryTaskConfigToMap converts TryTaskConfig to map.
func tryTaskConfigToMap(c *TryTaskConfig) map[string]interface{} {
	m := make(map[string]interface{})
	if c.Try != nil && len(c.Try) > 0 {
		// Convert []*types.WorkflowTask to []interface{} for structpb
		tryTasks := make([]interface{}, len(c.Try))
		for i, task := range c.Try {
			tryTasks[i] = workflowTaskToMap(task)
		}
		m["try"] = tryTasks
	}
	if c.Catch != nil {
		// Convert *types.CatchBlock to map
		catchMap := make(map[string]interface{})
		if c.Catch.As != "" {
			catchMap["as"] = c.Catch.As
		}
		if c.Catch.Do != nil && len(c.Catch.Do) > 0 {
			doTasks := make([]interface{}, len(c.Catch.Do))
			for i, task := range c.Catch.Do {
				doTasks[i] = workflowTaskToMap(task)
			}
			catchMap["do"] = doTasks
		}
		m["catch"] = catchMap
	}
	return m
}
