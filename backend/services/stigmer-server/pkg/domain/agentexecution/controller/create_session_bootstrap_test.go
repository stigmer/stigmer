package agentexecution

import (
	"context"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	sessionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/session/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline/steps"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

// These tests cover the one-call session bootstrap (stigmer/stigmer#249):
// AgentExecutionSpec.session_spec shapes the auto-created session, replacing
// the previously hard-coded bare spec.

// TestBuildAutoCreateSessionSpec verifies the spec-forwarding contract:
// caller fields survive, defaults fill only gaps, and the caller's message
// is never mutated.
func TestBuildAutoCreateSessionSpec(t *testing.T) {
	workspaceEntries := []*sessionv1.WorkspaceEntry{{
		Name: "repo",
		Source: &sessionv1.WorkspaceSource{
			Source: &sessionv1.WorkspaceSource_LocalPath{
				LocalPath: &sessionv1.LocalPathSource{Path: "/home/user/repo"},
			},
		},
	}}

	tests := []struct {
		name              string
		callerSpec        *sessionv1.SessionSpec
		defaultInstanceID string
		want              *sessionv1.SessionSpec
	}{
		{
			name:              "nil spec -> minimal default (pre-bootstrap behavior)",
			callerSpec:        nil,
			defaultInstanceID: "inst_default",
			want: &sessionv1.SessionSpec{
				AgentInstanceId: "inst_default",
				Subject:         autoCreatedSessionSubject,
			},
		},
		{
			name: "full bootstrap spec -> forwarded verbatim, no defaults applied",
			callerSpec: &sessionv1.SessionSpec{
				AgentInstanceId:  "inst_explicit",
				Subject:          "Customize the landing page",
				WorkspaceEntries: workspaceEntries,
				Harness:          sessionv1.Harness_HARNESS_NATIVE,
				ExecutionTarget:  sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
			},
			// defaultInstanceID intentionally empty: CreateDefaultInstanceIfNeeded
			// skips resolution when the spec names an instance.
			want: &sessionv1.SessionSpec{
				AgentInstanceId:  "inst_explicit",
				Subject:          "Customize the landing page",
				WorkspaceEntries: workspaceEntries,
				Harness:          sessionv1.Harness_HARNESS_NATIVE,
				ExecutionTarget:  sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL,
			},
		},
		{
			name: "spec without instance or subject -> both defaulted, rest forwarded",
			callerSpec: &sessionv1.SessionSpec{
				WorkspaceEntries: workspaceEntries,
				ExecutionTarget:  sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
			},
			defaultInstanceID: "inst_resolved",
			want: &sessionv1.SessionSpec{
				AgentInstanceId:  "inst_resolved",
				Subject:          autoCreatedSessionSubject,
				WorkspaceEntries: workspaceEntries,
				ExecutionTarget:  sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildAutoCreateSessionSpec(tt.callerSpec, tt.defaultInstanceID)

			if !proto.Equal(tt.want, got) {
				t.Errorf("spec mismatch:\nwant: %v\ngot:  %v", tt.want, got)
			}
		})
	}
}

// TestBuildAutoCreateSessionSpec_CloneIsolation proves the returned spec is a
// deep clone: filling defaults or later mutation must never write through to
// the caller's request message.
func TestBuildAutoCreateSessionSpec_CloneIsolation(t *testing.T) {
	callerSpec := &sessionv1.SessionSpec{
		WorkspaceEntries: []*sessionv1.WorkspaceEntry{{
			Name: "repo",
			Source: &sessionv1.WorkspaceSource{
				Source: &sessionv1.WorkspaceSource_LocalPath{
					LocalPath: &sessionv1.LocalPathSource{Path: "/home/user/repo"},
				},
			},
		}},
	}
	original := proto.Clone(callerSpec).(*sessionv1.SessionSpec)

	got := buildAutoCreateSessionSpec(callerSpec, "inst_resolved")
	got.WorkspaceEntries[0].Name = "mutated"

	if !proto.Equal(original, callerSpec) {
		t.Errorf("caller spec was mutated:\nwant: %v\ngot:  %v", original, callerSpec)
	}
	if callerSpec.GetAgentInstanceId() != "" {
		t.Errorf("default instance leaked into caller spec: %q", callerSpec.GetAgentInstanceId())
	}
}

// TestAgentExecutionSpec_BootstrapValidation exercises the proto CEL rules
// guarding the bootstrap shape (defined on AgentExecutionSpec in
// apis/ai/stigmer/agentic/agentexecution/v1/spec.proto).
func TestAgentExecutionSpec_BootstrapValidation(t *testing.T) {
	step := steps.NewValidateProtoStep[*agentexecutionv1.AgentExecution]()

	tests := []struct {
		name     string
		spec     *agentexecutionv1.AgentExecutionSpec
		wantCode codes.Code
	}{
		{
			name: "session_spec alone -> valid",
			spec: &agentexecutionv1.AgentExecutionSpec{
				Message:     "hi",
				SessionSpec: &sessionv1.SessionSpec{AgentInstanceId: "inst_1"},
			},
			wantCode: codes.OK,
		},
		{
			name: "session_id and session_spec together -> InvalidArgument",
			spec: &agentexecutionv1.AgentExecutionSpec{
				Message:     "hi",
				SessionId:   "ses_1",
				SessionSpec: &sessionv1.SessionSpec{AgentInstanceId: "inst_1"},
			},
			wantCode: codes.InvalidArgument,
		},
		{
			name: "session_spec with harness_state_id -> InvalidArgument (server-owned field)",
			spec: &agentexecutionv1.AgentExecutionSpec{
				Message: "hi",
				SessionSpec: &sessionv1.SessionSpec{
					AgentInstanceId: "inst_1",
					HarnessStateId:  "thread-forged",
				},
			},
			wantCode: codes.InvalidArgument,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			execution := newExecution("", "")
			execution.Spec = tt.spec
			reqCtx := pipeline.NewRequestContext(context.Background(), execution)

			err := step.Execute(reqCtx)

			if got := status.Code(err); got != tt.wantCode {
				t.Errorf("expected gRPC code %v, got %v (err: %v)", tt.wantCode, got, err)
			}
		})
	}
}

// TestCreateSessionIfNeededStep_SkipsWhenSessionProvided pins the unchanged
// skip contract: an existing session_id bypasses auto-creation entirely (the
// nil session client proves no create is attempted).
func TestCreateSessionIfNeededStep_SkipsWhenSessionProvided(t *testing.T) {
	step := newCreateSessionIfNeededStep(nil)
	reqCtx := pipeline.NewRequestContext(context.Background(), newExecution("ses_existing", ""))

	if err := step.Execute(reqCtx); err != nil {
		t.Fatalf("expected skip to succeed, got %v", err)
	}
	if got := reqCtx.NewState().GetSpec().GetSessionId(); got != "ses_existing" {
		t.Errorf("expected session_id to remain 'ses_existing', got %q", got)
	}
}
