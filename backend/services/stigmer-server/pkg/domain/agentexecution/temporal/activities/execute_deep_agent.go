package activities

import (
	"time"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"go.temporal.io/sdk/temporal"
	"go.temporal.io/sdk/workflow"
)

// RunnerActivityResult wraps the slim AgentExecutionStatus returned by TS
// runner activities with additional fields for structured output extraction.
//
// The TS runner returns a plain JSON object containing the proto-JSON fields
// of AgentExecutionStatus (phase, error, pendingApprovals, etc.) plus
// optional non-proto fields (structured_output, final_text) that carry
// extracted structured data from the agent's response.
//
// Using map[string]interface{} preserves all fields — proto and non-proto —
// across the Temporal data converter boundary.
type RunnerActivityResult = map[string]interface{}

// GetPhaseFromResult extracts the execution phase from a runner activity result.
// Returns UNSPECIFIED if the phase field is missing or unparseable.
func GetPhaseFromResult(result RunnerActivityResult) agentexecutionv1.ExecutionPhase {
	if result == nil {
		return agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED
	}

	phaseVal, ok := result["phase"]
	if !ok {
		return agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED
	}

	// Protobuf JSON serialization uses string enum names
	if phaseStr, ok := phaseVal.(string); ok {
		if enumVal, ok := agentexecutionv1.ExecutionPhase_value[phaseStr]; ok {
			return agentexecutionv1.ExecutionPhase(enumVal)
		}
	}

	// Fallback: numeric enum value
	if phaseNum, ok := phaseVal.(float64); ok {
		return agentexecutionv1.ExecutionPhase(int32(phaseNum))
	}

	return agentexecutionv1.ExecutionPhase_EXECUTION_PHASE_UNSPECIFIED
}

// GetErrorFromResult extracts the error string from a runner activity result.
func GetErrorFromResult(result RunnerActivityResult) string {
	if result == nil {
		return ""
	}
	if errVal, ok := result["error"]; ok {
		if errStr, ok := errVal.(string); ok {
			return errStr
		}
	}
	return ""
}

// ExecuteDeepAgentActivity is the interface for executing native deep agents.
//
// Returns RunnerActivityResult (map[string]interface{}) to preserve both
// proto fields (phase, pendingApprovals) and non-proto fields
// (structured_output, final_text) from the TS runner.
// ExecuteDeepAgentActivityInput is the typed input for the ExecuteDeepAgent
// activity.
//
// Same one-wire-shape contract as ExecuteCursorActivityInput: a single
// serializable object with snake_case JSON keys shared by the Go and Java
// control planes and the TypeScript runner. The JSON keys MUST stay
// byte-identical across all three editions.
type ExecuteDeepAgentActivityInput struct {
	// ExecutionID is the agent execution being run.
	ExecutionID string `json:"execution_id"`
	// ThreadID is the LangGraph thread id; empty on first run.
	ThreadID string `json:"thread_id"`
	// InvokerIdentityAccountID is carried for parity with the Java edition; the
	// runner hydrates the invoker from the DB and does not read this field.
	InvokerIdentityAccountID string `json:"invoker_identity_account_id"`
	// TurnSeq is the monotonic HITL-cycle index within this execution: 0 on the
	// first invocation, then the workflow's approvalCycle on each reinvocation.
	// Additive parity with the Cursor input; the deep-agent harness producer
	// consumes it in a later phase. See the file-change HITL redesign.
	TurnSeq int64 `json:"turn_seq"`
}

type ExecuteDeepAgentActivity interface {
	ExecuteDeepAgent(input ExecuteDeepAgentActivityInput) (RunnerActivityResult, error)
}

// ExecuteDeepAgentActivityName is the activity name used for Temporal registration.
// This MUST match the TypeScript unified runner activity name exactly.
const ExecuteDeepAgentActivityName = "ExecuteDeepAgent"

// NewExecuteDeepAgentActivityStub creates an activity stub for calling ExecuteDeepAgent from workflows.
func NewExecuteDeepAgentActivityStub(ctx workflow.Context, taskQueue string) ExecuteDeepAgentActivity {
	options := workflow.ActivityOptions{
		TaskQueue:              taskQueue,
		StartToCloseTimeout:    24 * time.Hour,
		ScheduleToStartTimeout: 5 * time.Minute,
		HeartbeatTimeout:       2 * time.Minute,
		RetryPolicy: &temporal.RetryPolicy{
			MaximumAttempts:    1,
			InitialInterval:    10 * time.Second,
			BackoffCoefficient: 2.0,
		},
	}

	ctx = workflow.WithActivityOptions(ctx, options)

	return &executeDeepAgentActivityStub{ctx: ctx}
}

type executeDeepAgentActivityStub struct {
	ctx workflow.Context
}

func (s *executeDeepAgentActivityStub) ExecuteDeepAgent(input ExecuteDeepAgentActivityInput) (RunnerActivityResult, error) {
	var result RunnerActivityResult
	err := workflow.ExecuteActivity(s.ctx, ExecuteDeepAgentActivityName, input).Get(s.ctx, &result)
	return result, err
}
