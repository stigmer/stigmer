package workflowexecution

// Step-level tests for the Gap B2 dedupe pipeline steps, backed by a real
// SQLite store. The store itself is unit-tested in the dedupe package; these
// pin the STEP semantics: a DELIVERED holder rejects ALREADY_EXISTS (stop
// retrying) while a live CLAIMED holder rejects ABORTED (in-flight conflict,
// retry shortly — the oss#442 status branch), a failed delivery's released key
// is claimable by the retry (the controller's compensation), the empty-key and
// nil-store paths skip dedupe without failing the request, and distinct keys
// never collide. The conformance suite proves the delivered-duplicate contract
// end-to-end through the wired server.

import (
	"context"
	"testing"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflowexecution/dedupe"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// newSQLiteDedupeStore builds a real SQLite-backed dedupe store on a temp
// database, mirroring how server.Run() wires it off the main store's handle.
func newSQLiteDedupeStore(t *testing.T) dedupe.SignalDedupeStore {
	t.Helper()

	raw, err := sqlite.NewStore(t.TempDir() + "/dedupe-test.sqlite")
	if err != nil {
		t.Fatalf("failed to create sqlite store: %v", err)
	}
	t.Cleanup(func() { _ = raw.Close() })

	dedupeStore, err := dedupe.NewSQLiteSignalDedupeStore(raw.DB())
	if err != nil {
		t.Fatalf("failed to create signal dedupe store: %v", err)
	}
	return dedupeStore
}

// newSignalPipelineContext builds a request context in the state the dedupe
// steps observe in the real pipeline: the input as new state and the loaded
// execution already placed by LoadExecutionByExecutionIdStep.
func newSignalPipelineContext(input *workflowexecutionv1.SendSignalInput) *pipeline.RequestContext[*workflowexecutionv1.SendSignalInput] {
	reqCtx := pipeline.NewRequestContext(context.Background(), input)
	reqCtx.Set(LoadedExecutionKey, &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{
			Id:  input.GetExecutionId(),
			Org: "test-org",
		},
	})
	return reqCtx
}

func TestDedupeClaimStep_DuplicateKeyRejectedWithAlreadyExists(t *testing.T) {
	dedupeStore := newSQLiteDedupeStore(t)
	claim := NewDedupeClaimStep[*workflowexecutionv1.SendSignalInput](dedupeStore)
	markDelivered := NewDedupeMarkDeliveredStep[*workflowexecutionv1.SendSignalInput](dedupeStore)

	input := &workflowexecutionv1.SendSignalInput{
		ExecutionId:    "wfx-dedupe-dup",
		SignalName:     "test-signal",
		IdempotencyKey: "webhook-evt-42",
	}

	// First delivery: claim succeeds and the delivered step completes the cycle.
	first := newSignalPipelineContext(input)
	if err := claim.Execute(first); err != nil {
		t.Fatalf("first claim should succeed: %v", err)
	}
	if claimed, _ := first.Get(DedupeClaimedKey).(bool); !claimed {
		t.Fatal("first claim should set DedupeClaimedKey")
	}
	if err := markDelivered.Execute(first); err != nil {
		t.Fatalf("mark-delivered should succeed after a claim: %v", err)
	}

	// Retry with the same key: rejected with ALREADY_EXISTS, the wire contract
	// both editions share (cloud's DedupeClaimStep returns the same code).
	second := newSignalPipelineContext(input)
	err := claim.Execute(second)
	if err == nil {
		t.Fatal("duplicate idempotency key should be rejected")
	}
	if st, ok := status.FromError(err); !ok || st.Code() != codes.AlreadyExists {
		t.Fatalf("duplicate rejection should be AlreadyExists, got: %v", err)
	}
}

func TestDedupeClaimStep_InFlightKeyRejectedWithAborted(t *testing.T) {
	dedupeStore := newSQLiteDedupeStore(t)
	claim := NewDedupeClaimStep[*workflowexecutionv1.SendSignalInput](dedupeStore)

	input := &workflowexecutionv1.SendSignalInput{
		ExecutionId:    "wfx-dedupe-inflight",
		SignalName:     "test-signal",
		IdempotencyKey: "webhook-evt-inflight",
	}

	// First request claims and is still in flight (not yet delivered).
	if err := claim.Execute(newSignalPipelineContext(input)); err != nil {
		t.Fatalf("first claim should succeed: %v", err)
	}

	// A concurrent same-key request conflicts with the live claim: ABORTED tells
	// it to retry shortly, unlike ALREADY_EXISTS which would tell it to stop
	// (the oss#442 status branch; cloud's DedupeClaimStep returns the same code).
	err := claim.Execute(newSignalPipelineContext(input))
	if err == nil {
		t.Fatal("in-flight idempotency key should be rejected")
	}
	if st, ok := status.FromError(err); !ok || st.Code() != codes.Aborted {
		t.Fatalf("in-flight rejection should be Aborted, got: %v", err)
	}
}

