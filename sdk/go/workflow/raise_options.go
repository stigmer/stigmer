package workflow

// RaiseOption is a functional option for configuring a RAISE task.
type RaiseOption func(*RaiseTaskConfig)

// Raise creates a RAISE task with functional options.
//
// Example:
//
//	task := workflow.Raise("throwError",
//	    workflow.ErrorType("ValidationError"),
//	    workflow.ErrorMessage("Invalid input"),
//	    workflow.ErrorData(map[string]interface{}{"field": "email"}),
//	)
func Raise(name string, opts ...RaiseOption) *Task {
	config := &RaiseTaskConfig{
		Data: make(map[string]interface{}),
	}

	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindRaise,
		Config: config,
	}
}

// ErrorType sets the error type/name.
func ErrorType(errorType string) RaiseOption {
	return func(c *RaiseTaskConfig) {
		c.Error = errorType
	}
}

// ErrorMessage sets the error message.
func ErrorMessage(message string) RaiseOption {
	return func(c *RaiseTaskConfig) {
		c.Message = message
	}
}

// ErrorData sets additional error data.
func ErrorData(data map[string]interface{}) RaiseOption {
	return func(c *RaiseTaskConfig) {
		c.Data = data
	}
}
