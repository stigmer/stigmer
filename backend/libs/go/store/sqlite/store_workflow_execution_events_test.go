package sqlite

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"

	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// =============================================================================
// Workflow Execution Event Log Tests
//
// Pins the insert-or-skip, first-writer-wins append contract (oss#308):
// an already-persisted (execution_id, sequence_number) is silently
// skipped, the rest of the batch lands, and the returned count reflects
// only actual inserts. This is what makes the runner's whole-batch
// retries idempotent, and it mirrors the cloud edition's
// WorkflowExecutionEventRepoContractTest semantics so the editions
// cannot drift apart again.
// =============================================================================

func newEventTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := NewStore(filepath.Join(t.TempDir(), "test.sqlite"))
	require.NoError(t, err)
	t.Cleanup(func() { s.Close() })
	return s
}

func eventRecord(executionID string, seq int64) *store.WorkflowExecutionEventRecord {
	return &store.WorkflowExecutionEventRecord{
		ExecutionID:    executionID,
		SequenceNumber: seq,
		EventType:      "task_started",
		TaskName:       fmt.Sprintf("task-%d", seq),
		Data:           []byte(fmt.Sprintf("payload-%d", seq)),
	}
}

func eventRecords(executionID string, seqs ...int64) []*store.WorkflowExecutionEventRecord {
	records := make([]*store.WorkflowExecutionEventRecord, 0, len(seqs))
	for _, seq := range seqs {
		records = append(records, eventRecord(executionID, seq))
	}
	return records
}

func persistedSequences(t *testing.T, s *Store, executionID string) []int64 {
	t.Helper()
	events, err := s.GetWorkflowExecutionEvents(context.Background(), executionID, 0, "", "", 0)
	require.NoError(t, err)
	seqs := make([]int64, 0, len(events))
	for _, evt := range events {
		seqs = append(seqs, evt.SequenceNumber)
	}
	return seqs
}

func TestStore_AppendWorkflowExecutionEvents_FreshBatch(t *testing.T) {
	s := newEventTestStore(t)
	ctx := context.Background()

	appended, err := s.AppendWorkflowExecutionEvents(ctx, "wfx-1", eventRecords("wfx-1", 1, 2, 3))
	require.NoError(t, err)
	assert.Equal(t, 3, appended)
	assert.Equal(t, []int64{1, 2, 3}, persistedSequences(t, s, "wfx-1"))
}

func TestStore_AppendWorkflowExecutionEvents_EmptyBatch(t *testing.T) {
	s := newEventTestStore(t)

	appended, err := s.AppendWorkflowExecutionEvents(context.Background(), "wfx-1", nil)
	require.NoError(t, err)
	assert.Equal(t, 0, appended)
}

// A retried batch re-sends identical sequence numbers (the runner assigns
// them deterministically in the workflow). Every row must be skipped, not
// rejected — and definitely not duplicated.
func TestStore_AppendWorkflowExecutionEvents_ExactDuplicateBatchIsIdempotent(t *testing.T) {
	s := newEventTestStore(t)
	ctx := context.Background()
	batch := eventRecords("wfx-1", 1, 2, 3)

	appended, err := s.AppendWorkflowExecutionEvents(ctx, "wfx-1", batch)
	require.NoError(t, err)
	require.Equal(t, 3, appended)

	appended, err = s.AppendWorkflowExecutionEvents(ctx, "wfx-1", batch)
	require.NoError(t, err)
	assert.Equal(t, 0, appended)
	assert.Equal(t, []int64{1, 2, 3}, persistedSequences(t, s, "wfx-1"))
}

