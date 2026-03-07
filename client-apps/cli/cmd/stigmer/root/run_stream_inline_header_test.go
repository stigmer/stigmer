package root

import (
	"bytes"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/stigmer/stigmer/client-apps/cli/pkg/panel"
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
	assert.Contains(t, result, "stigmer resume <session-id>")
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
// formatHeaderPanel — side-by-side layout
// =============================================================================

func TestFormatHeaderPanel_SideBySide_WideTerminal(t *testing.T) {
	info := sessionHeaderInfo{
		AgentName: "mcp-server-creator",
		SessionID: "ses-01kjv9j3zdvdwh1kpehe5gvs78",
		Subject:   "Create MCP server config",
		RecentSessions: []recentSession{
			{SessionID: "ses-aaa", Subject: "Fix auth bug", CreatedAt: time.Now().Add(-2 * time.Hour)},
			{SessionID: "ses-bbb", Subject: "Add feature", CreatedAt: time.Now().Add(-48 * time.Hour)},
		},
	}

	content, pw := formatHeaderPanel(info, 130)

	assert.Greater(t, pw, panel.DefaultWidth, "wide terminal should produce wider panel")
	assert.Contains(t, content, "Welcome back!")
	assert.Contains(t, content, "Agent:")
	assert.Contains(t, content, "ses-01kjv9j3zdvdwh1kpehe5gvs78")
	assert.Contains(t, content, "Recent sessions")
	assert.Contains(t, content, "Fix auth bug")
	assert.Contains(t, content, "ses-aaa")

	// Verify the vertical divider is present (dim-styled │).
	assert.Contains(t, content, "│")

	// The metadata and recent sessions should appear on the same line
	// (side-by-side), not separated by a blank line.
	for _, line := range strings.Split(content, "\n") {
		if strings.Contains(line, "Agent:") && strings.Contains(line, "Recent sessions") {
			return // Found side-by-side line — pass.
		}
	}
	// If Agent: and Recent sessions don't share a line, at least verify
	// the divider separates them row-by-row by checking for │ on a
	// metadata line.
	for _, line := range strings.Split(content, "\n") {
		if strings.Contains(line, "Agent:") {
			assert.Contains(t, line, "│", "metadata line should have divider in side-by-side mode")
			return
		}
	}
	t.Error("expected side-by-side layout with │ divider on metadata lines")
}

func TestFormatHeaderPanel_NarrowTerminal_FallsBackToStacked(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
		RecentSessions: []recentSession{
			{SessionID: "ses-prev", Subject: "Previous work", CreatedAt: time.Now().Add(-time.Hour)},
		},
	}

	content, pw := formatHeaderPanel(info, 80)

	assert.Equal(t, panel.DefaultWidth, pw, "narrow terminal should use default panel width")
	assert.Contains(t, content, "Welcome back!")
	assert.Contains(t, content, "ses-abc123")
	assert.Contains(t, content, "Recent sessions")
	assert.Contains(t, content, "ses-prev")
}

func TestFormatHeaderPanel_ZeroWidth_FallsBackToStacked(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
		RecentSessions: []recentSession{
			{SessionID: "ses-prev", Subject: "Previous work", CreatedAt: time.Now().Add(-time.Hour)},
		},
	}

	content, pw := formatHeaderPanel(info, 0)

	assert.Equal(t, panel.DefaultWidth, pw)
	assert.Contains(t, content, "ses-abc123")
	assert.Contains(t, content, "Recent sessions")
}

func TestFormatHeaderPanel_ResumedSession_AlwaysStacked(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
		IsResumed: true,
		RecentSessions: []recentSession{
			{SessionID: "ses-prev", Subject: "Previous work", CreatedAt: time.Now().Add(-time.Hour)},
		},
	}

	content, pw := formatHeaderPanel(info, 130)

	assert.Equal(t, panel.DefaultWidth, pw, "resumed sessions should use default width")
	assert.NotContains(t, content, "Welcome back!")
	assert.NotContains(t, content, "Recent sessions")
	assert.Contains(t, content, "ses-abc123")
}

func TestFormatHeaderPanel_NoRecentSessions_Stacked(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-abc123",
	}

	content, pw := formatHeaderPanel(info, 130)

	assert.Equal(t, panel.DefaultWidth, pw)
	assert.Contains(t, content, "Welcome back!")
	assert.Contains(t, content, "ses-abc123")
}

