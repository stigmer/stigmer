package workflow

// ListenOption is a functional option for configuring a LISTEN task.
type ListenOption func(*ListenTaskConfig)

// Listen creates a LISTEN task with functional options.
//
// Example:
//
//	task := workflow.Listen("waitForEvent", workflow.Event("user.created"))
func Listen(name string, opts ...ListenOption) *Task {
	config := &ListenTaskConfig{}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindListen,
		Config: config,
	}
}

// Event sets the event name to listen for.
func Event(event string) ListenOption {
	return func(c *ListenTaskConfig) {
		c.Event = event
	}
}
