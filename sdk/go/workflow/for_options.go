package workflow

import (
	"github.com/stigmer/stigmer/sdk/go/types"
)

// ForArgs is an alias for ForTaskConfig (Pulumi-style args pattern).
type ForArgs = ForTaskConfig

// For creates a FOR task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.For("processItems", &workflow.ForArgs{
//	    Each: "item",
//	    In: "${.items}",
//	    Do: []*types.WorkflowTask{
//	        {Name: "process", Kind: "HTTP_CALL"},
//	    },
//	})
func For(name string, args *ForArgs) *Task {
	if args == nil {
		args = &ForArgs{}
	}

	// Initialize slices if nil
	if args.Do == nil {
		args.Do = []*types.WorkflowTask{}
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindFor,
		Config: args,
	}
}

// LoopVar represents a loop variable that can be used in loop body.
// It provides a way to reference fields of the current iteration item.
type LoopVar struct {
	// varName is the implicit variable name for the current item
	varName string
}

// Field returns a reference to a field of the current loop item.
//
// Example:
//
//	item.Field("id") -> "${.item.id}"
//	item.Field("name") -> "${.item.name}"
func (v LoopVar) Field(fieldName string) string {
	if v.varName == "" {
		return "${.item." + fieldName + "}"
	}
	return "${." + v.varName + "." + fieldName + "}"
}

// Value returns a reference to the current item itself.
//
// Example:
//
//	item.Value() -> "${.item}"
func (v LoopVar) Value() string {
	if v.varName == "" {
		return "${.item}"
	}
	return "${." + v.varName + "}"
}

// LoopBody creates a typed loop body using a closure that receives the loop variable.
// This provides type-safe access to the current item without magic strings.
//
// The function creates a LoopVar representing the current iteration item (default: "item")
// and passes it to your closure. You build tasks using this LoopVar for field references.
//
// Example:
//
//	wf.ForEach("processItems", &workflow.ForArgs{
//	    In: fetchTask.Field("items"),
//	    Do: workflow.LoopBody(func(item workflow.LoopVar) []*workflow.Task {
//	        return []*workflow.Task{
//	            wf.HttpPost("processItem",
//	                apiBase.Concat("/process").Expression(),
//	                map[string]interface{}{
//	                    "itemId": item.Field("id"),      // ✅ Type-safe reference!
//	                    "data":   item.Field("data"),    // ✅ No magic strings!
//	                },
//	            ),
//	        }
//	    }),
//	})
//
// This replaces the old pattern:
//
//	Do: []map[string]interface{}{
//	    {
//	        "httpCall": map[string]interface{}{
//	            "body": map[string]interface{}{
//	                "itemId": "${.item.id}",  // ❌ Magic string!
//	            },
//	        },
//	    },
//	}
//
// Custom variable names (via Each field):
//
//	wf.ForEach("processUsers", &workflow.ForArgs{
//	    Each: "user",  // Custom variable name
//	    In: fetchTask.Field("users"),
//	    Do: workflow.LoopBody(func(user workflow.LoopVar) []*workflow.Task {
//	        return []*workflow.Task{
//	            wf.Set("processUser", &workflow.SetArgs{
//	                Variables: map[string]string{
//	                    "userId": user.Field("id"),  // References ${.user.id}
//	                },
//	            }),
//	        }
//	    }),
//	})
func LoopBody(fn func(LoopVar) []*Task) []*types.WorkflowTask {
	// Create default loop variable (will use "item" unless Each field overrides)
	loopVar := LoopVar{varName: "item"}

	// Call user's function to get typed tasks
	tasks := fn(loopVar)

	// Convert SDK tasks to types.WorkflowTask format
	workflowTasks := make([]*types.WorkflowTask, 0, len(tasks))
	for _, task := range tasks {
		taskMap, err := taskToMap(task)
		if err != nil {
			// In production code, we might want to handle this differently
			// For now, we'll panic to surface the error during development
			panic(err)
		}

		// Convert map to types.WorkflowTask
		wfTask := &types.WorkflowTask{
			Name: task.Name,
			Kind: string(task.Kind),
		}

		// Extract task config from the map
		if config, ok := taskMap["config"].(map[string]interface{}); ok {
			wfTask.TaskConfig = config
		}

		// Extract export if present
		if exportMap, ok := taskMap["export"].(map[string]interface{}); ok {
			if asVal, ok := exportMap["as"].(string); ok {
				wfTask.Export = &types.Export{As: asVal}
			}
		}

		// Extract flow control if present
		if thenVal, ok := taskMap["then"].(string); ok {
			wfTask.Flow = &types.FlowControl{Then: thenVal}
		}

		workflowTasks = append(workflowTasks, wfTask)
	}

	return workflowTasks
}