func TestReleaseDedupeClaimAfterFailure_RetryClaimsFreshly(t *testing.T) {
	// The failed-delivery recovery path (oss#442): the send step failed after
	// the claim landed, the controller released the key, and the caller's retry
	// — the exact scenario idempotency keys exist for — claims freshly.
	dedupeStore := newSQLiteDedupeStore(t)
	controller := &WorkflowExecutionController{signalDedupeStore: dedupeStore}
	claim := NewDedupeClaimStep[*workflowexecutionv1.SendSignalInput](dedupeStore)

	input := &workflowexecutionv1.SendSignalInput{
		ExecutionId:    "wfx-dedupe-release",
		SignalName:     "test-signal",
		IdempotencyKey: "webhook-evt-failed",
	}

	// The failed attempt: claim lands, then the pipeline fails at the send.
	failed := newSignalPipelineContext(input)
	if err := claim.Execute(failed); err != nil {
		t.Fatalf("claim should succeed: %v", err)
	}
	controller.releaseDedupeClaimAfterFailure(context.Background(), failed, input)

	// The retry is not a duplicate.
	if err := claim.Execute(newSignalPipelineContext(input)); err != nil {
		t.Fatalf("retry after a released claim should claim freshly, got: %v", err)
	}
}

func TestReleaseDedupeClaimAfterFailure_NoClaimIsNoOp(t *testing.T) {
	// A pipeline failure before (or without) a claim must not touch the store —
	// including the nil-store degradation, where reaching Release would panic.
	controller := &WorkflowExecutionController{signalDedupeStore: nil}

	input := &workflowexecutionv1.SendSignalInput{
		ExecutionId: "wfx-dedupe-noclaim",
		SignalName:  "test-signal",
	}

	// No claim step ran: DedupeClaimedKey is unset.
	controller.releaseDedupeClaimAfterFailure(context.Background(), newSignalPipelineContext(input), input)
}

func TestDedupeClaimStep_EmptyKeySkipsDedupe(t *testing.T) {
	dedupeStore := newSQLiteDedupeStore(t)
	claim := NewDedupeClaimStep[*workflowexecutionv1.SendSignalInput](dedupeStore)
	markDelivered := NewDedupeMarkDeliveredStep[*workflowexecutionv1.SendSignalInput](dedupeStore)

	input := &workflowexecutionv1.SendSignalInput{
		ExecutionId: "wfx-dedupe-nokey",
		SignalName:  "test-signal",
		// No idempotency key: dedupe must not engage (backward compatible).
	}

	reqCtx := newSignalPipelineContext(input)
	if err := claim.Execute(reqCtx); err != nil {
		t.Fatalf("claim with empty key should succeed as a skip: %v", err)
	}
	if skipped, _ := reqCtx.Get(DedupeSkippedKey).(bool); !skipped {
		t.Fatal("empty key should set DedupeSkippedKey")
	}
	if claimed, _ := reqCtx.Get(DedupeClaimedKey).(bool); claimed {
		t.Fatal("empty key must not claim anything")
	}
	if err := markDelivered.Execute(reqCtx); err != nil {
		t.Fatalf("mark-delivered should no-op on the skip path: %v", err)
	}

	// Skipping means no record: the same request again is NOT a duplicate.
	if err := claim.Execute(newSignalPipelineContext(input)); err != nil {
		t.Fatalf("repeat with empty key should still pass: %v", err)
	}
}

func TestDedupeClaimStep_NilStoreDegradesGracefully(t *testing.T) {
	// A nil store is the pre-wiring reality and stays the documented graceful
	// degradation: skip dedupe rather than fail the signal.
	claim := NewDedupeClaimStep[*workflowexecutionv1.SendSignalInput](nil)
	markDelivered := NewDedupeMarkDeliveredStep[*workflowexecutionv1.SendSignalInput](nil)

	input := &workflowexecutionv1.SendSignalInput{
		ExecutionId:    "wfx-dedupe-nilstore",
		SignalName:     "test-signal",
		IdempotencyKey: "key-with-no-store",
	}

	reqCtx := newSignalPipelineContext(input)
	if err := claim.Execute(reqCtx); err != nil {
		t.Fatalf("claim with nil store should skip, not fail: %v", err)
	}
	if skipped, _ := reqCtx.Get(DedupeSkippedKey).(bool); !skipped {
		t.Fatal("nil store should set DedupeSkippedKey")
	}
	if err := markDelivered.Execute(reqCtx); err != nil {
		t.Fatalf("mark-delivered with nil store should no-op: %v", err)
	}
}

func TestDedupeClaimStep_DistinctKeysDoNotCollide(t *testing.T) {
	dedupeStore := newSQLiteDedupeStore(t)
	claim := NewDedupeClaimStep[*workflowexecutionv1.SendSignalInput](dedupeStore)

	for _, key := range []string{"evt-1", "evt-2"} {
		input := &workflowexecutionv1.SendSignalInput{
			ExecutionId:    "wfx-dedupe-distinct",
			SignalName:     "test-signal",
			IdempotencyKey: key,
		}
		reqCtx := newSignalPipelineContext(input)
		if err := claim.Execute(reqCtx); err != nil {
			t.Fatalf("claim for distinct key %q should succeed: %v", key, err)
		}
		if claimed, _ := reqCtx.Get(DedupeClaimedKey).(bool); !claimed {
			t.Fatalf("distinct key %q should be claimed", key)
		}
	}
}
