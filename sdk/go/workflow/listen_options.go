package workflow

// ListenArgs is an alias for ListenTaskConfig (Pulumi-style args pattern).
type ListenArgs = ListenTaskConfig

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
