//go:build integration

package integration

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	agentexecv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func isTerminalPhase(phase agentexecv1.ExecutionPhase) bool {
	switch phase {
	case agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
		agentexecv1.ExecutionPhase_EXECUTION_FAILED,
		agentexecv1.ExecutionPhase_EXECUTION_CANCELLED,
		agentexecv1.ExecutionPhase_EXECUTION_TERMINATED:
		return true
	default:
		return false
	}
}

// Proto contract under test:
//
//	subscribe(AgentExecutionId) returns (stream AgentExecution)
//
// Verifies: the Subscribe stream delivers phase progression events ending
// in a terminal phase. This is the primary data path for the web console's
// real-time execution viewer (useExecutionStream hook in @stigmer/react).
//
// The stream MUST be broken client-side on terminal phase — the server
// does not auto-close on TERMINATED and does not close when the initial
// snapshot is already terminal (AD-C2).
func TestAgentExecution_Subscribe_DeliversPhaseProgression(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-subscribe-phase-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Reply with exactly: streaming-test")

			executionID := exec.GetMetadata().GetId()

			streamCtx, streamCancel := context.WithTimeout(ctx, 3*time.Minute)
			defer streamCancel()

			stream, err := clients.AgentExecutionQuery.Subscribe(streamCtx,
				&agentexecv1.AgentExecutionId{Value: executionID})
			require.NoError(t, err, "subscribe should succeed for execution %s", executionID)

			type streamResult struct {
				snapshots []*agentexecv1.AgentExecution
				err       error
			}

			resultCh := make(chan streamResult, 1)
			go func() {
				var snapshots []*agentexecv1.AgentExecution
				for {
					snap, recvErr := stream.Recv()
					if recvErr != nil {
						if errors.Is(recvErr, io.EOF) {
							resultCh <- streamResult{snapshots: snapshots}
						} else if streamCtx.Err() != nil {
							resultCh <- streamResult{snapshots: snapshots, err: streamCtx.Err()}
						} else {
							resultCh <- streamResult{snapshots: snapshots, err: recvErr}
						}
						return
					}

					snapshots = append(snapshots, snap)
					phase := snap.GetStatus().GetPhase()

					if isTerminalPhase(phase) {
						resultCh <- streamResult{snapshots: snapshots}
						return
					}
				}
			}()

			sr := <-resultCh
			streamCancel()

			if sr.err != nil {
				harness.LogExecutionMessages(t, ctx, clients, executionID)
				require.NoError(t, sr.err, "stream should not error for execution %s", executionID)
			}

			require.GreaterOrEqual(t, len(sr.snapshots), 2,
				"stream should deliver at least 2 events (shows progression, not just final state) for execution %s",
				executionID)

			lastSnapshot := sr.snapshots[len(sr.snapshots)-1]
			lastPhase := lastSnapshot.GetStatus().GetPhase()
			assert.True(t, isTerminalPhase(lastPhase),
				"last stream event should be a terminal phase, got %s for execution %s",
				lastPhase.String(), executionID)

			for i := 1; i < len(sr.snapshots); i++ {
				prevPhase := sr.snapshots[i-1].GetStatus().GetPhase()
				currPhase := sr.snapshots[i].GetStatus().GetPhase()
				if isTerminalPhase(prevPhase) && !isTerminalPhase(currPhase) {
					t.Errorf("phase regression at event %d: %s → %s (terminal should not revert to non-terminal) for execution %s",
						i, prevPhase.String(), currPhase.String(), executionID)
				}
			}

			phases := make([]string, len(sr.snapshots))
			for i, snap := range sr.snapshots {
				phases[i] = snap.GetStatus().GetPhase().String()
			}
			t.Logf("subscribe phase progression: execution=%s, events=%d, phases=%v",
				executionID, len(sr.snapshots), phases)
		})
	}
}

// Verifies: subscribing to an already-completed execution returns the
// initial MongoDB snapshot with terminal phase and populated messages.
//
// The Java SubscribeHandler always sends an initial DB snapshot, then
// blocks in Redis XREADGROUP waiting for new messages. For a terminal
// execution, no new messages arrive, so the stream hangs after the first
// event. The test breaks client-side after receiving the snapshot (AD-C2).
func TestAgentExecution_Subscribe_TerminalExecution_ReturnsSnapshot(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	for _, h := range harness.Harnesses {
		t.Run(h.Name, func(t *testing.T) {
			h.Skip(t, testHarness)

			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
			defer cancel()

			clients := harness.NewClients(grpcConn)
			harness.RequireServiceHealthy(t, ctx, clients)

			agent := harness.CreateAgent(t, ctx, clients, "test-subscribe-terminal-"+h.Name,
				"You are a helpful assistant. Respond briefly.")

			session := harness.CreateTestSession(t, ctx, clients,
				agent.GetStatus().GetDefaultInstanceId(), h.Harness)

			exec := harness.CreateTestAgentExecution(t, ctx, clients,
				session.GetMetadata().GetId(),
				"Reply with exactly: snapshot-test")

			executionID := exec.GetMetadata().GetId()
			waiter := harness.NewAgentExecutionWaiter(clients.AgentExecutionQuery, suiteLogger)

			_, err := waiter.WaitForPhase(ctx, executionID,
				agentexecv1.ExecutionPhase_EXECUTION_COMPLETED, 4*time.Minute)
			require.NoError(t, err, "execution %s should complete before subscribe", executionID)

			// Subscribe AFTER completion — the "late subscriber" case.
			// Use a short timeout: the initial snapshot should arrive quickly.
			// Do NOT call Recv() a second time — it will hang because no
			// new Redis messages arrive for a terminal execution.
			streamCtx, streamCancel := context.WithTimeout(ctx, 15*time.Second)
			defer streamCancel()

			stream, err := clients.AgentExecutionQuery.Subscribe(streamCtx,
				&agentexecv1.AgentExecutionId{Value: executionID})
			require.NoError(t, err, "subscribe on terminal execution %s should succeed", executionID)

			snapshot, err := stream.Recv()
			streamCancel()

			require.NoError(t, err,
				"first Recv on terminal execution %s should return the DB snapshot", executionID)
			require.NotNil(t, snapshot, "snapshot should not be nil")

			assert.Equal(t, agentexecv1.ExecutionPhase_EXECUTION_COMPLETED,
				snapshot.GetStatus().GetPhase(),
				"snapshot phase should be COMPLETED for execution %s", executionID)

			assert.Greater(t, len(snapshot.GetStatus().GetMessages()), 0,
				"snapshot messages should be non-empty (not a skeleton) for execution %s",
				executionID)

			assert.Equal(t, executionID, snapshot.GetMetadata().GetId(),
				"snapshot metadata.id should match the subscribed execution ID")

			t.Logf("terminal subscribe snapshot verified: execution=%s, phase=%s, messages=%d",
				executionID, snapshot.GetStatus().GetPhase().String(),
				len(snapshot.GetStatus().GetMessages()))
		})
	}
}
