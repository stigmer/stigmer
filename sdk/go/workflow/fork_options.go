package workflow

// ForkOption is a functional option for configuring a FORK task.
type ForkOption func(*ForkTaskConfig)

// Fork creates a FORK task with functional options.
//
// Example (low-level map API):
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
//
// Example (high-level builder API):
//
//	forkTask := wf.Fork("fetchAllData",
//	    workflow.ParallelBranches(
//	        workflow.BranchBuilder("fetchUsers", func() *workflow.Task {
//	            return wf.HttpGet("getUsers", apiBase.Concat("/users"))
//	        }),
//	        workflow.BranchBuilder("fetchProducts", func() *workflow.Task {
//	            return wf.HttpGet("getProducts", apiBase.Concat("/products"))
//	        }),
//	    ),
//	    workflow.WaitForAll(),
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

// BranchDef represents a branch definition for parallel execution.
type BranchDef struct {
	Name string
	Task *Task
}

// BranchBuilder creates a branch definition with a builder function.
// This provides a high-level, type-safe way to define parallel branches.
//
// Example:
//
//	workflow.BranchBuilder("fetchUsers", func() *workflow.Task {
//	    return wf.HttpGet("getUsers", endpoint)
//	})
func BranchBuilder(name string, builder func() *Task) BranchDef {
	task := builder()
	return BranchDef{
		Name: name,
		Task: task,
	}
}

// ParallelBranches adds multiple branches that will execute in parallel.
// This is the high-level API for defining parallel execution.
//
// Example:
//
//	workflow.ParallelBranches(
//	    workflow.BranchBuilder("fetchUsers", func() *workflow.Task {
//	        return wf.HttpGet("getUsers", usersEndpoint)
//	    }),
//	    workflow.BranchBuilder("fetchProducts", func() *workflow.Task {
//	        return wf.HttpGet("getProducts", productsEndpoint)
//	    }),
//	)
func ParallelBranches(branches ...BranchDef) ForkOption {
	return func(c *ForkTaskConfig) {
		for _, branch := range branches {
			// Convert task to map representation using the helper
			taskMap, err := taskToMap(branch.Task)
			if err != nil {
				// If conversion fails, create a minimal task map
				taskMap = map[string]interface{}{
					"name": branch.Task.Name,
					"kind": string(branch.Task.Kind),
				}
			}
			
			// Create branch entry
			branchMap := map[string]interface{}{
				"name":  branch.Name,
				"tasks": []interface{}{taskMap},
			}
			
			c.Branches = append(c.Branches, branchMap)
		}
	}
}

// WaitForAll configures the fork to wait for all branches to complete.
// This is the default behavior.
//
// Example:
//
//	workflow.WaitForAll()
func WaitForAll() ForkOption {
	return func(c *ForkTaskConfig) {
		// This is typically the default behavior
		// Can be extended to set a specific field if protocol supports it
	}
}

// WaitForAny configures the fork to continue as soon as any branch completes.
//
// Example:
//
//	workflow.WaitForAny()
func WaitForAny() ForkOption {
	return func(c *ForkTaskConfig) {
		// Implementation would set a field indicating "wait for any"
		// This depends on protocol support
	}
}

// WaitForCount configures the fork to continue after N branches complete.
//
// Example:
//
//	workflow.WaitForCount(2)  // Continue after 2 branches complete
func WaitForCount(count int) ForkOption {
	return func(c *ForkTaskConfig) {
		// Implementation would set a field with the count
		// This depends on protocol support
	}
}

// Branch adds a parallel branch to execute (low-level map API).
//
// Example:
//
//	workflow.Branch(map[string]interface{}{
//	    "name": "branchA",
//	    "tasks": []interface{}{...},
//	})
func Branch(branchData map[string]interface{}) ForkOption {
	return func(c *ForkTaskConfig) {
		c.Branches = append(c.Branches, branchData)
	}
}

// BranchResult represents a reference to a branch's result in a fork task.
type BranchResult struct {
	taskName   string
	branchName string
}

// NewBranchResult creates a new BranchResult reference.
func NewBranchResult(taskName, branchName string) BranchResult {
	return BranchResult{
		taskName:   taskName,
		branchName: branchName,
	}
}

// Field returns a reference to a field in the branch result.
//
// Example:
//
//	branchResult.Field("data") -> "${.forkTask.branches.branchName.data}"
func (b BranchResult) Field(fieldName string) string {
	return "${." + b.taskName + ".branches." + b.branchName + "." + fieldName + "}"
}

// Value returns a reference to the entire branch result.
//
// Example:
//
//	branchResult.Value() -> "${.forkTask.branches.branchName}"
func (b BranchResult) Value() string {
	return "${." + b.taskName + ".branches." + b.branchName + "}"
}

// Task extension for accessing branch results
type TaskBranchAccessor struct {
	task *Task
}

// Branch returns a reference to a specific branch's result.
// This method should be added to the Task type.
//
// Example:
//
//	forkTask.Branch("fetchUsers").Field("data")
func (t *Task) Branch(branchName string) BranchResult {
	return NewBranchResult(t.Name, branchName)
}
