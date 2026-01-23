package workflow

// ForkArgs is an alias for ForkTaskConfig (Pulumi-style args pattern).
type ForkArgs = ForkTaskConfig

// Fork creates a FORK task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Fork("parallel", &workflow.ForkArgs{
//	    Branches: []map[string]interface{}{
//	        {
//	            "name": "branchA",
//	            "tasks": []interface{}{...},
//	        },
//	        {
//	            "name": "branchB",
//	            "tasks": []interface{}{...},
//	        },
//	    },
//	})
func Fork(name string, args *ForkArgs) *Task {
	if args == nil {
		args = &ForkArgs{}
	}

	// Initialize slices if nil
	if args.Branches == nil {
		args.Branches = []map[string]interface{}{}
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindFork,
		Config: args,
	}
}

// BranchDef represents a branch definition for parallel execution.
type BranchDef struct {
	Name string
	Task *Task
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

// Branch returns a reference to a specific branch's result.
//
// Example:
//
//	forkTask.Branch("fetchUsers").Field("data")
func (t *Task) Branch(branchName string) BranchResult {
	return NewBranchResult(t.Name, branchName)
}
