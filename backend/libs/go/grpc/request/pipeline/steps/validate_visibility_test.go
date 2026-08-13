package steps

import (
	"strings"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// requireInvalidArgument asserts err is a gRPC INVALID_ARGUMENT and returns
// its message for content assertions.
func requireInvalidArgument(t *testing.T, err error, label string) string {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected INVALID_ARGUMENT, got success", label)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("%s: expected gRPC status error, got %v", label, err)
	}
	if st.Code() != codes.InvalidArgument {
		t.Fatalf("%s: expected INVALID_ARGUMENT, got %s: %s", label, st.Code(), st.Message())
	}
	return st.Message()
}

// TestValidateVisibilityStep_LevelSupport pins the create-side support
// matrix against the kind's proto VisibilityConfig. The agent proto is
// reused across kinds deliberately (the TestBuildNewStateStep_DifferentKinds
// trick): the step is generic and visibility lives on the shared
// ApiResourceMetadata, so only the kind in context matters.
func TestValidateVisibilityStep_LevelSupport(t *testing.T) {
	tests := []struct {
		name       string
		kind       apiresourcekind.ApiResourceKind
		visibility apiresource.ApiResourceVisibility
		wantReject bool
	}{
		{"unspecified always passes", apiresourcekind.ApiResourceKind_session, apiresource.ApiResourceVisibility_api_resource_visibility_unspecified, false},
		{"private always passes", apiresourcekind.ApiResourceKind_session, apiresource.ApiResourceVisibility_visibility_private, false},
		{"blueprint accepts platform", apiresourcekind.ApiResourceKind_agent, apiresource.ApiResourceVisibility_visibility_platform, false},
		{"instance accepts public", apiresourcekind.ApiResourceKind_agent_instance, apiresource.ApiResourceVisibility_visibility_public, false},
		{"instance rejects platform (tenant isolation)", apiresourcekind.ApiResourceKind_agent_instance, apiresource.ApiResourceVisibility_visibility_platform, true},
		{"environment accepts org", apiresourcekind.ApiResourceKind_environment, apiresource.ApiResourceVisibility_visibility_org, false},
		{"environment rejects public (secret boundary)", apiresourcekind.ApiResourceKind_environment, apiresource.ApiResourceVisibility_visibility_public, true},
		{"no-config kind rejects org (private-only)", apiresourcekind.ApiResourceKind_session, apiresource.ApiResourceVisibility_visibility_org, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			resource := &agentv1.Agent{
				Metadata: &apiresource.ApiResourceMetadata{
					Name:       "test",
					Visibility: tt.visibility,
				},
			}

			step := NewValidateVisibilityStep[*agentv1.Agent]()
			ctx := pipeline.NewRequestContext(contextWithKind(tt.kind), resource)

			err := step.Execute(ctx)
			if tt.wantReject {
				requireInvalidArgument(t, err, tt.name)
			} else if err != nil {
				t.Fatalf("expected success, got %v", err)
			}
		})
	}
}

// TestValidateVisibilityStep_CloudMessageFormat pins the exact rejection
// text to Cloud's ValidateVisibilityStep message, so clients see one error
// contract across editions. If this pin breaks, cloud parity broke — do not
// reword one side only.
func TestValidateVisibilityStep_CloudMessageFormat(t *testing.T) {
	resource := &agentv1.Agent{
		Metadata: &apiresource.ApiResourceMetadata{
			Name:       "test",
			Visibility: apiresource.ApiResourceVisibility_visibility_platform,
		},
	}

	step := NewValidateVisibilityStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent_instance), resource)

	msg := requireInvalidArgument(t, step.Execute(ctx), "instance + platform")
	want := "agent_instance resources cannot be set to visibility_platform. " +
		"Supported visibility levels: visibility_private, visibility_org, visibility_public."
	if msg != want {
		t.Errorf("message drifted from the cloud format:\n got: %q\nwant: %q", msg, want)
	}
}

// TestValidateVisibilityStep_NilMetadata pins the no-op contract: requests
// without metadata are not this step's failure mode — other steps own it.
func TestValidateVisibilityStep_NilMetadata(t *testing.T) {
	resource := &agentv1.Agent{}

	step := NewValidateVisibilityStep[*agentv1.Agent]()
	ctx := pipeline.NewRequestContext(contextWithKind(apiresourcekind.ApiResourceKind_agent), resource)

	if err := step.Execute(ctx); err != nil {
		t.Fatalf("expected nil-metadata no-op, got %v", err)
	}
}

func TestValidateVisibilityStep_Name(t *testing.T) {
	if got := NewValidateVisibilityStep[*agentv1.Agent]().Name(); got != "ValidateVisibility" {
		t.Errorf("Name() = %q, want ValidateVisibility", got)
	}
}

// TestValidateVisibilityUpdateStep_LevelSupport pins the updateVisibility
// counterpart: same predicate, same message, driven by the
// UpdateVisibilityInput's requested level and the kind in context.
func TestValidateVisibilityUpdateStep_LevelSupport(t *testing.T) {
	tests := []struct {
		name       string
		kind       apiresourcekind.ApiResourceKind
		visibility apiresource.ApiResourceVisibility
		wantReject bool
	}{
		{"private always passes", apiresourcekind.ApiResourceKind_agent_instance, apiresource.ApiResourceVisibility_visibility_private, false},
		{"blueprint accepts public", apiresourcekind.ApiResourceKind_workflow, apiresource.ApiResourceVisibility_visibility_public, false},
		{"instance rejects platform (tenant isolation)", apiresourcekind.ApiResourceKind_workflow_instance, apiresource.ApiResourceVisibility_visibility_platform, true},
		{"environment rejects platform (secret boundary)", apiresourcekind.ApiResourceKind_environment, apiresource.ApiResourceVisibility_visibility_platform, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &apiresource.UpdateVisibilityInput{
				ResourceId: "res_123",
				Visibility: tt.visibility,
			}

			step := NewValidateVisibilityUpdateStep()
			ctx := pipeline.NewRequestContext(contextWithKind(tt.kind), input)

			err := step.Execute(ctx)
			if tt.wantReject {
				msg := requireInvalidArgument(t, err, tt.name)
				if want := "cannot be set to"; !strings.Contains(msg, want) {
					t.Errorf("message %q missing %q", msg, want)
				}
			} else if err != nil {
				t.Fatalf("expected success, got %v", err)
			}
		})
	}
}

func TestValidateVisibilityUpdateStep_Name(t *testing.T) {
	if got := NewValidateVisibilityUpdateStep().Name(); got != "ValidateVisibilityUpdate" {
		t.Errorf("Name() = %q, want ValidateVisibilityUpdate", got)
	}
}
