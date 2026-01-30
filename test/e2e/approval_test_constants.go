//go:build e2e
// +build e2e

package e2e

import "time"

// =============================================================================
// HITL Approval Flow Test Constants
// =============================================================================
//
// These constants are used for end-to-end testing of the Human-in-the-Loop
// approval flow. The test fixtures are defined in testdata/hitl-approval/.
//
// Test Coverage:
// - Scenario 1: Approve via Workflow API
// - Scenario 2: Approve via Agent API
// - Scenario 3: Skip via Workflow API
// - Scenario 4: Reject via Workflow API
// - Scenario 5: Multiple Agents in Workflow
// - Scenario 7: Signal Latency Verification
// =============================================================================

const (
	// Test timeouts for approval operations
	// These are longer than normal tests due to the multi-service flow
	ApprovalTestTimeout       = 90 * time.Second
	ApprovalPollingInterval   = 500 * time.Millisecond
	SignalLatencyThreshold    = 100 * time.Millisecond
	ApprovalStreamingTimeout  = 60 * time.Second
	ApprovalCompletionTimeout = 120 * time.Second

	// Test fixture paths (relative to test/e2e/)
	ApprovalTestDataDir         = "testdata/hitl-approval"
	ApprovalWorkflowFixture     = "testdata/hitl-approval/workflow.yaml"
	ApprovalAgentFixture        = "testdata/hitl-approval/agent.yaml"
	ApprovalMcpServerFixture    = "testdata/hitl-approval/mcp-server.yaml"
	ApprovalMultiAgentFixture   = "testdata/hitl-approval/multi-agent-workflow.yaml"
	ApprovalSafeAgentFixture    = "testdata/hitl-approval/safe-agent.yaml"
	ApprovalSummaryAgentFixture = "testdata/hitl-approval/summary-agent.yaml"

	// Workflow names for approval tests
	ApprovalTestWorkflowName      = "hitl-approval-test-workflow"
	ApprovalTestWorkflowNamespace = "hitl-testing"
	ApprovalTestWorkflowVersion   = "1.0.0"

	// Multi-agent workflow names
	ApprovalMultiAgentWorkflowName = "hitl-multi-agent-workflow"

	// Agent names for approval tests
	ApprovalTestAgentName    = "hitl-approval-test-agent"
	ApprovalSafeAgentName    = "hitl-safe-agent"
	ApprovalSummaryAgentName = "hitl-summary-agent"

	// MCP server names for approval tests
	ApprovalTestMcpServerName = "hitl-test-mcp-server"

	// Tool names that require approval
	ApprovalTestToolName        = "dangerous_operation"
	ApprovalTestToolDescription = "A dangerous operation that requires approval"

	// Task names in workflows
	ApprovalTestTaskName    = "approval_task"
	MultiAgentResearchTask  = "research_task"
	MultiAgentDangerousTask = "dangerous_task"
	MultiAgentSummaryTask   = "summary_task"

	// Expected task counts
	ApprovalTestWorkflowTaskCount       = 1
	ApprovalMultiAgentWorkflowTaskCount = 3

	// Test messages used to trigger tool calls
	ApprovalTestMessage = "Execute the dangerous operation"
	SafeAgentMessage    = "Research the topic"
	SummaryAgentMessage = "Summarize the results"

	// Expected approval message template
	ApprovalMessageTemplate = "Approve dangerous operation"

	// Organization for tests
	ApprovalTestOrg = "local"
)

// ApprovalActionNames maps action enum values to readable names for logging
var ApprovalActionNames = map[int32]string{
	0: "UNSPECIFIED",
	1: "APPROVE",
	2: "SKIP",
	3: "REJECT",
}
