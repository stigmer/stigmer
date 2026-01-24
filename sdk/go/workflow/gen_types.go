// gen_types.go provides type aliases for generated task configs from gen/workflow.
// This allows hand-written code to reference generated types without direct imports.

package workflow

import (
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
