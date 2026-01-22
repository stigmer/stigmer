package workflow

// WaitOption is a functional option for configuring a WAIT task.
type WaitOption func(*WaitTaskConfig)

// Wait creates a WAIT task with functional options.
//
// Example:
//
//	task := workflow.Wait("pause", workflow.Duration("5s"))
func Wait(name string, opts ...WaitOption) *Task {
	config := &WaitTaskConfig{}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindWait,
		Config: config,
	}
}

// Duration sets the wait duration (e.g., "5s", "1m", "1h", "1d").
func Duration(duration string) WaitOption {
	return func(c *WaitTaskConfig) {
		c.Duration = duration
	}
}
