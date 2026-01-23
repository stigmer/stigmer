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
//	    Data:    map[string]interface{}{"field": "email"},
//	})
func Raise(name string, args *RaiseArgs) *Task {
	if args == nil {
		args = &RaiseArgs{}
	}

	// Initialize maps if nil
	if args.Data == nil {
		args.Data = make(map[string]interface{})
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindRaise,
		Config: args,
	}
}
