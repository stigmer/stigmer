//go:build integration

package offline

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Offline First-Class Diff Review Tests (#186) ---
//
// These prove the runner's authoritative file-change capture end-to-end through
// the real system: a native (deepagents) execution edits files via the built-in
// write_file / edit_file tools, the CapturingFilesystemBackend records true
// before/after at the mutation point, the FileChangeCoordinator attaches them to
// the owning ToolCall, and they survive persistence to be read back over
// AgentExecutionQuery.Get as ToolCall.file_changes.
//
// They run fully offline against the MockLLMProxyServer (no provider keys) and
// need no MCP server — the filesystem tools are built into every native agent.
// Determinism comes from scripting the exact LLM turns; mockLLM.Remaining()==0
// guards against the agent making more calls than scripted.

// requireOfflineService is the file-change tests' prerequisite. Unlike
// requireOfflinePrereqs it does NOT gate on the MCP test-server binary, because
// the native filesystem tools are always present without any MCP server.
func requireOfflineService(t *testing.T) {
	t.Helper()
	require.NotNil(t, testHarness.Service, "java service must be running")
	require.NotNil(t, grpcConn, "gRPC connection required")
}

// uniqueWorkspacePath returns a workspace-relative file path unique to this run.
//
// The path is deliberately relative (no leading "/"). The deepagents
// FilesystemBackend resolves a relative path under the workspace root, so the
// write lands inside the runner's WORKSPACE_ROOT_DIR; an absolute "/foo" path
// would resolve against the real filesystem root (the backend is not in virtual
// mode) and fail. A relative path is also exactly the convention the capture
// pipeline's unit tests use, and it round-trips to a clean display path
// (resolveWorkspacePath keeps it as-is). The offline runner shares one
// WORKSPACE_ROOT_DIR across the suite and write_file is create-only (it errors
// if the file already exists), so a per-run nonce keeps tests isolated and
// re-runnable.
func uniqueWorkspacePath(label string) string {
	return fmt.Sprintf("phase5-%s-%d.txt", label, time.Now().UnixNano())
}

// runNativeFileEdits drives a native agent execution through the given scripted
// LLM turns and returns the completed execution. It is the shared arrange/act
// for the file-change tests.
func runNativeFileEdits(
	t *testing.T,
	ctx context.Context,
	entries []harness.RecordedLLMEntry,
	message string,
) *agentexecv1.AgentExecution {
	t.Helper()

	mockLLM, mgr := startOfflineRunner(t, ctx, entries)

	clients := harness.NewClients(grpcConn)
	harness.RequireServiceHealthy(t, ctx, clients)

	agent := harness.CreateAgent(t, ctx, clients,
		"offline-filechange-"+t.Name(),
		"You are a test agent. Use the filesystem tools to write and edit files.",
	)

	session := harness.CreateTestSession(t, ctx, clients,
		agent.GetStatus().GetDefaultInstanceId(),
		sessionv1.Harness_HARNESS_NATIVE,
	)
	sessionID := session.GetMetadata().GetId()

	_, err := mgr.AddSession(ctx, sessionID)
	require.NoError(t, err, "AddSession should succeed")

	exec := harness.CreateTestAgentExecution(t, ctx, clients,
		sessionID,
		message,
		harness.WithAutoApproveAll(true),
	)

	waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)
	result, err := waiter.WaitForPhase(ctx, exec.GetMetadata().GetId(),
		agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 2*time.Minute)
	if err != nil {
		harness.LogExecutionMessages(t, ctx, clients, exec.GetMetadata().GetId())
		t.Fatalf("offline native file-edit execution should complete: %v", err)
	}
	harness.AssertAgentPhase(t, result, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED)

	assert.Equal(t, 0, mockLLM.Remaining(),
		"all scripted LLM entries should be consumed (agent made exactly the scripted calls)")

	return result
}

