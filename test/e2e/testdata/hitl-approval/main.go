//go:build ignore

package main

import (
	"log"

	"github.com/stigmer/stigmer/sdk/go/agent"
	"github.com/stigmer/stigmer/sdk/go/mcpserver"
	"github.com/stigmer/stigmer/sdk/go/stigmer"
	"github.com/stigmer/stigmer/sdk/go/workflow"
)

// This example creates test fixtures for HITL (Human-in-the-Loop) approval flow testing.
//
// Key components:
// 1. MCP Server with a tool that will require approval (configured via proto)
// 2. Agent that uses the MCP server
// 3. Workflow that calls the agent
//
// Note: Tool approval policies are configured at the proto level, not in this SDK code.
// The agent-runner will check approval requirements based on MCP server and agent configuration.
//
// Test Scenarios Supported:
// - Scenario 1: Approve via Workflow API
// - Scenario 2: Approve via Agent API
// - Scenario 3: Skip via Workflow API
// - Scenario 4: Reject via Workflow API
// - Scenario 7: Signal Latency Verification
func main() {
	err := stigmer.Run(func(ctx *stigmer.Context) error {
		// ============================================================================
		// Step 1: Create MCP Server for testing
		// ============================================================================
		// Using filesystem MCP server which is commonly available.
		// In a real test environment, you would configure pinned_tool_approvals
		// on this server to require approval for write operations.
		testMcpServer, err := mcpserver.Stdio(
			mcpserver.WithName("hitl-test-mcp-server"),
			mcpserver.WithCommand("npx"),
			mcpserver.WithArgs("-y", "@anthropics/mcp-server-filesystem"),
			// Note: Tool approval policies are configured separately via proto/API
			// The filesystem server has read_file, write_file, list_directory, etc.
			// For testing, configure write_file to require approval.
		)
		if err != nil {
			return err
		}

		// ============================================================================
		// Step 2: Create the approval test agent
		// ============================================================================
		// This agent is designed to call tools that may require approval.
		// The agent's instructions guide it to use the filesystem MCP server.
		approvalAgent, err := agent.New(ctx, "hitl-approval-test-agent", &agent.AgentArgs{
			Instructions: `You are a test agent for validating HITL (Human-in-the-Loop) approval workflows.

When asked to perform a task, you should:
1. Use the available filesystem tools to complete the task
2. When asked to write or create files, use the write_file tool
3. When asked to delete files, use the appropriate delete tool

IMPORTANT: Some operations may require user approval. If a tool requires approval,
the workflow will pause and wait for the user to approve, skip, or reject the operation.

For testing purposes:
- When asked to "execute the dangerous operation", attempt to write to a test file
- This will trigger the approval flow if write_file is configured to require approval

Always be helpful and follow the user's instructions.`,
			Description: "Test agent for HITL approval flow validation",
		})
		if err != nil {
			return err
		}

		// Add MCP server to agent
		approvalAgent.AddMCPServers(testMcpServer)

		// ============================================================================
		// Step 3: Create the approval test workflow
		// ============================================================================
		// This workflow calls the agent with a message that will trigger tool usage.
		approvalWorkflow, err := workflow.New(ctx,
			workflow.WithNamespace("hitl-testing"),
			workflow.WithName("hitl-approval-test-workflow"),
			workflow.WithVersion("1.0.0"),
			workflow.WithDescription("Workflow for testing HITL approval flow"),
		)
		if err != nil {
			return err
		}

		// Call the agent with a message that triggers the approval-required tool
		approvalTask := approvalWorkflow.CallAgent("approval_task", &workflow.AgentCallArgs{
			Agent:   workflow.Agent(approvalAgent).Slug(),
			Message: "Execute the dangerous operation by creating a test file at /tmp/hitl-test.txt with content 'HITL approval test'",
		})

		log.Printf("✅ Created HITL approval test fixtures:")
		log.Printf("   - MCP Server: %s", testMcpServer.Name())
		log.Printf("   - Agent: %s", approvalAgent.Name)
		log.Printf("   - Workflow: %s", approvalWorkflow.Document.Name)
		log.Printf("   - Task: %s", approvalTask.Name)

		return nil
	})

	if err != nil {
		log.Fatalf("❌ Error creating HITL test fixtures: %v", err)
	}

	log.Println("✅ HITL approval test fixtures created successfully!")
	log.Println("")
	log.Println("Note: To enable approval requirements, configure pinned_tool_approvals")
	log.Println("on the MCP server via the API or stigmer-service configuration.")
}
