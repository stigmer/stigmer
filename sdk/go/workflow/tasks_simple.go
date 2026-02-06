// tasks_simple.go provides factory functions for simple workflow task types.
//
// This file consolidates task factories that have minimal configuration:
// SET, WAIT, LISTEN, RAISE, RUN, GRPC_CALL, CALL_ACTIVITY, AGENT_CALL.
//
// Each factory follows the Pulumi Args pattern with a type alias and
// constructor function.

package workflow

// =============================================================================
// Type Aliases (Pulumi-style Args pattern)
// =============================================================================

type (
	// SetArgs is an alias for SetTaskConfig.
	SetArgs = SetTaskConfig

	// WaitArgs is an alias for WaitTaskConfig.
	WaitArgs = WaitTaskConfig

	// ListenArgs is an alias for ListenTaskConfig.
	ListenArgs = ListenTaskConfig

	// RaiseArgs is an alias for RaiseTaskConfig.
	RaiseArgs = RaiseTaskConfig

	// RunArgs is an alias for RunTaskConfig.
	RunArgs = RunTaskConfig

	// GrpcCallArgs is an alias for GrpcCallTaskConfig.
	GrpcCallArgs = GrpcCallTaskConfig

	// CallActivityArgs is an alias for CallActivityTaskConfig.
	CallActivityArgs = CallActivityTaskConfig

	// AgentCallArgs is an alias for AgentCallTaskConfig.
	AgentCallArgs = AgentCallTaskConfig
)

// =============================================================================
// SET Task
// =============================================================================

// Set creates a SET task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Set("init", &workflow.SetArgs{
//	    Variables: map[string]string{
//	        "x": "1",
//	        "y": "${.input.value}",
//	        "computed": "${.a + .b}",
//	    },
//	})
func Set(name string, args *SetArgs) *Task {
	if args == nil {
		args = &SetArgs{}
	}

	// Initialize maps if nil
	if args.Variables == nil {
		args.Variables = make(map[string]string)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindSet,
		Config: args,
	}
}

// =============================================================================
// WAIT Task
// =============================================================================

// Wait creates a WAIT task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Wait("pause", &workflow.WaitArgs{
//	    Seconds: 5,
//	})
func Wait(name string, args *WaitArgs) *Task {
	if args == nil {
		args = &WaitArgs{}
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindWait,
		Config: args,
	}
}

// =============================================================================
// LISTEN Task
// =============================================================================

// Listen creates a LISTEN task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Listen("waitForEvent", &workflow.ListenArgs{
//	    Event: "user.created",
//	})
func Listen(name string, args *ListenArgs) *Task {
	if args == nil {
		args = &ListenArgs{}
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindListen,
		Config: args,
	}
}

// =============================================================================
// RAISE Task
// =============================================================================

// Raise creates a RAISE task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Raise("throwError", &workflow.RaiseArgs{
//	    Error:   "ValidationError",
//	    Message: "Invalid input",
//	})
func Raise(name string, args *RaiseArgs) *Task {
	if args == nil {
		args = &RaiseArgs{}
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindRaise,
		Config: args,
	}
}

// =============================================================================
// RUN Task
// =============================================================================

// Run creates a RUN task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Run("subWorkflow", &workflow.RunArgs{
//	    WorkflowName: "data-processor",
//	    Input:        map[string]interface{}{"data": "${.input}"},
//	})
func Run(name string, args *RunArgs) *Task {
	if args == nil {
		args = &RunArgs{}
	}

	// Initialize maps if nil
	if args.Input == nil {
		args.Input = make(map[string]interface{})
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindRun,
		Config: args,
	}
}

// =============================================================================
// GRPC_CALL Task
// =============================================================================

// GrpcCall creates a GRPC_CALL task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.GrpcCall("callService", &workflow.GrpcCallArgs{
//	    Service: "userservice",
//	    Method:  "GetUser",
//	    Request: map[string]interface{}{"id": "123"},
//	})
func GrpcCall(name string, args *GrpcCallArgs) *Task {
	if args == nil {
		args = &GrpcCallArgs{}
	}

	// Initialize maps if nil
	if args.Request == nil {
		args.Request = make(map[string]interface{})
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindGrpcCall,
		Config: args,
	}
}

// =============================================================================
// CALL_ACTIVITY Task
// =============================================================================

// CallActivity creates a CALL_ACTIVITY task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.CallActivity("processData", &workflow.CallActivityArgs{
//	    Activity: "dataProcessor",
//	    Input:    map[string]interface{}{"data": "${.input}"},
//	})
func CallActivity(name string, args *CallActivityArgs) *Task {
	if args == nil {
		args = &CallActivityArgs{}
	}

	// Initialize maps if nil
	if args.Input == nil {
		args.Input = make(map[string]interface{})
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindCallActivity,
		Config: args,
	}
}

// =============================================================================
// AGENT_CALL Task
// =============================================================================

// AgentCall creates an AGENT_CALL task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.AgentCall("review", &workflow.AgentCallArgs{
//	    Agent:   "code-reviewer",
//	    Message: "Review this PR: ${.input.prUrl}",
//	    Env: map[string]string{
//	        "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
//	    },
//	    Config: &types.AgentExecutionConfig{
//	        Model: "claude-3-5-sonnet",
//	    },
//	})
func AgentCall(name string, args *AgentCallArgs) *Task {
	if args == nil {
		args = &AgentCallArgs{}
	}

	// Initialize maps if nil
	if args.Env == nil {
		args.Env = make(map[string]string)
	}
	// Config is optional and can be nil

	return &Task{
		Name:   name,
		Kind:   TaskKindAgentCall,
		Config: args,
	}
}
