package workflowexecution

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	agentexecutioncontroller "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/controller"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/filereview"
)

// This is the Slice-5 offline guard for workflow-parent file review: it wires the
// REAL WorkflowExecutionController.SubmitFileDecision to the REAL
// AgentExecutionController (as the file-decision client), against a real SQLite
// store holding a real child agent execution gated on file review. It proves the
// full forward round-trip end to end without Temporal or the runner: the parent
// decision reaches the child handler, passes the child's completeness + digest
// gates, records the decision, and clears the child's unified HITL gate. The
// per-edition unit tests (submit_file_decision_test.go, the Java handler test)
// cover the routing/validation branches with a mock; this proves the two real
// controllers compose.

const (
	itAggregateDigest = "sha256:aggregate-abc"
	itChangeSetID     = "fcs_int_1"
	itChildID         = "aex_int_child"
	itParentID        = "wfx_int_parent"
)

func agentExecutionKindCtx() context.Context {
	return context.Background()
}

// seedChildGatedOnFileReview persists a child AgentExecution whose file-review
// ledger projects to a single AWAITING_REVIEW, COMPLETE change set with a known
// aggregate digest — the minimal shape the CHANGE_SET completeness + digest gates
// accept.
func seedChildGatedOnFileReview(t *testing.T, s store.Store) {
	t.Helper()
	stream := &agentexecutionv1.FileReviewEventStream{
		ExecutionId: itChildID,
		Events: []*agentexecutionv1.FileReviewEvent{
			{
				EventId:     "ev-baseline",
				ChangeSetId: itChangeSetID,
				EventType:   agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED,
				Payload: &agentexecutionv1.FileReviewEvent_BaselineCaptured{
					BaselineCaptured: &agentexecutionv1.FileReviewBaselineCaptured{
						ChangeSetId: itChangeSetID,
						TurnId:      "turn-1",
						HarnessId:   "native",
					},
				},
			},
			{
				EventId:     "ev-candidate",
				ChangeSetId: itChangeSetID,
				EventType:   agentexecutionv1.FileReviewEventType_FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED,
				Payload: &agentexecutionv1.FileReviewEvent_CandidateCaptured{
					CandidateCaptured: &agentexecutionv1.FileReviewCandidateCaptured{
						ChangeSetId:      itChangeSetID,
						AggregateDigest:  itAggregateDigest,
						DiffCompleteness: agentexecutionv1.DiffCompleteness_DIFF_COMPLETENESS_COMPLETE,
						Changes: []*agentexecutionv1.CapturedFileChange{
							{Id: "fc1", DiffComplete: true},
						},
					},
				},
			},
		},
	}
	// Populate BOTH the durable ledger and the stored projection, exactly as a
	// production status write does: SubmitFileDecision validates from the ledger,
	// but the unified HITL gate (GateResolved) reads the stored file_change_sets.
	phase := agentexecutionv1.ExecutionPhase_EXECUTION_WAITING_FOR_APPROVAL
	child := &agentexecutionv1.AgentExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentExecution",
		Metadata:   &apiresource.ApiResourceMetadata{Id: itChildID, Name: "int-child", Org: "test-org"},
		Status: &agentexecutionv1.AgentExecutionStatus{
			Phase:                 phase,
			FileReviewEventStream: stream,
			FileChangeSets:        filereview.ProjectFileChangeSets(phase, stream),
		},
	}
	require.NoError(t, s.SaveResource(agentExecutionKindCtx(), apiresourcekind.ApiResourceKind_agent_execution, itChildID, child))
}

// seedParentWithFileReviewReference persists a parent WorkflowExecution whose
// status surfaces the child's change set as a reference (as call-agent-status
// would via the poll-derive path).
func seedParentWithFileReviewReference(t *testing.T, s store.Store) {
	t.Helper()
	parent := &workflowexecutionv1.WorkflowExecution{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowExecution",
		Metadata:   &apiresource.ApiResourceMetadata{Id: itParentID, Name: "int-parent", Org: "test-org"},
		Status: &workflowexecutionv1.WorkflowExecutionStatus{
			Phase: workflowexecutionv1.ExecutionPhase_EXECUTION_IN_PROGRESS,
			PendingFileReviews: []*workflowexecutionv1.WorkflowPendingFileReview{
				{ChildAgentExecutionId: itChildID, ChangeSetId: []string{itChangeSetID}},
			},
		},
	}
	require.NoError(t, s.SaveResource(contextWithWorkflowExecutionKind(), apiresourcekind.ApiResourceKind_workflow_execution, itParentID, parent))
}

