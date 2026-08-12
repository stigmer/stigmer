package session

import (
	"context"
	"testing"

	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	agentexecutiontemporal "github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentexecution/temporal"
)

// The immutability predicate must match dispatch: UNSPECIFIED resolves to the
// deployment default (Config.ResolveExecutionTarget), not to a fixed target.
// A hardcoded UNSPECIFIED→LOCAL mapping refused no-op round-trips on
// cloud-defaulting deployments and waved through real target changes (oss#397).
func TestValidateExecutionTargetImmutabilityStep_DeploymentDefaultMatrix(t *testing.T) {
	const (
		unspecified = sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED
		local       = sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL
		cloud       = sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD
	)

	localDefault := &agentexecutiontemporal.Config{
		DefaultExecutionTarget: agentexecutiontemporal.DefaultExecutionTargetLocal,
	}
	cloudDefault := &agentexecutiontemporal.Config{
		DefaultExecutionTarget: agentexecutiontemporal.DefaultExecutionTargetCloud,
	}

	tests := []struct {
		name     string
		cfg      *agentexecutiontemporal.Config
		existing sessionv1.ExecutionTarget
		input    sessionv1.ExecutionTarget
		wantErr  bool
	}{
		// Cloud-default deployment: UNSPECIFIED means CLOUD.
		{"cloud default: UNSPECIFIED→CLOUD is a no-op round-trip", cloudDefault, unspecified, cloud, false},
		{"cloud default: CLOUD→UNSPECIFIED is a no-op", cloudDefault, cloud, unspecified, false},
		{"cloud default: UNSPECIFIED→LOCAL is a real change", cloudDefault, unspecified, local, true},
		{"cloud default: LOCAL→UNSPECIFIED would move dispatch to CLOUD", cloudDefault, local, unspecified, true},
		{"cloud default: LOCAL→CLOUD is a real change", cloudDefault, local, cloud, true},
		{"cloud default: CLOUD→CLOUD is a no-op", cloudDefault, cloud, cloud, false},

		// Local-default deployment (OSS): UNSPECIFIED means LOCAL —
		// the pre-fix behavior, pinned unchanged.
		{"local default: UNSPECIFIED→LOCAL is a no-op", localDefault, unspecified, local, false},
		{"local default: LOCAL→UNSPECIFIED is a no-op", localDefault, local, unspecified, false},
		{"local default: UNSPECIFIED→CLOUD is a real change", localDefault, unspecified, cloud, true},
		{"local default: CLOUD→UNSPECIFIED would move dispatch to LOCAL", localDefault, cloud, unspecified, true},
		{"local default: LOCAL→CLOUD is a real change", localDefault, local, cloud, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			existing := &sessionv1.Session{
				Spec: &sessionv1.SessionSpec{
					// Non-empty: the session has executed, immutability applies.
					HarnessStateId:  "thread-xyz",
					ExecutionTarget: tt.existing,
				},
			}
			input := &sessionv1.Session{
				Spec: &sessionv1.SessionSpec{
					HarnessStateId:  "thread-xyz",
					ExecutionTarget: tt.input,
				},
			}

			ctx := pipeline.NewRequestContext(context.Background(), input)
			ctx.Set(steps.ExistingResourceKey, existing)

			err := NewValidateExecutionTargetImmutabilityStep(tt.cfg).Execute(ctx)
			if tt.wantErr && err == nil {
				t.Errorf("expected refusal for %v → %v with default %q, got nil",
					tt.existing, tt.input, tt.cfg.DefaultExecutionTarget)
			}
			if !tt.wantErr && err != nil {
				t.Errorf("expected no-op acceptance for %v → %v with default %q, got: %v",
					tt.existing, tt.input, tt.cfg.DefaultExecutionTarget, err)
			}
		})
	}
}

// Before the first execution (empty harness_state_id) the target is freely
// mutable regardless of deployment default.
func TestValidateExecutionTargetImmutabilityStep_MutableBeforeFirstExecution(t *testing.T) {
	cfg := &agentexecutiontemporal.Config{
		DefaultExecutionTarget: agentexecutiontemporal.DefaultExecutionTargetCloud,
	}

	existing := &sessionv1.Session{
		Spec: &sessionv1.SessionSpec{
			ExecutionTarget: sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
		},
	}
	input := &sessionv1.Session{
		Spec: &sessionv1.SessionSpec{
			ExecutionTarget: sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
		},
	}

	ctx := pipeline.NewRequestContext(context.Background(), input)
	ctx.Set(steps.ExistingResourceKey, existing)

	if err := NewValidateExecutionTargetImmutabilityStep(cfg).Execute(ctx); err != nil {
		t.Errorf("expected target change to be allowed before first execution, got: %v", err)
	}
}
