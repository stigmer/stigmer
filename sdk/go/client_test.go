package stigmer

import (
	"context"
	"strings"
	"testing"

	"go.stigmer.ai/sdk/internal/gen"
	sessionv1 "go.stigmer.ai/sdk/proto/ai/stigmer/agentic/session/v1"
)

func TestNewClient_NoCredentials(t *testing.T) {
	_, err := NewClient()
	if err == nil {
		t.Fatal("expected error when no credentials are provided")
	}
}

func TestNewClient_MutuallyExclusiveCredentials(t *testing.T) {
	_, err := NewClient(WithAPIKey("stk_test"), WithToken("tok_test"))
	if err == nil {
		t.Fatal("expected error when both WithAPIKey and WithToken are provided")
	}
}

func TestNewClient_TokenFuncExcludesTheOtherCredentials(t *testing.T) {
	fn := func(context.Context) (string, error) { return "tok", nil }
	for name, other := range map[string]ClientOption{"WithAPIKey": WithAPIKey("stk_test"), "WithToken": WithToken("tok_test")} {
		if _, err := NewClient(WithTokenFunc(fn), other); err == nil || !strings.Contains(err.Error(), "WithTokenFunc is mutually exclusive") {
			t.Errorf("WithTokenFunc with %s: err = %v, want the mutually exclusive refusal", name, err)
		}
	}
}

func TestNewClient_TokenFuncAloneIsACredential(t *testing.T) {
	client, err := NewClient(WithTokenFunc(func(context.Context) (string, error) { return "tok", nil }))
	if err != nil {
		t.Fatalf("a TLS client with only WithTokenFunc must build, got: %v", err)
	}
	defer client.Close()
}

func TestNewClient_InsecureNoCredentials(t *testing.T) {
	client, err := NewClient(WithBaseURL("localhost:7234"), WithInsecure())
	if err != nil {
		t.Fatalf("expected no error for insecure without credentials, got: %v", err)
	}
	defer client.Close()
}

func TestApplyDefaultExecutionTarget(t *testing.T) {
	client, err := NewClient(
		WithBaseURL("localhost:7234"),
		WithInsecure(),
		WithExecutionTarget(sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL),
	)
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	input := &gen.SessionInput{}
	client.ApplyDefaultExecutionTarget(input)
	if input.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_LOCAL {
		t.Errorf("expected LOCAL, got %v", input.ExecutionTarget)
	}

	input2 := &gen.SessionInput{
		ExecutionTarget: sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD,
	}
	client.ApplyDefaultExecutionTarget(input2)
	if input2.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_CLOUD {
		t.Errorf("expected CLOUD preserved, got %v", input2.ExecutionTarget)
	}
}

func TestApplyDefaultExecutionTarget_NoDefault(t *testing.T) {
	client, err := NewClient(WithBaseURL("localhost:7234"), WithInsecure())
	if err != nil {
		t.Fatalf("NewClient failed: %v", err)
	}
	defer client.Close()

	input := &gen.SessionInput{}
	client.ApplyDefaultExecutionTarget(input)
	if input.ExecutionTarget != sessionv1.ExecutionTarget_EXECUTION_TARGET_UNSPECIFIED {
		t.Errorf("expected UNSPECIFIED when client has no default, got %v", input.ExecutionTarget)
	}
}
