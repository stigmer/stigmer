package workflows

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInvokeAgentExecutionWorkflowInput_JSONRoundTrip(t *testing.T) {
	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID:     "exec_123",
		SessionID:       "ses_456",
		AgentID:         "agt_789",
		Harness:         2,
		ExecutionTarget: 2,
	}

	data, err := json.Marshal(input)
	require.NoError(t, err)

	var decoded InvokeAgentExecutionWorkflowInput
	err = json.Unmarshal(data, &decoded)
	require.NoError(t, err)

	assert.Equal(t, input.ExecutionID, decoded.ExecutionID)
	assert.Equal(t, input.SessionID, decoded.SessionID)
	assert.Equal(t, input.AgentID, decoded.AgentID)
	assert.Equal(t, int32(2), decoded.Harness)
	assert.Equal(t, int32(2), decoded.ExecutionTarget)
}

func TestInvokeAgentExecutionWorkflowInput_ExecutionTargetOmittedWhenZero(t *testing.T) {
	input := &InvokeAgentExecutionWorkflowInput{
		ExecutionID:     "exec_123",
		ExecutionTarget: 0,
	}

	data, err := json.Marshal(input)
	require.NoError(t, err)

	assert.NotContains(t, string(data), "execution_target",
		"execution_target should be omitted when zero (omitempty)")
}

func TestInvokeAgentExecutionWorkflowInput_BackwardCompatible(t *testing.T) {
	oldJSON := `{"execution_id":"exec_old","session_id":"ses_old","harness":1}`

	var input InvokeAgentExecutionWorkflowInput
	err := json.Unmarshal([]byte(oldJSON), &input)
	require.NoError(t, err)

	assert.Equal(t, "exec_old", input.ExecutionID)
	assert.Equal(t, int32(1), input.Harness)
	assert.Equal(t, int32(0), input.ExecutionTarget,
		"missing execution_target should default to 0 (UNSPECIFIED)")
}
