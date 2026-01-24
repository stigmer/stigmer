package workflow

// AgentCallArgs is an alias for AgentCallTaskConfig (Pulumi-style args pattern).
type AgentCallArgs = AgentCallTaskConfig

// AgentCall creates an AGENT_CALL task using struct-based args.
// This follows the Pulumi Args pattern for resource configuration.
//
// Example:
//
//	task := workflow.AgentCall("review", &workflow.AgentCallArgs{
//	    Agent:   "code-reviewer",
//	    Message: "Review this PR: ${.input.prUrl}",
//	    Env: map[string]string{
//	        "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
//	    },
//	    Config: &types.AgentExecutionConfig{
//	        Model: "claude-3-5-sonnet",
//	    },
//	})
func AgentCall(name string, args *AgentCallArgs) *Task {
	if args == nil {
		args = &AgentCallArgs{}
	}

	// Initialize maps if nil
	if args.Env == nil {
		args.Env = make(map[string]string)
	}
	// Config is optional and can be nil

	return &Task{
		Name:   name,
		Kind:   TaskKindAgentCall,
		Config: args,
	}
}

