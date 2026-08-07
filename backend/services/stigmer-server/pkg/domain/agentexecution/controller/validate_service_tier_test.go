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

// Fail-closed create-time validation of ExecutionConfig.service_tier
// (stigmer/stigmer#357), against the bundled registry (composer-2.5 prices a
// fast variant; claude-sonnet-4.6 is native with none). Twin of the cloud
// Java ValidateServiceTierStepTest — both editions must refuse the same
// request with the same message.
func TestValidateServiceTierStep(t *testing.T) {
	step := &validateServiceTierStep{store: registry.Store()}

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
			name: "explicit STANDARD passes without a model",
			config: &agentexecutionv1.ExecutionConfig{
				ServiceTier: agentexecutionv1.ServiceTier_SERVICE_TIER_STANDARD,
			},
			wantCode: codes.OK,
		},
		{
			name: "FAST with a fast-priced model passes",
			config: &agentexecutionv1.ExecutionConfig{
				ModelName:   "composer-2.5",
				ServiceTier: agentexecutionv1.ServiceTier_SERVICE_TIER_FAST,
			},
			wantCode: codes.OK,
		},
		{
			name: "FAST without model_name fails closed (no FAST-on-Auto)",
			config: &agentexecutionv1.ExecutionConfig{
				ServiceTier: agentexecutionv1.ServiceTier_SERVICE_TIER_FAST,
			},
			wantCode: codes.InvalidArgument,
			wantContains: []string{
				"requires execution_config.model_name",
				"composer-2.5", // fast-capable suggestions
			},
		},
		{
			name: "FAST on a native model with no fast variant fails closed",
			config: &agentexecutionv1.ExecutionConfig{
				ModelName:   "claude-sonnet-4.6",
				ServiceTier: agentexecutionv1.ServiceTier_SERVICE_TIER_FAST,
			},
			wantCode: codes.InvalidArgument,
			wantContains: []string{
				"no fast variant",
				"claude-sonnet-4.6",
			},
		},
		{
			name: "FAST on an unknown model fails closed",
			config: &agentexecutionv1.ExecutionConfig{
				ModelName:   "not-a-model",
				ServiceTier: agentexecutionv1.ServiceTier_SERVICE_TIER_FAST,
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
