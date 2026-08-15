package agentexecution

import (
	"context"
	"strings"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/registry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Fail-closed create-time validation of ExecutionConfig.thinking_mode
// (stigmer/stigmer#772), against the bundled registry. Capability-gated and
// cursor-harness-scoped: claude-opus-4-6 declares capabilities.thinking on
// its cursor entry; composer-2.5's cursor entry declares thinking=false;
// claude-sonnet-4.6 declares the capability but only on its NATIVE entry,
// which has no thinking wire mapping in v1 and must refuse. Twin of the
// cloud Java ValidateThinkingModeStepTest — both editions must refuse the
// same request with the same message.
func TestValidateThinkingModeStep(t *testing.T) {
	step := &validateThinkingModeStep{store: registry.Store()}

	execution := func(config *agentexecutionv1.ExecutionConfig) *pipeline.RequestContext[*agentexecutionv1.AgentExecution] {
		return pipeline.NewRequestContext(context.Background(), &agentexecutionv1.AgentExecution{
			Spec: &agentexecutionv1.AgentExecutionSpec{
				Message:         "hello",
				ExecutionConfig: config,
			},
		})
	}

	tests := []struct {
		name         string
		config       *agentexecutionv1.ExecutionConfig
		wantCode     codes.Code // codes.OK means the step must pass
		wantContains []string
	}{
		{
			name:     "no execution_config passes",
			config:   nil,
			wantCode: codes.OK,
		},
		{
			name: "explicit DISABLED passes without a model",
			config: &agentexecutionv1.ExecutionConfig{
				ThinkingMode: agentexecutionv1.ThinkingMode_THINKING_MODE_DISABLED,
			},
			wantCode: codes.OK,
		},
		{
			name: "ENABLED with a thinking-capable cursor model passes",
			config: &agentexecutionv1.ExecutionConfig{
				ModelName:    "claude-opus-4-6",
				ThinkingMode: agentexecutionv1.ThinkingMode_THINKING_MODE_ENABLED,
			},
			wantCode: codes.OK,
		},
		{
			name: "ENABLED combines freely with FAST — the combination bills as the fast variant",
			config: &agentexecutionv1.ExecutionConfig{
				ModelName:    "claude-opus-4-6",
				ServiceTier:  agentexecutionv1.ServiceTier_SERVICE_TIER_FAST,
				ThinkingMode: agentexecutionv1.ThinkingMode_THINKING_MODE_ENABLED,
			},
			wantCode: codes.OK,
		},
		{
			name: "ENABLED without model_name fails closed (no thinking-on-Auto)",
			config: &agentexecutionv1.ExecutionConfig{
				ThinkingMode: agentexecutionv1.ThinkingMode_THINKING_MODE_ENABLED,
			},
			wantCode: codes.InvalidArgument,
			wantContains: []string{
				"requires execution_config.model_name",
				"claude-opus-4-6", // thinking-capable suggestions
			},
		},
		{
			name: "ENABLED on a cursor model without the capability fails closed",
			config: &agentexecutionv1.ExecutionConfig{
				ModelName:    "composer-2.5",
				ThinkingMode: agentexecutionv1.ThinkingMode_THINKING_MODE_ENABLED,
			},
			wantCode: codes.InvalidArgument,
			wantContains: []string{
				"no thinking capability",
				"composer-2.5",
			},
		},
		{
			name: "ENABLED on a native-only model fails closed (no native wire mapping in v1)",
			config: &agentexecutionv1.ExecutionConfig{
				ModelName:    "claude-sonnet-4.6",
				ThinkingMode: agentexecutionv1.ThinkingMode_THINKING_MODE_ENABLED,
			},
			wantCode: codes.InvalidArgument,
			wantContains: []string{
				"cursor",
				"claude-sonnet-4.6",
			},
		},
		{
			name: "ENABLED on an unknown model fails closed",
			config: &agentexecutionv1.ExecutionConfig{
				ModelName:    "not-a-model",
				ThinkingMode: agentexecutionv1.ThinkingMode_THINKING_MODE_ENABLED,
			},
			wantCode: codes.InvalidArgument,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := step.Execute(execution(tt.config))

			if tt.wantCode == codes.OK {
				if err != nil {
					t.Fatalf("expected the step to pass, got: %v", err)
				}
				return
			}

			if err == nil {
				t.Fatal("expected a fail-closed refusal, step passed")
			}
			if got := status.Code(err); got != tt.wantCode {
				t.Errorf("expected %v, got %v (%v)", tt.wantCode, got, err)
			}
			for _, want := range tt.wantContains {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("refusal message must contain %q, got: %v", want, err)
				}
			}
		})
	}
}