func newWiredControllers(t *testing.T) (*WorkflowExecutionController, store.Store) {
	t.Helper()
	s, err := sqlite.NewStore(t.TempDir() + "/it.sqlite")
	require.NoError(t, err)

	// Real agent controller (nil optional clients + no workflow creator → the
	// Temporal signal step skips, which is exactly what an offline test needs).
	agentCtrl := agentexecutioncontroller.NewAgentExecutionController(s, nil, nil, nil)

	wfCtrl := NewWorkflowExecutionController(s, nil)
	wfCtrl.SetAgentExecutionFileDecisionClient(agentCtrl)

	return wfCtrl, s
}

func TestSubmitFileDecision_RealForward_ApproveRecordsDecisionOnChild(t *testing.T) {
	wfCtrl, s := newWiredControllers(t)
	defer s.Close()

	seedChildGatedOnFileReview(t, s)
	seedParentWithFileReviewReference(t, s)

	// Sanity: the child starts gated (AWAITING_REVIEW, gate unresolved).
	before := loadChild(t, s)
	beforeSets := filereview.ProjectFileChangeSets(before.Status.GetPhase(), before.Status.GetFileReviewEventStream())
	require.Len(t, beforeSets, 1)
	require.Equal(t, agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW, beforeSets[0].GetStatus())
	require.False(t, filereview.GateResolved(before.Status))

	_, err := wfCtrl.SubmitFileDecision(context.Background(), &workflowexecutionv1.SubmitWorkflowFileDecisionInput{
		ExecutionId:           itParentID,
		ChildAgentExecutionId: itChildID,
		ChangeSetId:           itChangeSetID,
		Scope:                 agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		Action:                agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:        itAggregateDigest,
	})
	require.NoError(t, err)

	// The real forward reached the real child handler: the decision is recorded,
	// the change set is DECIDED, and the child's unified HITL gate is now clear.
	after := loadChild(t, s)
	afterSets := filereview.ProjectFileChangeSets(after.Status.GetPhase(), after.Status.GetFileReviewEventStream())
	require.Len(t, afterSets, 1)
	assert.Equal(t, agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_DECIDED, afterSets[0].GetStatus())
	assert.True(t, filereview.GateResolved(after.Status), "child HITL gate must be resolved after the forwarded approval")
}

func TestSubmitFileDecision_RealForward_DigestMismatchPropagates(t *testing.T) {
	wfCtrl, s := newWiredControllers(t)
	defer s.Close()

	seedChildGatedOnFileReview(t, s)
	seedParentWithFileReviewReference(t, s)

	// A stale/incorrect expected digest must be rejected by the child's digest
	// gate, and that INVALID_ARGUMENT must propagate through the workflow forward.
	_, err := wfCtrl.SubmitFileDecision(context.Background(), &workflowexecutionv1.SubmitWorkflowFileDecisionInput{
		ExecutionId:           itParentID,
		ChildAgentExecutionId: itChildID,
		ChangeSetId:           itChangeSetID,
		Scope:                 agentexecutionv1.FileDecisionScope_FILE_DECISION_SCOPE_CHANGE_SET,
		Action:                agentexecutionv1.FileDecisionAction_FILE_DECISION_ACTION_APPROVE,
		ExpectedDigest:        "sha256:stale-does-not-match",
	})
	require.Error(t, err)
	assert.Equal(t, codes.InvalidArgument, status.Code(err), "child digest gate must surface as INVALID_ARGUMENT")

	// The child stays gated — a rejected decision changes nothing.
	after := loadChild(t, s)
	afterSets := filereview.ProjectFileChangeSets(after.Status.GetPhase(), after.Status.GetFileReviewEventStream())
	require.Len(t, afterSets, 1)
	assert.Equal(t, agentexecutionv1.FileChangeSetStatus_FILE_CHANGE_SET_STATUS_AWAITING_REVIEW, afterSets[0].GetStatus())
	assert.False(t, filereview.GateResolved(after.Status))
}

func loadChild(t *testing.T, s store.Store) *agentexecutionv1.AgentExecution {
	t.Helper()
	child := &agentexecutionv1.AgentExecution{}
	require.NoError(t, s.GetResource(agentExecutionKindCtx(), apiresourcekind.ApiResourceKind_agent_execution, itChildID, child))
	return child
}
