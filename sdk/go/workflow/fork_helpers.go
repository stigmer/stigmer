package workflow

import (
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// ForkBranch creates a single fork branch with a name and tasks to execute in parallel.
// Use with ForkBranches to build the branches array for Fork tasks.
//
// Example:
//
//	wf.Fork("parallelTasks", &workflow.ForkArgs{
//	    Branches: workflow.ForkBranches(
//	        workflow.ForkBranch("branch1",
//	            wf.HttpGet("fetch1", "https://api.example.com/endpoint1", nil),
//	        ),
//	        workflow.ForkBranch("branch2",
//	            wf.HttpGet("fetch2", "https://api.example.com/endpoint2", nil),
//	        ),
//	    ),
//	})
func ForkBranch(name string, tasks ...*Task) *types.ForkBranch {
	return &types.ForkBranch{
		Name: name,
		Do:   TryBody(tasks...), // Reuse TryBody for task conversion
	}
}

// ForkBranches combines multiple fork branches into a slice.
// This is a convenience function to build the Branches field for ForkArgs.
//
// Example:
//
//	Branches: workflow.ForkBranches(
//	    workflow.ForkBranch("fetchUsers", ...),
//	    workflow.ForkBranch("fetchPosts", ...),
//	)
func ForkBranches(branches ...*types.ForkBranch) []*types.ForkBranch {
	return branches
}
