package harness

import (
	"context"
	"errors"
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc"
)

// Unit tests for the SeedDefaultAgent retry/verify contract (oss#541). No
// service is started — the AgentCommand client is scripted per attempt, the
// seam seedDefaultAgent exists for. The load-bearing pins:
//
//   - an apply that "succeeds" without binding a default instance is an
//     error, because that half-created agent denies every session create
//     in the run (retrying routes to update and converges nothing;
//     service-side contract tracked in stigmer-cloud#385);
//   - a transient apply failure is retried instead of poisoning the run.

// scriptedAgentCommand returns one scripted result per Apply call and
// panics via the embedded nil interface if any other RPC is touched.
type scriptedAgentCommand struct {
	agentv1.AgentCommandControllerClient
	t       testing.TB
	results []scriptedApply
	calls   int
}

type scriptedApply struct {
	agent *agentv1.Agent
	err   error
}

func (s *scriptedAgentCommand) Apply(ctx context.Context, in *agentv1.Agent, opts ...grpc.CallOption) (*agentv1.Agent, error) {
	require.Less(s.t, s.calls, len(s.results), "Apply called more times than scripted")
	res := s.results[s.calls]
	s.calls++
	return res.agent, res.err
}

func healthyAgent() *agentv1.Agent {
	return &agentv1.Agent{Status: &agentv1.AgentStatus{DefaultInstanceId: "agi-default-1"}}
}

func halfCreatedAgent() *agentv1.Agent {
	// The oss#541 shape: the apply response carries the persisted agent but
	// status.default_instance_id was never bound.
	return &agentv1.Agent{Status: &agentv1.AgentStatus{}}
}

func TestSeedDefaultAgent_HealthyApplySeedsFirstTry(t *testing.T) {
	client := &scriptedAgentCommand{t: t, results: []scriptedApply{{agent: healthyAgent()}}}

	err := seedDefaultAgent(context.Background(), client, 0)

	require.NoError(t, err)
	assert.Equal(t, 1, client.calls)
}

func TestSeedDefaultAgent_HalfCreatedAgentIsAnError(t *testing.T) {
	client := &scriptedAgentCommand{t: t, results: []scriptedApply{{agent: halfCreatedAgent()}}}

	err := seedDefaultAgent(context.Background(), client, 0)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "no default instance bound")
	// No retry: a repeated apply routes to update and cannot heal this state.
	assert.Equal(t, 1, client.calls)
}

func TestSeedDefaultAgent_RetriesTransientFailure(t *testing.T) {
	client := &scriptedAgentCommand{t: t, results: []scriptedApply{
		{err: errors.New("connection refused")},
		{agent: healthyAgent()},
	}}

	err := seedDefaultAgent(context.Background(), client, 0)

	require.NoError(t, err)
	assert.Equal(t, 2, client.calls)
}

func TestSeedDefaultAgent_GivesUpAfterBoundedAttempts(t *testing.T) {
	transient := errors.New("connection refused")
	client := &scriptedAgentCommand{t: t, results: []scriptedApply{
		{err: transient}, {err: transient}, {err: transient},
	}}

	err := seedDefaultAgent(context.Background(), client, 0)

	require.Error(t, err)
	require.ErrorIs(t, err, transient)
	assert.Equal(t, seedDefaultAgentAttempts, client.calls)
	assert.True(t, strings.Contains(err.Error(), "attempt 3/3"), "error should carry the final attempt count: %v", err)
}
