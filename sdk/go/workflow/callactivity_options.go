package workflow

// CallActivityOption is a functional option for configuring a CALL_ACTIVITY task.
type CallActivityOption func(*CallActivityTaskConfig)

// CallActivity creates a CALL_ACTIVITY task with functional options.
//
// Example:
//
//	task := workflow.CallActivity("processData",
//	    workflow.Activity("dataProcessor"),
//	    workflow.ActivityInput(map[string]interface{}{"data": "${.input}"}),
//	)
func CallActivity(name string, opts ...CallActivityOption) *Task {
	config := &CallActivityTaskConfig{
		Input: make(map[string]interface{}),
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindCallActivity,
		Config: config,
	}
}

// Activity sets the activity name.
func Activity(activity string) CallActivityOption {
	return func(c *CallActivityTaskConfig) {
		c.Activity = activity
	}
}

// ActivityInput sets the activity input.
func ActivityInput(input map[string]interface{}) CallActivityOption {
	return func(c *CallActivityTaskConfig) {
		c.Input = input
	}
}
