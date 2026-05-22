package harness

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	mcpserverv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/mcpserver/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// workflowArchitectEnabledTools mirrors the enabled_tools list from
// seedpack/agents/workflow-architect.yaml. Kept in sync manually —
// if the seedpack changes, tests catch the drift.
var workflowArchitectEnabledTools = []string{
	"search",
	"get_agent",
	"get_mcp_server",
	"get_skill",
	"get_workflow",
	"get_task_kind_registry",
	"get_task_kind",
	"validate_workflow_yaml",
	"get_workflow_execution",
	"get_workflow_execution_events",
}

// CreateStigmerMcpServer creates an McpServer resource pointing to the real
// mcp-server-stigmer binary. The server is auto-deleted on test cleanup.
func CreateStigmerMcpServer(t *testing.T, ctx context.Context, clients *Clients, binaryPath string) *mcpserverv1.McpServer {
	t.Helper()

	name := "test-stigmer-mcp-" + uuid.New().String()[:8]
	server := &mcpserverv1.McpServer{
		ApiVersion: TestAPIVersion,
		Kind:       "McpServer",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
			Org:  TestOrg,
		},
		Spec: &mcpserverv1.McpServerSpec{
			Description: "Integration test: mcp-server-stigmer (real binary)",
			ServerType: &mcpserverv1.McpServerSpec_Stdio{
				Stdio: &mcpserverv1.StdioServerConfig{
					Command: binaryPath,
				},
			},
		},
	}

	created, err := clients.McpServerCommand.Apply(ctx, server)
	require.NoError(t, err, "apply mcp-server-stigmer should succeed")
	require.NotEmpty(t, created.GetMetadata().GetId())

	t.Logf("created mcp-server-stigmer: name=%s, id=%s, slug=%s",
		created.GetMetadata().GetName(),
		created.GetMetadata().GetId(),
		created.GetMetadata().GetSlug())

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.McpServerCommand.Delete(cleanCtx, &apiresource.ApiResourceDeleteInput{ResourceId: created.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up mcp-server-stigmer %s: %v", name, err)
		}
	})

	return created
}

// seedpackAgentSpec is the minimal YAML structure we parse from the seedpack
// agent definition. Only the fields we need for test agent creation.
type seedpackAgentSpec struct {
	Spec struct {
		Description     string `yaml:"description"`
		Instructions    string `yaml:"instructions"`
		McpServerUsages []struct {
			McpServerRef struct {
				Slug string `yaml:"slug"`
			} `yaml:"mcp_server_ref"`
			EnabledTools []string `yaml:"enabled_tools"`
		} `yaml:"mcp_server_usages"`
	} `yaml:"spec"`
}

// loadWorkflowArchitectInstructions reads the agent instructions from the
// seedpack definition on disk. This ensures tests exercise the same prompt
// that production uses.
func loadWorkflowArchitectInstructions() (string, error) {
	_, thisFile, _, _ := runtime.Caller(0)
	seedpackPath := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "seedpack", "agents", "workflow-architect.yaml")

	data, err := os.ReadFile(seedpackPath)
	if err != nil {
		return "", fmt.Errorf("read seedpack agent: %w", err)
	}

	var agent seedpackAgentSpec
	if err := yaml.Unmarshal(data, &agent); err != nil {
		return "", fmt.Errorf("parse seedpack agent YAML: %w", err)
	}

	if agent.Spec.Instructions == "" {
		return "", fmt.Errorf("seedpack agent has empty instructions")
	}

	return agent.Spec.Instructions, nil
}

// CreateWorkflowArchitectAgent creates a test agent with the real Workflow
// Architect instructions from the seedpack and the specified MCP server.
// The agent is auto-deleted on test cleanup.
func CreateWorkflowArchitectAgent(t *testing.T, ctx context.Context, clients *Clients, mcpServerSlug, testSuffix string) *agentv1.Agent {
	t.Helper()

	instructions, err := loadWorkflowArchitectInstructions()
	require.NoError(t, err, "loading workflow-architect instructions from seedpack should succeed")

	return CreateAgent(t, ctx, clients,
		"workflow-architect-"+testSuffix,
		instructions,
		WithMcpServerUsage(mcpServerSlug, workflowArchitectEnabledTools...),
	)
}

// yamlFencePattern matches ```yaml ... ``` fenced code blocks.
var yamlFencePattern = regexp.MustCompile("(?s)```ya?ml\\s*\n(.*?)```")

