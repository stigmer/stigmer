package workflow

// SwitchOption is a functional option for configuring a SWITCH task.
type SwitchOption func(*SwitchTaskConfig)

// Switch creates a SWITCH task with functional options.
//
// Example:
//
//	task := workflow.Switch("routeByType",
//	    workflow.Case(map[string]interface{}{
//	        "condition": "${.type == 'A'}",
//	        "then": "handleA",
//	    }),
//	    workflow.Case(map[string]interface{}{
//	        "condition": "${.type == 'B'}",
//	        "then": "handleB",
//	    }),
//	    workflow.DefaultCase("handleDefault"),
//	)
func Switch(name string, opts ...SwitchOption) *Task {
	config := &SwitchTaskConfig{
		Cases: []map[string]interface{}{},
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindSwitch,
		Config: config,
	}
}

// Case adds a conditional case to the switch.
func Case(caseData map[string]interface{}) SwitchOption {
	return func(c *SwitchTaskConfig) {
		c.Cases = append(c.Cases, caseData)
	}
}

// DefaultCase sets the default task if no cases match.
func DefaultCase(taskName string) SwitchOption {
	return func(c *SwitchTaskConfig) {
		c.DefaultTask = taskName
	}
}
