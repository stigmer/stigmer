package workflow

// RunOption is a functional option for configuring a RUN task.
type RunOption func(*RunTaskConfig)

// Run creates a RUN task with functional options.
//
// Example:
//
//	task := workflow.Run("subWorkflow",
//	    workflow.SubWorkflow("data-processor"),
//	    workflow.WorkflowInput(map[string]interface{}{"data": "${.input}"}),
//	)
func Run(name string, opts ...RunOption) *Task {
	config := &RunTaskConfig{
		Input: make(map[string]interface{}),
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindRun,
		Config: config,
	}
}

// SubWorkflow sets the sub-workflow name.
func SubWorkflow(workflowName string) RunOption {
	return func(c *RunTaskConfig) {
		c.WorkflowName = workflowName
	}
}

// WorkflowInput sets the sub-workflow input.
func WorkflowInput(input map[string]interface{}) RunOption {
	return func(c *RunTaskConfig) {
		c.Input = input
	}
}
