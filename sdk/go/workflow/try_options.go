package workflow

// TryOption is a functional option for configuring a TRY task.
type TryOption func(*TryTaskConfig)

// Try creates a TRY task with functional options.
//
// Example (low-level map API):
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
//
// Example (high-level builder API):
//
//	tryTask := wf.Try("attemptAPICall",
//	    workflow.TryBlock(func() *workflow.Task {
//	        return wf.HttpGet("callAPI", endpoint)
//	    }),
//	    workflow.CatchBlock(func(err workflow.ErrorRef) *workflow.Task {
//	        return wf.Set("handleError",
//	            workflow.SetVar("error", err.Message()),
//	        )
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

// ErrorRef represents an error that was caught in a try/catch block.
// It provides methods to access error information.
type ErrorRef struct {
	// varName is the variable name for the error
	varName string
}

// NewErrorRef creates a new ErrorRef with the given variable name.
func NewErrorRef(varName string) ErrorRef {
	if varName == "" {
		varName = "error"
	}
	return ErrorRef{varName: varName}
}

// Message returns a reference to the error message.
//
// Example:
//
//	err.Message() -> "${.error.message}"
func (e ErrorRef) Message() string {
	return "${." + e.varName + ".message}"
}

// Type returns a reference to the error type.
//
// Example:
//
//	err.Type() -> "${.error.type}"
func (e ErrorRef) Type() string {
	return "${." + e.varName + ".type}"
}

// Timestamp returns a reference to when the error occurred.
//
// Example:
//
//	err.Timestamp() -> "${.error.timestamp}"
func (e ErrorRef) Timestamp() string {
	return "${." + e.varName + ".timestamp}"
}

// StackTrace returns a reference to the error stack trace.
//
// Example:
//
//	err.StackTrace() -> "${.error.stackTrace}"
func (e ErrorRef) StackTrace() string {
	return "${." + e.varName + ".stackTrace}"
}

// Field returns a reference to a custom field in the error.
//
// Example:
//
//	err.Field("statusCode") -> "${.error.statusCode}"
func (e ErrorRef) Field(fieldName string) string {
	return "${." + e.varName + "." + fieldName + "}"
}

// TryBlock sets the main task to try using a builder function.
// This provides a high-level, type-safe way to define the try block.
//
// Example:
//
//	workflow.TryBlock(func() *workflow.Task {
//	    return wf.HttpGet("callAPI", endpoint, workflow.Timeout(30))
//	})
func TryBlock(builder func() *Task) TryOption {
	return func(c *TryTaskConfig) {
		// Call the builder to get the task
		task := builder()
		
		// Convert task to map representation
		taskMap := map[string]interface{}{
			"name": task.Name,
			"kind": string(task.Kind),
		}
		
		// Add config if present
		if task.Config != nil {
			taskMap["config"] = task.Config
		}
		
		c.Tasks = []map[string]interface{}{taskMap}
	}
}

// CatchBlock adds an error handler using a builder function.
// The builder receives an ErrorRef that can be used to access error information.
//
// Example:
//
//	workflow.CatchBlock(func(err workflow.ErrorRef) *workflow.Task {
//	    return wf.Set("handleError",
//	        workflow.SetVar("errorMsg", err.Message()),
//	        workflow.SetVar("errorType", err.Type()),
//	    )
//	})
func CatchBlock(builder func(err ErrorRef) *Task) TryOption {
	return func(c *TryTaskConfig) {
		// Create an ErrorRef
		errRef := NewErrorRef("error")
		
		// Call the builder to get the error handling task
		task := builder(errRef)
		
		// Convert task to map representation
		taskMap := map[string]interface{}{
			"name": task.Name,
			"kind": string(task.Kind),
		}
		
		// Add config if present
		if task.Config != nil {
			taskMap["config"] = task.Config
		}
		
		// Create catch entry
		catchEntry := map[string]interface{}{
			"as":    "error",
			"tasks": []interface{}{taskMap},
		}
		
		c.Catch = append(c.Catch, catchEntry)
	}
}

// CatchErrors adds an error handler for specific error types.
//
// Example:
//
//	workflow.CatchErrors([]string{"NetworkError", "TimeoutError"}, "netErr", func(err workflow.ErrorRef) *workflow.Task {
//	    return wf.Set("handleNetworkError",
//	        workflow.SetVar("error", err.Message()),
//	    )
//	})
func CatchErrors(errorTypes []string, as string, builder func(err ErrorRef) *Task) TryOption {
	return func(c *TryTaskConfig) {
		// Create an ErrorRef
		errRef := NewErrorRef(as)
		
		// Call the builder to get the error handling task
		task := builder(errRef)
		
		// Convert task to map representation
		taskMap := map[string]interface{}{
			"name": task.Name,
			"kind": string(task.Kind),
		}
		
		// Add config if present
		if task.Config != nil {
			taskMap["config"] = task.Config
		}
		
		// Create catch entry
		catchEntry := map[string]interface{}{
			"errors": errorTypes,
			"as":     as,
			"tasks":  []interface{}{taskMap},
		}
		
		c.Catch = append(c.Catch, catchEntry)
	}
}

// FinallyBlock adds a finally block that always executes (cleanup).
// Note: This is implemented as a special catch-all handler.
//
// Example:
//
//	workflow.FinallyBlock(func() *workflow.Task {
//	    return wf.Set("cleanup",
//	        workflow.SetVar("status", "attempted"),
//	    )
//	})
func FinallyBlock(builder func() *Task) TryOption {
	return func(c *TryTaskConfig) {
		// Call the builder to get the cleanup task
		task := builder()
		
		// Convert task to map representation
		taskMap := map[string]interface{}{
			"name": task.Name,
			"kind": string(task.Kind),
		}
		
		// Add config if present
		if task.Config != nil {
			taskMap["config"] = task.Config
		}
		
		// Add as a catch-all handler (executes regardless of error)
		// Note: This is a simplified implementation
		// Real implementation might need protocol-level support
		finallyEntry := map[string]interface{}{
			"finally": true,
			"tasks":   []interface{}{taskMap},
		}
		
		c.Catch = append(c.Catch, finallyEntry)
	}
}

// WithTry sets the tasks to try (alias for TryTasks).
func WithTry(tasks ...*Task) TryOption {
	// Convert tasks to map format for now
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

// TryTasks sets the tasks to try (low-level API).
func TryTasks(tasks []map[string]interface{}) TryOption {
	return func(c *TryTaskConfig) {
		c.Tasks = tasks
	}
}

// WithCatch adds an error handler with typed error matching (low-level API).
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

// Catch adds an error handler (low-level map API).
func Catch(catchData map[string]interface{}) TryOption {
	return func(c *TryTaskConfig) {
		c.Catch = append(c.Catch, catchData)
	}
}
