package workflow

// AgentCallTaskConfig represents configuration for calling an agent.
//
// This config maps to the AgentCallTaskConfig proto message and defines
// how a workflow task invokes a Stigmer agent.
//
// Example:
//
//	config := &AgentCallTaskConfig{
//	    Agent:   workflow.AgentBySlug("code-reviewer"),
//	    Message: "Review this PR: ${.input.prUrl}",
//	    Env: map[string]string{
//	        "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
//	    },
//	}
type AgentCallTaskConfig struct {
	// Agent reference (slug or AgentRef)
	Agent AgentRef

	// Message/instructions to the agent
	// Supports workflow variable interpolation (e.g., "${.input.data}")
	Message string

	// Environment variables (supports expressions)
	// Example: {"GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}"}
	Env map[string]string

	// Optional execution configuration
	Config *AgentExecutionConfig
}

// AgentExecutionConfig controls agent execution parameters.
//
// All fields are optional. If not provided, the agent's default
// configuration will be used.
type AgentExecutionConfig struct {
	// Model is the LLM model override (e.g., "claude-3-5-sonnet")
	Model string

	// Timeout in seconds (1-3600)
	// Default is typically 300 seconds (5 minutes)
	Timeout int32

	// Temperature controls randomness (0.0-1.0)
	// Lower = more deterministic, Higher = more creative
	// Default is typically 0.7
	Temperature float32
}

// Implement TaskConfig interface
func (AgentCallTaskConfig) isTaskConfig() {}

// ============================================================================
// Task Builder
// ============================================================================

// AgentCallTask creates a new agent call task.
//
// This is the low-level task builder. For workflow-level convenience,
// use wf.CallAgent() instead.
//
// Example:
//
//	task := workflow.AgentCallTask(
//	    "review",
//	    workflow.AgentOption(workflow.AgentBySlug("code-reviewer")),
//	    workflow.Message("Review this code: ${.input.code}"),
//	    workflow.WithEnv(map[string]string{
//	        "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
//	    }),
//	)
func AgentCallTask(name string, opts ...AgentCallOption) *Task {
	config := &AgentCallTaskConfig{
		Env: make(map[string]string),
	}

	// Apply options
	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindAgentCall,
		Config: config,
	}
}

// ============================================================================
// Functional Options
// ============================================================================

// AgentCallOption is a functional option for agent call tasks.
type AgentCallOption func(*AgentCallTaskConfig)

// AgentOption sets the agent reference.
//
// Example:
//
//	// By instance
//	workflow.AgentOption(workflow.Agent(myAgent))
//
//	// By slug
//	workflow.AgentOption(workflow.AgentBySlug("code-reviewer"))
func AgentOption(agent AgentRef) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		c.Agent = agent
	}
}

// Message sets the agent instructions/message.
//
// The message supports workflow variable interpolation:
//   - ${.input.fieldName} - Input variables
//   - ${.secrets.secretName} - Secrets
//   - ${.context.taskName.field} - Task outputs
//
// Example:
//
//	workflow.Message("Review PR at: ${.input.prUrl}")
func Message(msg string) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		c.Message = msg
	}
}

// WithEnv adds environment variables to the agent execution.
//
// Environment variables support workflow variable interpolation.
// This allows passing secrets and dynamic values to the agent.
//
// Example:
//
//	workflow.WithEnv(map[string]string{
//	    "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
//	    "PR_NUMBER":    "${.input.prNumber}",
//	})
func WithEnv(env map[string]string) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		for k, v := range env {
			c.Env[k] = v
		}
	}
}

// AgentModel sets the LLM model override for agent execution.
//
// This overrides the agent's default model for this specific invocation.
//
// Example:
//
//	workflow.AgentModel("claude-3-5-sonnet")
func AgentModel(model string) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		if c.Config == nil {
			c.Config = &AgentExecutionConfig{}
		}
		c.Config.Model = model
	}
}

// AgentTimeout sets the agent execution timeout in seconds.
//
// Valid range: 1-3600 seconds (1 second to 1 hour)
//
// Example:
//
//	workflow.AgentTimeout(600) // 10 minutes
func AgentTimeout(seconds int32) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		if c.Config == nil {
			c.Config = &AgentExecutionConfig{}
		}
		c.Config.Timeout = seconds
	}
}

// AgentTemperature sets the LLM temperature for agent execution.
//
// Valid range: 0.0-1.0
//   - Lower values (0.0-0.3) = More deterministic, focused
//   - Medium values (0.4-0.7) = Balanced
//   - Higher values (0.8-1.0) = More creative, random
//
// Example:
//
//	workflow.AgentTemperature(0.2) // Very deterministic
func AgentTemperature(temp float32) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		if c.Config == nil {
			c.Config = &AgentExecutionConfig{}
		}
		c.Config.Temperature = temp
	}
}
