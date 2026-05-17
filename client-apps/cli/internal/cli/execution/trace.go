package execution

import (
	"fmt"

	"github.com/pkg/errors"
	stigmer "github.com/stigmer/stigmer/sdk/go"
)

// TraceOptions contains options for the trace command.
type TraceOptions struct {
	ExecutionID  string
	OutputFormat string
	Client       *stigmer.Client
}

// Trace fetches an execution and renders its task structure as a tree.
func Trace(opts *TraceOptions) error {
	execType, err := ResolveType(opts.ExecutionID)
	if err != nil {
		return err
	}

	switch execType {
	case ExecutionTypeWorkflow:
		return traceWorkflowExecution(opts)
	case ExecutionTypeAgent:
		return traceAgentExecution(opts)
	default:
		return fmt.Errorf("unsupported execution type for trace")
	}
}

func traceWorkflowExecution(opts *TraceOptions) error {
	exec, err := GetWorkflowExecution(opts.Client, opts.ExecutionID)
	if err != nil {
		return errors.Wrap(err, "failed to fetch workflow execution for trace")
	}

	if opts.OutputFormat == "yaml" || opts.OutputFormat == "json" {
		DisplayWorkflowExecutionGetResult(exec, opts.OutputFormat)
		return nil
	}

	renderWorkflowTrace(exec)
	return nil
}

func traceAgentExecution(opts *TraceOptions) error {
	exec, err := GetFromBackend(opts.Client, opts.ExecutionID)
	if err != nil {
		return errors.Wrap(err, "failed to fetch agent execution for trace")
	}

	if opts.OutputFormat == "yaml" || opts.OutputFormat == "json" {
		DisplayGetResult(exec, opts.OutputFormat)
		return nil
	}

	renderAgentTrace(exec)
	return nil
}
