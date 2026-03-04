package root

import (
	"bytes"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSubjectLineOffset_AllFields(t *testing.T) {
	info := sessionHeaderInfo{
		AgentName:  "my-agent",
		SessionID:  "ses-123",
		Subject:    subjectPlaceholder,
		Model:      "sonnet-4.6",
		Workspaces: []string{"/ws1", "/ws2"},
	}
	// Content lines: Agent, Session, Subject, Model, WS1, WS2 (6 lines)
	// Subject is at index 2. Lines after: Model + WS1 + WS2 = 3.
	// Offset = 3 + 4 (empty row + bottom border + 2 trailing newlines) = 7
	assert.Equal(t, 7, subjectLineOffset(info))
}

func TestSubjectLineOffset_SingleWorkspace(t *testing.T) {
	info := sessionHeaderInfo{
		AgentName:  "my-agent",
		SessionID:  "ses-123",
		Subject:    subjectPlaceholder,
		Model:      "sonnet-4.6",
		Workspaces: []string{"/ws1"},
	}
	// Content: Agent, Session, Subject, Model, WS (5 lines)
	// Subject at index 2, lines after = 2, offset = 2 + 4 = 6
	assert.Equal(t, 6, subjectLineOffset(info))
}

func TestSubjectLineOffset_NoWorkspaces(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-123",
		Subject:   subjectPlaceholder,
		Model:     "sonnet-4.6",
	}
	// Content: Session, Subject, Model (3 lines)
	// Subject at index 1, lines after = 1, offset = 1 + 4 = 5
	assert.Equal(t, 5, subjectLineOffset(info))
}

func TestSubjectLineOffset_NoSubject(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-123",
		Model:     "sonnet-4.6",
	}
	// No Subject line → offset = 0
	assert.Equal(t, 0, subjectLineOffset(info))
}

func TestLineCountingWriter(t *testing.T) {
	var buf bytes.Buffer
	counter := &atomic.Int64{}
	w := &lineCountingWriter{inner: &buf, counter: counter}

	_, err := w.Write([]byte("hello\nworld\n"))
	require.NoError(t, err)
	assert.Equal(t, int64(2), counter.Load())
	assert.Equal(t, "hello\nworld\n", buf.String())

	_, err = w.Write([]byte("no newline"))
	require.NoError(t, err)
	assert.Equal(t, int64(2), counter.Load())

	_, err = w.Write([]byte("\n"))
	require.NoError(t, err)
	assert.Equal(t, int64(3), counter.Load())
}

func TestRenderSubjectPanelRow_ContainsBorders(t *testing.T) {
	row := renderSubjectPanelRow("Create MCP server")
	assert.Contains(t, row, "Subject:")
	assert.Contains(t, row, "Create MCP server")
	assert.NotContains(t, row, "\n")
}

func TestSetupSubjectUpdater_WithSubject(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-123",
		Subject:   subjectPlaceholder,
		Model:     "sonnet-4.6",
	}
	var dataBuf, statusBuf bytes.Buffer
	dataW, statusW, updater := setupSubjectUpdater(&dataBuf, &statusBuf, info)

	require.NotNil(t, updater)
	assert.NotEqual(t, &dataBuf, dataW, "dataW should be wrapped")
	assert.NotEqual(t, &statusBuf, statusW, "statusW should be wrapped")
}

func TestSetupSubjectUpdater_NoSubject(t *testing.T) {
	info := sessionHeaderInfo{
		SessionID: "ses-123",
		Model:     "sonnet-4.6",
	}
	var dataBuf, statusBuf bytes.Buffer
	dataW, statusW, updater := setupSubjectUpdater(&dataBuf, &statusBuf, info)

	assert.Nil(t, updater)
	assert.Equal(t, &dataBuf, dataW, "dataW should be original")
	assert.Equal(t, &statusBuf, statusW, "statusW should be original")
}

func TestSubjectUpdater_UpdateSubject(t *testing.T) {
	counter := &atomic.Int64{}
	var buf bytes.Buffer
	updater := &subjectUpdater{
		rawWriter:     &buf,
		lineCounter:   counter,
		offsetFromEnd: 5,
	}

	counter.Store(3)
	updater.UpdateSubject("Fix login bug")

	output := buf.String()
	assert.Contains(t, output, "\033[s")
	assert.Contains(t, output, "\033[8A")
	assert.Contains(t, output, "Subject:")
	assert.Contains(t, output, "Fix login bug")
	assert.Contains(t, output, "\033[u")
}

func TestSubjectUpdater_UpdateSubject_OnlyOnce(t *testing.T) {
	counter := &atomic.Int64{}
	var buf bytes.Buffer
	updater := &subjectUpdater{
		rawWriter:     &buf,
		lineCounter:   counter,
		offsetFromEnd: 5,
	}

	updater.UpdateSubject("First subject")
	first := buf.String()
	buf.Reset()

	updater.UpdateSubject("Second subject")
	assert.Empty(t, buf.String(), "second update should be no-op")
	assert.NotEmpty(t, first)
}

func TestSubjectUpdater_UpdateSubject_SkipsWhenTooFar(t *testing.T) {
	counter := &atomic.Int64{}
	var buf bytes.Buffer
	updater := &subjectUpdater{
		rawWriter:     &buf,
		lineCounter:   counter,
		offsetFromEnd: 5,
	}

	counter.Store(200)
	updater.UpdateSubject("Scrolled off")

	assert.Empty(t, buf.String(), "should skip update when header scrolled off screen")
}

func TestSubjectUpdater_NilSafe(t *testing.T) {
	var updater *subjectUpdater
	updater.UpdateSubject("should not panic")
}

func TestRenderSubjectPanelRow_LongSubjectTruncated(t *testing.T) {
	longSubject := strings.Repeat("a", 200)
	row := renderSubjectPanelRow(longSubject)
	assert.NotContains(t, row, "\n")
}
