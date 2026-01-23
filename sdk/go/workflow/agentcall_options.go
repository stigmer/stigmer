package workflow

// AgentCallOption is a functional option for configuring an AGENT_CALL task.
type AgentCallOption func(*AgentCallTaskConfig)

// AgentCall creates an AGENT_CALL task with functional options.
// This is the high-level API that wraps the generated AgentCallTask constructor.
//
// Example:
//
//	task := workflow.AgentCall("review",
//	    workflow.AgentBySlug("code-reviewer"),
//	    workflow.Message("Review this PR: ${.input.prUrl}"),
//	    workflow.WithAgentEnv(map[string]string{
//	        "GITHUB_TOKEN": "${.secrets.GITHUB_TOKEN}",
//	    }),
//	)
func AgentCall(name string, opts ...AgentCallOption) *Task {
	config := &AgentCallTaskConfig{
		Env:    make(map[string]string),
		Config: make(map[string]interface{}),
	}

	// Apply all options
	for _, opt := range opts {
		opt(config)
	}

	return &Task{
		Name:   name,
		Kind:   TaskKindAgentCall,
		Config: config,
	}
}

// AgentOption sets the agent to call using an AgentRef.
//
// Example:
//
//	workflow.AgentOption(workflow.AgentBySlug("code-reviewer"))
//	workflow.AgentOption(workflow.Agent(myAgent))
func AgentOption(ref AgentRef) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		c.Agent = ref.Slug()
	}
}

// AgentSlug sets the agent to call by its slug directly (string).
//
// Example:
//
//	workflow.AgentSlug("code-reviewer")
//	workflow.AgentSlug("${.agents.myAgent}")
func AgentSlug(slug interface{}) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		c.Agent = coerceToString(slug)
	}
}

// Message sets the message/instructions to send to the agent.
//
// Example:
//
//	workflow.Message("Review this code and suggest improvements")
//	workflow.Message("Analyze: ${.input.text}")
func Message(message interface{}) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		c.Message = coerceToString(message)
	}
}

// WithAgentEnv adds an environment variable for the agent execution.
//
// Example:
//
//	workflow.WithAgentEnv(map[string]string{
//	    "API_KEY": "${.secrets.API_KEY}",
//	    "MODEL": "gpt-4",
//	})
func WithAgentEnv(env map[string]string) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		for key, value := range env {
			c.Env[key] = value
		}
	}
}

// AgentEnvVar adds a single environment variable for the agent execution.
//
// Example:
//
//	workflow.AgentEnvVar("API_KEY", "${.secrets.API_KEY}")
//	workflow.AgentEnvVar("MODEL", "gpt-4")
func AgentEnvVar(key, value string) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		c.Env[key] = value
	}
}

// AgentConfig sets optional execution configuration for the agent.
//
// Common config options:
//   - model: AI model to use
//   - timeout: Execution timeout
//   - temperature: AI temperature setting
//   - max_tokens: Maximum tokens to generate
//
// Example:
//
//	workflow.AgentConfig(map[string]interface{}{
//	    "model": "gpt-4",
//	    "timeout": 300,
//	    "temperature": 0.7,
//	})
func AgentConfig(config map[string]interface{}) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		for key, value := range config {
			c.Config[key] = value
		}
	}
}

// AgentConfigValue sets a single configuration value.
//
// Example:
//
//	workflow.AgentConfigValue("model", "gpt-4")
//	workflow.AgentConfigValue("temperature", 0.7)
func AgentConfigValue(key string, value interface{}) AgentCallOption {
	return func(c *AgentCallTaskConfig) {
		c.Config[key] = value
	}
}

// Model is a convenience helper for setting the AI model.
//
// Example:
//
//	workflow.Model("gpt-4")
//	workflow.Model("claude-opus")
func Model(model string) AgentCallOption {
	return AgentConfigValue("model", model)
}

// Temperature is a convenience helper for setting AI temperature.
//
// Example:
//
//	workflow.Temperature(0.7)
func Temperature(temp float64) AgentCallOption {
	return AgentConfigValue("temperature", temp)
}

// MaxTokens is a convenience helper for setting max tokens.
//
// Example:
//
//	workflow.MaxTokens(2000)
func MaxTokens(tokens int) AgentCallOption {
	return AgentConfigValue("max_tokens", tokens)
}

// AgentTimeout sets the execution timeout for the agent call (in seconds).
//
// Example:
//
//	workflow.AgentTimeout(300)  // 5 minutes
//	workflow.AgentTimeout(600)  // 10 minutes
func AgentTimeout(seconds int) AgentCallOption {
	return AgentConfigValue("timeout", seconds)
}

// WithEnv is an alias for WithAgentEnv for more concise API.
//
// Example:
//
//	workflow.WithEnv(map[string]string{
//	    "API_KEY": workflow.RuntimeSecret("API_KEY"),
//	    "MODEL": "gpt-4",
//	})
func WithEnv(env map[string]string) AgentCallOption {
	return WithAgentEnv(env)
}