func TestFormatHeaderPanel_Empty(t *testing.T) {
	content, pw := formatHeaderPanel(sessionHeaderInfo{}, 130)

	assert.Equal(t, "", content)
	assert.Equal(t, panel.DefaultWidth, pw)
}

// =============================================================================
// composeSideBySide
// =============================================================================

func TestComposeSideBySide_ContainsDivider(t *testing.T) {
	metadata := "Agent:      test-agent\nSession:    ses-123"
	sessions := []recentSession{
		{SessionID: "ses-prev", Subject: "Fix bug", CreatedAt: time.Now().Add(-time.Hour)},
	}

	result := composeSideBySide(metadata, sessions, 40)

	assert.Contains(t, result, "│")
	assert.Contains(t, result, "Agent:")
	assert.Contains(t, result, "Recent sessions")
	assert.Contains(t, result, "Fix bug")
}

func TestComposeSideBySide_ColumnsAligned(t *testing.T) {
	metadata := "Line 1\nLine 2\nLine 3"
	sessions := []recentSession{
		{SessionID: "ses-a", Subject: "Subject A", CreatedAt: time.Now().Add(-time.Hour)},
	}

	result := composeSideBySide(metadata, sessions, 40)
	lines := strings.Split(result, "\n")

	// Every line should contain the divider character.
	for i, line := range lines {
		assert.Contains(t, line, "│", "line %d should contain divider", i)
	}
}

// =============================================================================
// formatRecentSessionsForWidth
// =============================================================================

func TestFormatRecentSessionsForWidth_FitsInWidth(t *testing.T) {
	sessions := []recentSession{
		{SessionID: "ses-01kjv9j3zdvdwh1kpehe5gvs78", Subject: "Fix the auth bug in login flow", CreatedAt: time.Now().Add(-2 * time.Hour)},
	}

	result := formatRecentSessionsForWidth(sessions, 45)

	assert.Contains(t, result, "Recent sessions")
	assert.Contains(t, result, "└")
	assert.Contains(t, result, "stigmer resume")
}

func TestFormatRecentSessionsForWidth_TruncatesLongSubject(t *testing.T) {
	sessions := []recentSession{
		{SessionID: "ses-aaa", Subject: "This is a very long subject that should be truncated", CreatedAt: time.Now().Add(-time.Hour)},
	}

	result := formatRecentSessionsForWidth(sessions, 40)

	assert.Contains(t, result, "…", "long subjects should be truncated with ellipsis")
}

func TestFormatRecentSessionsForWidth_EmptySubjectFallback(t *testing.T) {
	sessions := []recentSession{
		{SessionID: "ses-xxx", Subject: "", CreatedAt: time.Now()},
	}

	result := formatRecentSessionsForWidth(sessions, 45)
	assert.Contains(t, result, "(no subject)")
}

// =============================================================================
// truncateStr
// =============================================================================

func TestTruncateStr(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		maxWidth int
		expected string
	}{
		{"fits", "hello", 10, "hello"},
		{"exact", "hello", 5, "hello"},
		{"truncates", "hello world", 8, "hello w…"},
		{"width-1", "hello", 1, "…"},
		{"width-0", "hello", 0, "…"},
		{"empty", "", 5, ""},
		{"unicode", "héllo wörld", 8, "héllo w…"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, truncateStr(tt.input, tt.maxWidth))
		})
	}
}

// =============================================================================
// headerPanelWidth
// =============================================================================

func TestHeaderPanelWidth(t *testing.T) {
	tests := []struct {
		name      string
		termWidth int
		expected  int
	}{
		{"narrow terminal", 80, 78},
		{"medium terminal", 110, 108},
		{"wide terminal", 140, maxHeaderPanelWidth},
		{"very narrow", 40, panel.DefaultWidth},
		{"exact threshold", minSideBySidePanelWidth + 2, minSideBySidePanelWidth},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.expected, headerPanelWidth(tt.termWidth))
		})
	}
}

// =============================================================================
// maxLineWidth
// =============================================================================

func TestMaxLineWidth(t *testing.T) {
	assert.Equal(t, 5, maxLineWidth("hello"))
	assert.Equal(t, 11, maxLineWidth("short\nhello world"))
	assert.Equal(t, 0, maxLineWidth(""))
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
