package workflow

// RaiseArgs is an alias for RaiseTaskConfig (Pulumi-style args pattern).
type RaiseArgs = RaiseTaskConfig

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
