package root

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestFormatSessionHeaderContent_AllFields(t *testing.T) {
	info := sessionHeaderInfo{
		AgentName:  "mcp-server-creator",
		SessionID:  "ses-01kjv9j3zdvdwh1kpehe5gvs78",
		Subject:    "Create MCP server config",
		Model:      "sonnet-4.6",
		IsResumed:  true,
		Workspaces: []string{"/path/to/ws1", "/path/to/ws2"},
	}

	content := formatSessionHeaderContent(info)

	assert.Contains(t, content, "Agent:      mcp-server-creator")
	assert.Contains(t, content, "Session:    ses-01kjv9j3zdvdwh1kpehe5gvs78")
	assert.Contains(t, content, "Subject:    Create MCP server config")
	assert.Contains(t, content, "Model:      sonnet-4.6")
	assert.Contains(t, content, "Workspaces: /path/to/ws1")
	assert.Contains(t, content, "            /path/to/ws2")
	assert.NotContains(t, content, "Welcome back!")
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
		IsResumed: true,
	}

	content := formatSessionHeaderContent(info)

	assert.Contains(t, content, "Session:")
	assert.Contains(t, content, "Subject:    Fix the login bug")
	assert.NotContains(t, content, "Agent:")
	assert.NotContains(t, content, "Welcome back!")
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

// =============================================================================
// Greeting — Welcome back!
// =============================================================================

func TestFormatSessionHeaderContent_NewSession_ShowsGreeting(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
	}

	content := formatSessionHeaderContent(info)
	assert.Contains(t, content, "Welcome back!")
}

func TestFormatSessionHeaderContent_ResumedSession_SkipsGreeting(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
		IsResumed: true,
	}

	content := formatSessionHeaderContent(info)
	assert.NotContains(t, content, "Welcome back!")
	assert.Contains(t, content, "ses-abc123")
}

// =============================================================================
// Header title — version and expand mode
// =============================================================================

func TestHeaderTitle_NoVersion(t *testing.T) {
	assert.Equal(t, "Stigmer", headerTitle("", false))
}

func TestHeaderTitle_DevVersion(t *testing.T) {
	assert.Equal(t, "Stigmer", headerTitle("dev", false))
}

func TestHeaderTitle_WithVersion(t *testing.T) {
	assert.Equal(t, "Stigmer v0.12.3", headerTitle("0.12.3", false))
}

func TestHeaderTitle_WithVersionAndExpanded(t *testing.T) {
	assert.Equal(t, "Stigmer v0.12.3 · expanded", headerTitle("0.12.3", true))
}

func TestHeaderTitle_ExpandedWithoutVersion(t *testing.T) {
	assert.Equal(t, "Stigmer · expanded", headerTitle("", true))
}

// =============================================================================
// Recent sessions formatting
// =============================================================================

func TestFormatRecentSessionsSection_BasicEntries(t *testing.T) {
	sessions := []recentSession{
		{SessionID: "ses-aaa", Subject: "Fix auth bug", CreatedAt: time.Now().Add(-2 * time.Hour)},
		{SessionID: "ses-bbb", Subject: "Add feature", CreatedAt: time.Now().Add(-48 * time.Hour)},
	}

	result := formatRecentSessionsSection(sessions)

	assert.Contains(t, result, "Recent sessions")
	assert.Contains(t, result, "Fix auth bug")
	assert.Contains(t, result, "ses-aaa")
	assert.Contains(t, result, "Add feature")
	assert.Contains(t, result, "ses-bbb")
	assert.Contains(t, result, "└")
	assert.Contains(t, result, "stigmer run <session-id>")
}

func TestFormatRecentSessionsSection_CapsAtMax(t *testing.T) {
	sessions := make([]recentSession, 5)
	for i := range sessions {
		sessions[i] = recentSession{
			SessionID: fmt.Sprintf("ses-%d", i),
			Subject:   fmt.Sprintf("Subject %d", i),
			CreatedAt: time.Now().Add(-time.Duration(i) * time.Hour),
		}
	}

	result := formatRecentSessionsSection(sessions)

	assert.Contains(t, result, "ses-0")
	assert.Contains(t, result, "ses-1")
	assert.Contains(t, result, "ses-2")
	assert.NotContains(t, result, "ses-3")
	assert.NotContains(t, result, "ses-4")
}

func TestFormatRecentSessionsSection_EmptySubjectFallback(t *testing.T) {
	sessions := []recentSession{
		{SessionID: "ses-xxx", Subject: "", CreatedAt: time.Now()},
	}

	result := formatRecentSessionsSection(sessions)
	assert.Contains(t, result, "(no subject)")
}

func TestFormatSessionHeaderContent_NewSessionWithRecentSessions(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-current",
		RecentSessions: []recentSession{
			{SessionID: "ses-prev", Subject: "Previous work", CreatedAt: time.Now().Add(-time.Hour)},
		},
	}

	content := formatSessionHeaderContent(info)
	assert.Contains(t, content, "Welcome back!")
	assert.Contains(t, content, "ses-current")
	assert.Contains(t, content, "Recent sessions")
	assert.Contains(t, content, "ses-prev")
}

func TestFormatSessionHeaderContent_ResumedSessionSkipsRecentSessions(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-current",
		IsResumed: true,
		RecentSessions: []recentSession{
			{SessionID: "ses-prev", Subject: "Previous work", CreatedAt: time.Now().Add(-time.Hour)},
		},
	}

	content := formatSessionHeaderContent(info)
	assert.NotContains(t, content, "Welcome back!")
	assert.NotContains(t, content, "Recent sessions")
	assert.Contains(t, content, "ses-current")
}

// =============================================================================
// relativeTime helper
// =============================================================================

func TestRelativeTime(t *testing.T) {
	tests := []struct {
		name     string
		input    time.Time
		expected string
	}{
		{"zero", time.Time{}, ""},
		{"just now", time.Now().Add(-10 * time.Second), "just now"},
		{"1 minute ago", time.Now().Add(-90 * time.Second), "1 minute ago"},
		{"5 minutes ago", time.Now().Add(-5 * time.Minute), "5 minutes ago"},
		{"1 hour ago", time.Now().Add(-90 * time.Minute), "1 hour ago"},
		{"3 hours ago", time.Now().Add(-3 * time.Hour), "3 hours ago"},
		{"yesterday", time.Now().Add(-30 * time.Hour), "yesterday"},
		{"3 days ago", time.Now().Add(-72 * time.Hour), "3 days ago"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, relativeTime(tt.input))
		})
	}
}
