package root

import (
	"bytes"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestFormatSessionHeaderContent_AllFields(t *testing.T) {
	info := sessionHeaderInfo{
		AgentName:  "mcp-server-creator",
		SessionID:  "ses-01kjv9j3zdvdwh1kpehe5gvs78",
		Subject:    "Create MCP server config",
		Model:      "sonnet-4.6",
		Workspaces: []string{"/path/to/ws1", "/path/to/ws2"},
	}

	content := formatSessionHeaderContent(info)

	assert.Contains(t, content, "Agent:      mcp-server-creator")
	assert.Contains(t, content, "Session:    ses-01kjv9j3zdvdwh1kpehe5gvs78")
	assert.Contains(t, content, "Subject:    Create MCP server config")
	assert.Contains(t, content, "Model:      sonnet-4.6")
	assert.Contains(t, content, "Workspaces: /path/to/ws1")
	assert.Contains(t, content, "            /path/to/ws2")
}

func TestFormatSessionHeaderContent_SessionOnly(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
	}

	content := formatSessionHeaderContent(info)

	assert.Contains(t, content, "Session:    ses-abc123")
	assert.NotContains(t, content, "Agent:")
	assert.NotContains(t, content, "Model:")
	assert.NotContains(t, content, "Workspaces:")
}

func TestFormatSessionHeaderContent_NoModel(t *testing.T) {
	info := sessionHeaderInfo{
		AgentName: "my-agent",
		SessionID: "ses-abc123",
	}

	content := formatSessionHeaderContent(info)

	assert.Contains(t, content, "Agent:")
	assert.Contains(t, content, "Session:")
	assert.NotContains(t, content, "Model:")
}

func TestFormatSessionHeaderContent_SingleWorkspace(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID:  "ses-abc123",
		Workspaces: []string{"/only/one/workspace"},
	}

	content := formatSessionHeaderContent(info)

	assert.Contains(t, content, "Workspaces: /only/one/workspace")
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "/only") && !strings.Contains(line, "Workspaces:") {
			t.Error("extra workspace line found for single workspace")
		}
	}
}

func TestFormatSessionHeaderContent_MultipleWorkspaces_Aligned(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID:  "ses-abc123",
		Workspaces: []string{"/ws/first", "/ws/second", "/ws/third"},
	}

	content := formatSessionHeaderContent(info)
	lines := strings.Split(content, "\n")

	var wsLines []string
	for _, line := range lines {
		if strings.Contains(line, "Workspaces:") || strings.HasPrefix(strings.TrimSpace(line), "/ws/") {
			wsLines = append(wsLines, line)
		}
	}

	assert.Len(t, wsLines, 3)
	firstValIdx := strings.Index(wsLines[0], "/ws/first")
	secondValIdx := strings.Index(wsLines[1], "/ws/second")
	assert.Equal(t, firstValIdx, secondValIdx, "workspace values should be column-aligned")
}

func TestFormatSessionHeaderContent_Empty(t *testing.T) {
	content := formatSessionHeaderContent(sessionHeaderInfo{})
	assert.Equal(t, "", content)
}

func TestFormatSessionHeaderContent_ResumeWithSubject(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
		Subject:   "Fix the login bug",
	}

	content := formatSessionHeaderContent(info)

	assert.Contains(t, content, "Session:")
	assert.Contains(t, content, "Subject:    Fix the login bug")
	assert.NotContains(t, content, "Agent:")
}

func TestRenderSessionHeader_WritesToWriter(t *testing.T) {
	var buf bytes.Buffer
	info := sessionHeaderInfo{
		AgentName: "test-agent",
		SessionID: "ses-test",
	}

	renderSessionHeader(&buf, info)

	output := buf.String()
	assert.Contains(t, output, "Stigmer")
	assert.Contains(t, output, "test-agent")
	assert.Contains(t, output, "ses-test")
	assert.True(t, strings.HasSuffix(output, "\n\n"), "should end with double newline")
}

func TestRenderSessionHeader_EmptyInfo_NoOutput(t *testing.T) {
	var buf bytes.Buffer
	renderSessionHeader(&buf, sessionHeaderInfo{})
	assert.Equal(t, "", buf.String())
}

func TestFormatHeaderRow_Alignment(t *testing.T) {
	row := formatHeaderRow("Agent", "my-agent")
	assert.Equal(t, "Agent:      my-agent", row)

	row = formatHeaderRow("Session", "ses-123")
	assert.Equal(t, "Session:    ses-123", row)

	row = formatHeaderRow("Workspaces", "/path")
	assert.Equal(t, "Workspaces: /path", row)
}

func TestWorkspaceNames_Empty(t *testing.T) {
	assert.Nil(t, workspaceNames(nil))
}
