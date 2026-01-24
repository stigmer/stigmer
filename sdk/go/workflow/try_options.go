package workflow

import (
	"github.com/stigmer/stigmer/sdk/go/gen/types"
)

// TryArgs is an alias for TryTaskConfig (Pulumi-style args pattern).
type TryArgs = TryTaskConfig

// Try creates a TRY task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.Try("handleErrors", &workflow.TryArgs{
//	    Try: []*types.WorkflowTask{
//	        {Name: "httpCall", Kind: "HTTP_CALL"},
//	    },
//	    Catch: &types.CatchBlock{
//	        As: "error",
//	        Do: []*types.WorkflowTask{
//	            {Name: "logError", Kind: "SET"},
//	        },
//	    },
//	})
func Try(name string, args *TryArgs) *Task {
	if args == nil {
		args = &TryArgs{}
	}

	// Initialize slices if nil
	if args.Try == nil {
		args.Try = []*types.WorkflowTask{}
	}
	// Catch is optional and can be nil

	return &Task{
		Name:   name,
		Kind:   TaskKindTry,
		Config: args,
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