// TestOffline_FileChanges_NativeWriteAndEdit_CapturesWholeFile proves the core
// capture pipeline: a write (CREATE) followed by an edit (MODIFY) of the same
// file in one turn, each landing a WHOLE_FILE FileChange on its owning ToolCall
// with the true inline before/after the runner captured at the mutation point.
func TestOffline_FileChanges_NativeWriteAndEdit_CapturesWholeFile(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	filePath := uniqueWorkspacePath("write-edit")
	const created = "alpha\nbeta\n"
	const edited = "alpha\ngamma\n"

	entries := []harness.RecordedLLMEntry{
		// Turn 1: create the file.
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_write_01", "write_file",
			map[string]any{"file_path": filePath, "content": created},
			300, 40,
		)),
		// Turn 2: edit the file (beta -> gamma).
		harness.BuildLLMEntry(1, harness.AnthropicToolUseResponse(
			"toolu_edit_01", "edit_file",
			map[string]any{"file_path": filePath, "old_string": "beta", "new_string": "gamma"},
			320, 40,
		)),
		// Turn 3: finish.
		harness.BuildLLMEntry(2, harness.AnthropicTextResponse(
			"Created and edited the file.", 360, 20,
		)),
	}

	result := runNativeFileEdits(t, ctx, entries,
		"Write a file then edit it using the filesystem tools.")

	harness.AssertHasToolCall(t, result, "write_file")
	harness.AssertHasToolCall(t, result, "edit_file")

	// CREATE: from the write_file tool call. No before; after is the new content.
	writeTc := harness.FindToolCall(result, "write_file")
	require.NotNil(t, writeTc, "write_file tool call must be present")
	require.Lenf(t, writeTc.GetFileChanges(), 1,
		"write_file should carry exactly one file change, got %d", len(writeTc.GetFileChanges()))
	createFc := writeTc.GetFileChanges()[0]
	assert.Equal(t, filePath, createFc.GetPath(),
		"file change path should be the workspace-relative path the tool used")
	assert.Equal(t, agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE, createFc.GetChangeType())
	assert.Equal(t, agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE, createFc.GetCaptureLevel())
	assert.Nil(t, createFc.GetBefore(), "a CREATE has no before side")
	require.NotNil(t, createFc.GetAfter(), "a CREATE must carry the new content as after")
	assert.Equal(t, created, createFc.GetAfter().GetInline(), "after should be the created content, inline")
	assert.False(t, createFc.GetAfter().GetIsBinary(), "text content must not be flagged binary")

	// MODIFY: from the edit_file tool call. True whole-file before and after.
	editTc := harness.FindToolCall(result, "edit_file")
	require.NotNil(t, editTc, "edit_file tool call must be present")
	require.Lenf(t, editTc.GetFileChanges(), 1,
		"edit_file should carry exactly one file change, got %d", len(editTc.GetFileChanges()))
	modifyFc := editTc.GetFileChanges()[0]
	assert.Equal(t, filePath, modifyFc.GetPath())
	assert.Equal(t, agentexecv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY, modifyFc.GetChangeType())
	assert.Equal(t, agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE, modifyFc.GetCaptureLevel())
	require.NotNil(t, modifyFc.GetBefore(), "a MODIFY must carry the pre-edit content as before")
	require.NotNil(t, modifyFc.GetAfter(), "a MODIFY must carry the post-edit content as after")
	assert.Equal(t, created, modifyFc.GetBefore().GetInline(), "before should be the pre-edit content")
	assert.Equal(t, edited, modifyFc.GetAfter().GetInline(), "after should reflect beta->gamma")
}

// TestOffline_FileChanges_LargeBody_OffloadsToRef proves the production offload
// path end-to-end: a write whose body exceeds the inline cap (128 KiB) is
// persisted as a ToolCallOutputRef under artifacts/{executionId}/ rather than
// inline. The runner's unit tests only exercise this with a tiny override; this
// is the only coverage of the real threshold + the local artifact store.
func TestOffline_FileChanges_LargeBody_OffloadsToRef(t *testing.T) {
	requireOfflineService(t)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	filePath := uniqueWorkspacePath("offload")

	// Comfortably over the 128 KiB INLINE_FILE_CONTENT_MAX_BYTES threshold.
	line := "A line of deterministic text used to exceed the inline cap.\n"
	largeContent := strings.Repeat(line, 5000) // ~295 KB
	require.Greater(t, len(largeContent), 128*1024, "fixture must exceed the inline cap")

	entries := []harness.RecordedLLMEntry{
		harness.BuildLLMEntry(0, harness.AnthropicToolUseResponse(
			"toolu_write_big", "write_file",
			map[string]any{"file_path": filePath, "content": largeContent},
			300, 40,
		)),
		harness.BuildLLMEntry(1, harness.AnthropicTextResponse(
			"Wrote the large file.", 340, 20,
		)),
	}

	result := runNativeFileEdits(t, ctx, entries, "Write a large file using the filesystem tools.")

	harness.AssertHasToolCall(t, result, "write_file")
	fc := harness.AssertFileChange(t, result, filePath,
		agentexecv1.FileChangeType_FILE_CHANGE_TYPE_CREATE,
		agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE)
	require.NotNil(t, fc)

	after := fc.GetAfter()
	require.NotNil(t, after, "a CREATE must carry the new content as after")
	assert.Empty(t, after.GetInline(), "an offloaded body must not also be inline")

	ref := after.GetRef()
	require.NotNil(t, ref, "an oversized after body must be offloaded to a ToolCallOutputRef")
	execID := result.GetMetadata().GetId()
	assert.Truef(t, strings.HasPrefix(ref.GetStorageKey(), "artifacts/"),
		"offload storage key %q should live under artifacts/", ref.GetStorageKey())
	assert.Containsf(t, ref.GetStorageKey(), execID,
		"offload storage key %q should be scoped to the execution id %s", ref.GetStorageKey(), execID)
	assert.Greaterf(t, ref.GetSizeBytes(), int64(128*1024),
		"offloaded ref should report the full body size, got %d", ref.GetSizeBytes())
}
