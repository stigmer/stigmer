package workflow

// ForkOption is a functional option for configuring a FORK task.
type ForkOption func(*ForkTaskConfig)

// Fork creates a FORK task with functional options.
//
// Example:
//
//	task := workflow.Fork("parallel",
//	    workflow.Branch(map[string]interface{}{
//	        "name": "branchA",
//	        "tasks": []interface{}{...},
//	    }),
//	    workflow.Branch(map[string]interface{}{
//	        "name": "branchB",
//	        "tasks": []interface{}{...},
//	    }),
//	)
func Fork(name string, opts ...ForkOption) *Task {
	config := &ForkTaskConfig{
		Branches: []map[string]interface{}{},
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindFork,
		Config: config,
	}
}

// Branch adds a parallel branch to execute.
func Branch(branchData map[string]interface{}) ForkOption {
	return func(c *ForkTaskConfig) {
		c.Branches = append(c.Branches, branchData)
	}
}
