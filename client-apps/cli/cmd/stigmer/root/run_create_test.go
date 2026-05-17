package root

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	agentexecutionv1 "github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/agentic/agentexecution/v1"
)

func TestBuildExecutionConfig(t *testing.T) {
	tests := []struct {
		name           string
		model          string
		mode           string
		wantNil        bool
		wantModel      string
		wantMode       agentexecutionv1.InteractionMode
	}{
		{
			name:    "no model no mode produces nil config",
			model:   "",
			mode:    "",
			wantNil: true,
		},
		{
			name:      "model only sets ModelName",
			model:     "claude-sonnet-4-20250514",
			mode:      "",
			wantModel: "claude-sonnet-4-20250514",
			wantMode:  agentexecutionv1.InteractionMode_INTERACTION_MODE_UNSPECIFIED,
		},
		{
			name:     "plan mode sets PLAN enum",
			model:    "",
			mode:     "plan",
			wantMode: agentexecutionv1.InteractionMode_INTERACTION_MODE_PLAN,
		},
		{
			name:     "agent mode leaves default (UNSPECIFIED)",
			model:    "",
			mode:     "agent",
			wantMode: agentexecutionv1.InteractionMode_INTERACTION_MODE_UNSPECIFIED,
		},
		{
			name:      "model and plan mode coexist",
			model:     "gpt-4o",
			mode:      "plan",
			wantModel: "gpt-4o",
			wantMode:  agentexecutionv1.InteractionMode_INTERACTION_MODE_PLAN,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := buildExecutionConfig(tt.model, tt.mode)
			if tt.wantNil {
				assert.Nil(t, cfg)
				return
			}
			require.NotNil(t, cfg)
			assert.Equal(t, tt.wantModel, cfg.GetModelName())
			assert.Equal(t, tt.wantMode, cfg.GetInteractionMode())
		})
	}
}
