package workflow

// SetArgs is an alias for SetTaskConfig (Pulumi-style args pattern).
type SetArgs = SetTaskConfig

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
