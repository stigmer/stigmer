//go:build e2e
// +build e2e

package e2e

// Agent test constants - matches SDK example 01_basic_agent.go
const (
	// Agent names from SDK example (source of truth)
	BasicAgentName = "code-reviewer"     // Basic agent with required fields only
	FullAgentName  = "code-reviewer-pro" // Full agent with optional fields
	InvalidAgentName = "Invalid Name!"   // Invalid agent name (validation error example)

	// Test fixture paths
	BasicAgentTestDataDir = "testdata/examples/01-basic-agent"

	// Expected values from SDK example
	BasicAgentCount = 2 // SDK creates 2 valid agents (code-reviewer, code-reviewer-pro)

	// Agent instance naming pattern
	BasicAgentDefaultInstanceName = "code-reviewer-default"
	FullAgentDefaultInstanceName  = "code-reviewer-pro-default"

	// Full agent optional fields (from SDK example)
	FullAgentDescription = "Professional code reviewer with security focus"
	FullAgentIconURL     = "https://example.com/icons/code-reviewer.png"

	// Test messages
	BasicAgentTestMessage = "Hello, test agent!"
	FullAgentTestMessage  = "Hello, this is testing the full agent!"

	// Execution timeouts
	AgentExecutionTimeoutSeconds = 60
)
