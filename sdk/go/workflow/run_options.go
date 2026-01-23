package workflow

// RunArgs is an alias for RunTaskConfig (Pulumi-style args pattern).
type RunArgs = RunTaskConfig

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
