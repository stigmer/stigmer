package root

import (
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
	apiresource "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource"
	"github.com/stretchr/testify/assert"
)

func TestResolveResumeMode(t *testing.T) {
	makeExec := func(mode agentexecutionv1.InteractionMode) *agentexecutionv1.AgentExecution {
		return &agentexecutionv1.AgentExecution{
			Metadata: &apiresource.ApiResourceMetadata{Id: "exec-1"},
			Spec: &agentexecutionv1.AgentExecutionSpec{
				ExecutionConfig: &agentexecutionv1.ExecutionConfig{
					InteractionMode: mode,
				},
			},
		}
	}

	tests := []struct {
		name         string
		explicitMode string
		exec         *agentexecutionv1.AgentExecution
		want         string
	}{
		{
			name:         "explicit plan overrides execution agent mode",
			explicitMode: "plan",
			exec:         makeExec(agentexecutionv1.InteractionMode_INTERACTION_MODE_AGENT),
			want:         "plan",
		},
		{
			name:         "explicit agent overrides execution plan mode",
			explicitMode: "agent",
			exec:         makeExec(agentexecutionv1.InteractionMode_INTERACTION_MODE_PLAN),
			want:         "agent",
		},
		{
			name:         "empty infers plan from execution",
			explicitMode: "",
			exec:         makeExec(agentexecutionv1.InteractionMode_INTERACTION_MODE_PLAN),
			want:         "plan",
		},
		{
			name:         "empty with agent execution returns empty",
			explicitMode: "",
			exec:         makeExec(agentexecutionv1.InteractionMode_INTERACTION_MODE_AGENT),
			want:         "",
		},
		{
			name:         "empty with nil execution config returns empty",
			explicitMode: "",
			exec: &agentexecutionv1.AgentExecution{
				Metadata: &apiresource.ApiResourceMetadata{Id: "exec-2"},
				Spec:     &agentexecutionv1.AgentExecutionSpec{},
			},
			want: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := resolveResumeMode(tt.explicitMode, tt.exec)
			assert.Equal(t, tt.want, got)
		})
	}
}
