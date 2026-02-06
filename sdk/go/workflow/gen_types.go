// gen_types.go provides type aliases for generated task configs from gen/workflow
// and shared types from gen/types.
// This allows hand-written code to reference generated types without direct imports.

package workflow

import (
	genTypes "github.com/stigmer/stigmer/sdk/go/gen/types"
	genWorkflow "github.com/stigmer/stigmer/sdk/go/gen/workflow"
)

// Type aliases for generated task configs
type (
	AgentCallTaskConfig    = genWorkflow.AgentCallTaskConfig
	CallActivityTaskConfig = genWorkflow.CallActivityTaskConfig
	ForkTaskConfig         = genWorkflow.ForkTaskConfig
	ForTaskConfig          = genWorkflow.ForTaskConfig
	GrpcCallTaskConfig     = genWorkflow.GrpcCallTaskConfig
	HttpCallTaskConfig     = genWorkflow.HttpCallTaskConfig
	ListenTaskConfig       = genWorkflow.ListenTaskConfig
	RaiseTaskConfig        = genWorkflow.RaiseTaskConfig
	RunTaskConfig          = genWorkflow.RunTaskConfig
	SetTaskConfig          = genWorkflow.SetTaskConfig
	SwitchTaskConfig       = genWorkflow.SwitchTaskConfig
	TryTaskConfig          = genWorkflow.TryTaskConfig
	WaitTaskConfig         = genWorkflow.WaitTaskConfig
)

// Type aliases for workflow task types (from gen/types)
// These types are used by task configs for nested structures
// Note: ForkBranch is not aliased here because there's a helper function with that name in fork_helpers.go
type (
	AgentExecutionConfig    = genTypes.AgentExecutionConfig
	CatchBlock              = genTypes.CatchBlock
	ContextManagementConfig = genTypes.ContextManagementConfig
	Export                  = genTypes.Export
	FlowControl             = genTypes.FlowControl
	HttpEndpoint            = genTypes.HttpEndpoint
	ListenTo                = genTypes.ListenTo
	SignalSpec              = genTypes.SignalSpec
	SwitchCase              = genTypes.SwitchCase
	WorkflowTask            = genTypes.WorkflowTask
)
