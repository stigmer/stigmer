package workflow

// ForOption is a functional option for configuring a FOR task.
type ForOption func(*ForTaskConfig)

// For creates a FOR task with functional options.
//
// Example (low-level map API):
//
//	task := workflow.For("processItems",
//	    workflow.IterateOver("${.items}"),
//	    workflow.DoTasks([]map[string]interface{}{
//	        {"set": map[string]interface{}{"current": "${.item}"}},
//	        {"httpCall": map[string]interface{}{"uri": "${.api}/process"}},
//	    }),
//	)
//
// Example (high-level builder API):
//
//	loopTask := wf.ForEach("processEachItem",
//	    workflow.IterateOver(fetchTask.Field("items")),
//	    workflow.WithLoopBody(func(item workflow.LoopVar) *workflow.Task {
//	        return wf.HttpPost("processItem",
//	            apiBase.Concat("/process"),
//	            workflow.Body(map[string]interface{}{
//	                "itemId": item.Field("id"),
//	                "data":   item.Field("data"),
//	            }),
//	        )
//	    }),
//	)
func For(name string, opts ...ForOption) *Task {
	config := &ForTaskConfig{
		Do: []map[string]interface{}{},
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindFor,
		Config: config,
	}
}

// IterateOver sets the collection expression to iterate over.
// Accepts TaskFieldRef, expression string, or any value that can be coerced to string.
//
// Example:
//
//	workflow.IterateOver(fetchTask.Field("items"))
//	workflow.IterateOver("${.items}")
//	workflow.IterateOver("[1, 2, 3]")
func IterateOver(expr interface{}) ForOption {
	return func(c *ForTaskConfig) {
		c.In = coerceToString(expr)
	}
}

// DoTasks sets the tasks to execute for each item (low-level API).
//
// Example:
//
//	workflow.DoTasks([]map[string]interface{}{
//	    {"httpCall": map[string]interface{}{"uri": "${.api}/process"}},
//	})
func DoTasks(tasks []map[string]interface{}) ForOption {
	return func(c *ForTaskConfig) {
		c.Do = tasks
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

// WithLoopBody sets the tasks to execute for each item using a builder function.
// This provides a high-level, type-safe way to define loop bodies.
//
// Note: This is a simplified implementation that captures the builder function result.
// For full support, this would require workflow context to be passed through.
//
// Example:
//
//	workflow.WithLoopBody(func(item workflow.LoopVar) *workflow.Task {
//	    return wf.HttpPost("processItem",
//	        workflow.Body(map[string]interface{}{
//	            "itemId": item.Field("id"),
//	        }),
//	    )
//	})
func WithLoopBody(builder func(item LoopVar) *Task) ForOption {
	return func(c *ForTaskConfig) {
		// Create a LoopVar instance
		item := LoopVar{varName: "item"}
		
		// Call the builder to get the task
		task := builder(item)
		
		// Convert task to map representation using the helper
		taskMap, err := taskToMap(task)
		if err != nil {
			// If conversion fails, create a minimal task map
			// This maintains backward compatibility
			taskMap = map[string]interface{}{
				"name": task.Name,
				"kind": string(task.Kind),
			}
		}
		
		c.Do = []map[string]interface{}{taskMap}
	}
}