// The oss#308 scenario: an RPC that persisted events but failed before the
// runner saw the response is retried with a batch whose prefix is already
// stored. The unstored suffix must land instead of the whole batch being
// rejected and silently lost.
func TestStore_AppendWorkflowExecutionEvents_PartialOverlapAppendsSuffix(t *testing.T) {
	s := newEventTestStore(t)
	ctx := context.Background()

	appended, err := s.AppendWorkflowExecutionEvents(ctx, "wfx-1", eventRecords("wfx-1", 1, 2))
	require.NoError(t, err)
	require.Equal(t, 2, appended)

	appended, err = s.AppendWorkflowExecutionEvents(ctx, "wfx-1", eventRecords("wfx-1", 1, 2, 3, 4))
	require.NoError(t, err)
	assert.Equal(t, 2, appended)
	assert.Equal(t, []int64{1, 2, 3, 4}, persistedSequences(t, s, "wfx-1"))
}

// First-writer-wins: a duplicate sequence with different content does not
// overwrite the persisted row.
func TestStore_AppendWorkflowExecutionEvents_DuplicateKeepsFirstWriterContent(t *testing.T) {
	s := newEventTestStore(t)
	ctx := context.Background()

	first := eventRecord("wfx-1", 1)
	first.Data = []byte("first-writer")
	_, err := s.AppendWorkflowExecutionEvents(ctx, "wfx-1", []*store.WorkflowExecutionEventRecord{first})
	require.NoError(t, err)

	second := eventRecord("wfx-1", 1)
	second.Data = []byte("second-writer")
	appended, err := s.AppendWorkflowExecutionEvents(ctx, "wfx-1", []*store.WorkflowExecutionEventRecord{second})
	require.NoError(t, err)
	assert.Equal(t, 0, appended)

	events, err := s.GetWorkflowExecutionEvents(ctx, "wfx-1", 0, "", "", 0)
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, []byte("first-writer"), events[0].Data)
}

// Parallel branches (fork) can deliver a lower sequence after a higher one
// already landed. A late-but-new sequence is valid, not stale.
func TestStore_AppendWorkflowExecutionEvents_OutOfOrderArrivalAppends(t *testing.T) {
	s := newEventTestStore(t)
	ctx := context.Background()

	appended, err := s.AppendWorkflowExecutionEvents(ctx, "wfx-1", eventRecords("wfx-1", 5))
	require.NoError(t, err)
	require.Equal(t, 1, appended)

	appended, err = s.AppendWorkflowExecutionEvents(ctx, "wfx-1", eventRecords("wfx-1", 4))
	require.NoError(t, err)
	assert.Equal(t, 1, appended)
	assert.Equal(t, []int64{4, 5}, persistedSequences(t, s, "wfx-1"))
}

// Sequence numbers are namespaced per execution: identical sequences in
// different executions never collide.
func TestStore_AppendWorkflowExecutionEvents_ExecutionsAreIndependent(t *testing.T) {
	s := newEventTestStore(t)
	ctx := context.Background()

	appended, err := s.AppendWorkflowExecutionEvents(ctx, "wfx-a", eventRecords("wfx-a", 1, 2))
	require.NoError(t, err)
	require.Equal(t, 2, appended)

	appended, err = s.AppendWorkflowExecutionEvents(ctx, "wfx-b", eventRecords("wfx-b", 1, 2))
	require.NoError(t, err)
	assert.Equal(t, 2, appended)

	assert.Equal(t, []int64{1, 2}, persistedSequences(t, s, "wfx-a"))
	assert.Equal(t, []int64{1, 2}, persistedSequences(t, s, "wfx-b"))
}

func TestStore_GetMaxEventSequence(t *testing.T) {
	s := newEventTestStore(t)
	ctx := context.Background()

	maxSeq, err := s.GetMaxEventSequence(ctx, "wfx-1")
	require.NoError(t, err)
	assert.Equal(t, int64(0), maxSeq)

	_, err = s.AppendWorkflowExecutionEvents(ctx, "wfx-1", eventRecords("wfx-1", 1, 2, 7))
	require.NoError(t, err)

	maxSeq, err = s.GetMaxEventSequence(ctx, "wfx-1")
	require.NoError(t, err)
	assert.Equal(t, int64(7), maxSeq)
}
