package workflow

// WaitArgs is an alias for WaitTaskConfig (Pulumi-style args pattern).
type WaitArgs = WaitTaskConfig

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