// ExtractWorkflowYAML scans agent execution messages (last AI message first)
// for a ```yaml fenced code block and returns the YAML content. This is the
// Go equivalent of sdk/react/src/workflow/extract-workflow-yaml.ts.
// Returns empty string if no YAML block is found.
func ExtractWorkflowYAML(exec *agentexecv1.AgentExecution) string {
	messages := exec.GetStatus().GetMessages()

	// Scan from last message backward, looking for AI messages with YAML.
	for i := len(messages) - 1; i >= 0; i-- {
		msg := messages[i]
		if msg.GetType() != agentexecv1.MessageType_MESSAGE_AI {
			continue
		}

		content := msg.GetContent()
		if content == "" {
			continue
		}

		matches := yamlFencePattern.FindAllStringSubmatch(content, -1)
		if len(matches) == 0 {
			continue
		}

		// Return the last YAML block in the message (matches TS behavior).
		lastMatch := matches[len(matches)-1]
		yamlContent := strings.TrimSpace(lastMatch[1])
		if yamlContent != "" {
			return yamlContent
		}
	}

	return ""
}

// AssertHasYAMLBlock asserts that the agent execution contains at least one
// AI message with a ```yaml fenced code block.
func AssertHasYAMLBlock(t *testing.T, exec *agentexecv1.AgentExecution) string {
	t.Helper()
	yamlContent := ExtractWorkflowYAML(exec)
	if !assert.NotEmpty(t, yamlContent, "expected at least one ```yaml block in agent AI messages") {
		logLastAIMessage(t, exec)
	}
	return yamlContent
}

func logLastAIMessage(t *testing.T, exec *agentexecv1.AgentExecution) {
	t.Helper()
	messages := exec.GetStatus().GetMessages()
	for i := len(messages) - 1; i >= 0; i-- {
		if messages[i].GetType() == agentexecv1.MessageType_MESSAGE_AI {
			content := messages[i].GetContent()
			if len(content) > 500 {
				content = content[:500] + "..."
			}
			t.Logf("last AI message (truncated): %s", content)
			return
		}
	}
	t.Log("no AI messages found in execution")
}

// AssertHasAnyToolCall asserts that at least one tool call with any of the
// given names exists in the execution messages.
func AssertHasAnyToolCall(t *testing.T, exec *agentexecv1.AgentExecution, toolNames ...string) {
	t.Helper()
	nameSet := make(map[string]bool, len(toolNames))
	for _, n := range toolNames {
		nameSet[n] = true
	}
	for _, msg := range exec.GetStatus().GetMessages() {
		for _, tc := range msg.GetToolCalls() {
			if nameSet[tc.GetName()] {
				return
			}
		}
	}
	t.Errorf("expected at least one tool call from %v, but none found", toolNames)
}

// WorkflowArchitectEnabledTools returns the hardcoded enabled tools list
// for comparison in sync tests.
func WorkflowArchitectEnabledTools() []string {
	return workflowArchitectEnabledTools
}

// LoadWorkflowArchitectEnabledTools is the exported version for tests
// outside the harness package.
func LoadWorkflowArchitectEnabledTools() ([]string, error) {
	return loadWorkflowArchitectEnabledTools()
}

// loadWorkflowArchitectEnabledTools reads the enabled_tools list from the
// seedpack workflow-architect agent definition. Used by SeedpackSync test
// to detect drift between harness constants and the seedpack source of truth.
func loadWorkflowArchitectEnabledTools() ([]string, error) {
	_, thisFile, _, _ := runtime.Caller(0)
	seedpackPath := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "seedpack", "agents", "workflow-architect.yaml")

	data, err := os.ReadFile(seedpackPath)
	if err != nil {
		return nil, fmt.Errorf("read seedpack agent: %w", err)
	}

	var agent seedpackAgentSpec
	if err := yaml.Unmarshal(data, &agent); err != nil {
		return nil, fmt.Errorf("parse seedpack agent YAML: %w", err)
	}

	if len(agent.Spec.McpServerUsages) == 0 {
		return nil, fmt.Errorf("seedpack agent has no mcp_server_usages")
	}

	tools := agent.Spec.McpServerUsages[0].EnabledTools
	if len(tools) == 0 {
		return nil, fmt.Errorf("seedpack agent has empty enabled_tools")
	}

	return tools, nil
}
