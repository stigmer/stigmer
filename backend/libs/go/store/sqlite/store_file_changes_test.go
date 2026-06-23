package sqlite

import (
	"context"
	"path/filepath"
	"testing"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourcelib "github.com/stigmer/stigmer/backend/libs/go/apiresource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"
)

// TestStore_AgentExecution_FileChangesRoundTrip is the Phase 1 contract lock for
// ToolCall.file_changes (#186) on the OSS persistence path.
//
// The Go control plane stores AgentExecutionStatus as an opaque proto blob:
// SaveResource does proto.Marshal into a SQLite column and GetResource does
// proto.Unmarshal back (see store.go). That is the exact path UpdateStatus and
// Subscribe/Get ride on, so this test marshals a ToolCall carrying file_changes
// through it and asserts byte-for-byte survival. It guards the new
// FileChange/FileContent contract — the FileContent oneof (inline vs offloaded
// ref), the int64 size, the enums, and the repeated cardinality — against
// accidental drops during stub regen or store changes. Deterministic: no runner,
// no network, isolated temp DB.
func TestStore_AgentExecution_FileChangesRoundTrip(t *testing.T) {
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.sqlite")
	s, err := NewStore(dbPath)
	require.NoError(t, err)
	defer s.Close()

	kindNameStr, err := apiresourcelib.GetKindName(apiresourcekind.ApiResourceKind_agent_execution)
	require.NoError(t, err)

	ctx := context.Background()

	exec := &agentexecv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       kindNameStr,
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   "aex-file-changes-roundtrip",
			Name: "file-changes-roundtrip",
			Org:  "test-org",
		},
		Status: &agentexecv1.AgentExecutionStatus{
			Phase: agentexecv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			Messages: []*agentexecv1.AgentMessage{
				{
					Type:    agentexecv1.MessageType_MESSAGE_AI,
					Content: "editing files",
					ToolCalls: []*agentexecv1.ToolCall{
						{
							Id:   "tc1",
							Name: "StrReplace",
							FileChanges: []*agentexecv1.FileChange{
								// Whole-file MODIFY with inline before/after (oneof: inline arm).
								{
									Path:         "src/app/main.ts",
									AbsolutePath: "/workspace/src/app/main.ts",
									ChangeType:   agentexecv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY,
									CaptureLevel: agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE,
									Before:       &agentexecv1.FileContent{Body: &agentexecv1.FileContent_Inline{Inline: "line1\nline2\n"}},
									After:        &agentexecv1.FileContent{Body: &agentexecv1.FileContent_Inline{Inline: "line1\nline2 changed\n"}},
									UnifiedDiff:  "@@ -1,2 +1,2 @@\n line1\n-line2\n+line2 changed\n",
									LinesAdded:   1,
									LinesRemoved: 1,
								},
								// Offloaded after-content (oneof: ref arm) + binary flag + int64 size.
								{
									Path:         "assets/logo.bin",
									AbsolutePath: "/workspace/assets/logo.bin",
									ChangeType:   agentexecv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY,
									CaptureLevel: agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE,
									After: &agentexecv1.FileContent{
										Body: &agentexecv1.FileContent_Ref{Ref: &agentexecv1.ToolCallOutputRef{
											StorageKey:       "artifacts/aex-file-changes-roundtrip/toolcalls/tc1.1.after.txt",
											SizeBytes:        1_572_864,
											ContentHash:      "sha256:deadbeef",
											MimeType:         "text/plain",
											TruncatedPreview: "head of the offloaded content",
										}},
										IsBinary: true,
									},
								},
								// Rename (rename_from set; hunk-only capture).
								{
									Path:         "src/new/name.ts",
									AbsolutePath: "/workspace/src/new/name.ts",
									ChangeType:   agentexecv1.FileChangeType_FILE_CHANGE_TYPE_RENAME,
									CaptureLevel: agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_HUNK_ONLY,
									RenameFrom:   "src/old/name.ts",
								},
							},
						},
					},
				},
			},
		},
	}

	require.NoError(t, s.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, exec.Metadata.Id, exec))

	retrieved := &agentexecv1.AgentExecution{}
	require.NoError(t, s.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, exec.Metadata.Id, retrieved))

	// Strongest assertion: the whole execution survives the persist round-trip.
	assert.True(t, proto.Equal(exec, retrieved),
		"AgentExecution must survive the SQLite proto round-trip unchanged")

	// Targeted assertions so a regression points straight at the broken field.
	changes := retrieved.GetStatus().GetMessages()[0].GetToolCalls()[0].GetFileChanges()
	require.Len(t, changes, 3, "all three file changes must survive")

	modify := changes[0]
	assert.Equal(t, agentexecv1.FileChangeType_FILE_CHANGE_TYPE_MODIFY, modify.GetChangeType())
	assert.Equal(t, agentexecv1.FileChangeCaptureLevel_FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE, modify.GetCaptureLevel())
	assert.Equal(t, "line1\nline2\n", modify.GetBefore().GetInline(), "inline oneof arm (before) must survive")
	assert.Equal(t, "line1\nline2 changed\n", modify.GetAfter().GetInline(), "inline oneof arm (after) must survive")
	assert.Equal(t, int32(1), modify.GetLinesAdded())
	assert.Equal(t, int32(1), modify.GetLinesRemoved())

	offloaded := changes[1]
	ref := offloaded.GetAfter().GetRef()
	require.NotNil(t, ref, "ref oneof arm must survive for the offloaded side")
	assert.Equal(t, "artifacts/aex-file-changes-roundtrip/toolcalls/tc1.1.after.txt", ref.GetStorageKey())
	assert.Equal(t, int64(1_572_864), ref.GetSizeBytes(), "int64 size must survive")
	assert.Equal(t, "sha256:deadbeef", ref.GetContentHash())
	assert.True(t, offloaded.GetAfter().GetIsBinary())
	assert.Empty(t, offloaded.GetAfter().GetInline(), "inline arm must be empty when ref arm is set")

	rename := changes[2]
	assert.Equal(t, agentexecv1.FileChangeType_FILE_CHANGE_TYPE_RENAME, rename.GetChangeType())
	assert.Equal(t, "src/old/name.ts", rename.GetRenameFrom())
	assert.Equal(t, "src/new/name.ts", rename.GetPath())
}
