package workflow

import (
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// TryBody converts SDK tasks to types.WorkflowTask format for use in TRY blocks.
// This enables type-safe task definitions within Try/Catch constructs.
//
// Example:
//
//	wf.Try("attemptAPICall", &workflow.TryArgs{
//	    Try: workflow.TryBody(
//	        wf.HttpGet("fetchData", "https://api.example.com/data", nil),
//	    ),
//	    Catch: workflow.CatchBody("error",
//	        wf.Set("handleError", &workflow.SetArgs{...}),
//	    ),
//	})
func TryBody(tasks ...*Task) []*types.WorkflowTask {
	workflowTasks := make([]*types.WorkflowTask, 0, len(tasks))
	for _, task := range tasks {
		taskMap, err := taskToMap(task)
		if err != nil {
			panic(err)
		}
		
		wfTask := &types.WorkflowTask{
			Name:       task.Name,
			Kind:       string(task.Kind),
			TaskConfig: taskMap["config"].(map[string]interface{}),
		}
		
		// Extract export if present
		if exportMap, ok := taskMap["export"].(map[string]interface{}); ok {
			if asStr, ok := exportMap["as"].(string); ok {
				wfTask.Export = &types.Export{As: asStr}
			}
		}
		
		workflowTasks = append(workflowTasks, wfTask)
	}
	return workflowTasks
}

// CatchBody creates a catch block for error handling in TRY tasks.
// The errorVar parameter specifies the variable name to store the caught error.
//
// Example:
//
//	Catch: workflow.CatchBody("error",
//	    wf.Set("logError", &workflow.SetArgs{
//	        Variables: map[string]string{
//	            "message": "${.error.message}",
//	        },
//	    }),
//	)
func CatchBody(errorVar string, tasks ...*Task) *types.CatchBlock {
	return &types.CatchBlock{
		As: errorVar,
		Do: TryBody(tasks...),
	}
}
