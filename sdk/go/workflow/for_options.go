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
