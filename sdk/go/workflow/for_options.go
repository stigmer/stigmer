package workflow

// ForOption is a functional option for configuring a FOR task.
type ForOption func(*ForTaskConfig)

// For creates a FOR task with functional options.
//
// Example:
//
//	task := workflow.For("processItems",
//	    workflow.IterateOver("${.items}"),
//	    workflow.DoTasks([]map[string]interface{}{
//	        {"set": map[string]interface{}{"current": "${.item}"}},
//	        {"httpCall": map[string]interface{}{"uri": "${.api}/process"}},
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
func IterateOver(expr string) ForOption {
	return func(c *ForTaskConfig) {
		c.In = expr
	}
}

// DoTasks sets the tasks to execute for each item.
func DoTasks(tasks []map[string]interface{}) ForOption {
	return func(c *ForTaskConfig) {
		c.Do = tasks
	}
}
