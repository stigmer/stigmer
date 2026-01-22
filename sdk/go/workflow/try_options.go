package workflow

// TryOption is a functional option for configuring a TRY task.
type TryOption func(*TryTaskConfig)

// Try creates a TRY task with functional options.
//
// Example:
//
//	task := workflow.Try("handleErrors",
//	    workflow.TryTasks([]map[string]interface{}{
//	        {"httpCall": map[string]interface{}{"uri": "${.api}/data"}},
//	    }),
//	    workflow.Catch(map[string]interface{}{
//	        "errors": []string{"NetworkError"},
//	        "as": "error",
//	        "tasks": []interface{}{...},
//	    }),
//	)
func Try(name string, opts ...TryOption) *Task {
	config := &TryTaskConfig{
		Tasks: []map[string]interface{}{},
		Catch: []map[string]interface{}{},
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindTry,
		Config: config,
	}
}

// WithTry sets the tasks to try (alias for TryTasks).
func WithTry(tasks ...*Task) TryOption {
	// Convert tasks to map format for now
	// TODO: Improve this when we have proper task serialization
	taskMaps := make([]map[string]interface{}, len(tasks))
	for i, task := range tasks {
		taskMaps[i] = map[string]interface{}{
			"name": task.Name,
			"kind": string(task.Kind),
		}
	}
	return func(c *TryTaskConfig) {
		c.Tasks = taskMaps
	}
}

// TryTasks sets the tasks to try.
func TryTasks(tasks []map[string]interface{}) TryOption {
	return func(c *TryTaskConfig) {
		c.Tasks = tasks
	}
}

// WithCatch adds an error handler with typed error matching.
func WithCatch(errorTypes []string, as string, tasks ...*Task) TryOption {
	// Convert tasks to map format
	taskMaps := make([]interface{}, len(tasks))
	for i, task := range tasks {
		taskMaps[i] = map[string]interface{}{
			"name": task.Name,
			"kind": string(task.Kind),
		}
	}

	catchData := map[string]interface{}{
		"errors": errorTypes,
		"as":     as,
		"tasks":  taskMaps,
	}

	return func(c *TryTaskConfig) {
		c.Catch = append(c.Catch, catchData)
	}
}

// Catch adds an error handler.
func Catch(catchData map[string]interface{}) TryOption {
	return func(c *TryTaskConfig) {
		c.Catch = append(c.Catch, catchData)
	}
}
