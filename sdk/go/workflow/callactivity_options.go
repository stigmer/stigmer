package workflow

// CallActivityArgs is an alias for CallActivityTaskConfig (Pulumi-style args pattern).
type CallActivityArgs = CallActivityTaskConfig

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
