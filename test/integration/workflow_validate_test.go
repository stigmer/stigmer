//go:build integration

package integration

import (
	"context"
	"testing"
	"time"

	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverless "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestValidateSpec_ValidWorkflow(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"variables": map[string]any{
			"greeting": "hello",
		},
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-test-valid",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Valid workflow for validateSpec test",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-test-valid",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setGreeting",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: taskConfig,
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)
	require.NoError(t, err, "validateSpec RPC should not return an error for a valid workflow")

	assert.Equal(t, serverless.ValidationState_VALID, result.GetState(),
		"expected VALID state, got %s", result.GetState().String())
	assert.Empty(t, result.GetErrors(), "valid workflow should have no validation errors")

	t.Logf("validateSpec VALID: yaml_length=%d", len(result.GetYaml()))
}

func TestValidateSpec_InvalidTaskKind(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	taskConfig, err := structpb.NewStruct(map[string]any{
		"some_field": "some_value",
	})
	require.NoError(t, err)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-test-bad-kind",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Workflow with unknown task kind",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-test-bad-kind",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "badTask",
					Kind:       workflowv1.WorkflowTaskKind(999),
					TaskConfig: taskConfig,
				},
			},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)

	// The RPC may return an error for severely malformed input, or it may
	// return a result with INVALID state. Both are acceptable behaviors.
	if err != nil {
		t.Logf("validateSpec returned error for invalid task kind (acceptable): %v", err)
		return
	}

	assert.NotEqual(t, serverless.ValidationState_VALID, result.GetState(),
		"workflow with invalid task kind should not be VALID")

	t.Logf("validateSpec result: state=%s, errors=%v", result.GetState().String(), result.GetErrors())
}

func TestValidateSpec_MissingDocument(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-test-no-doc",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "Workflow with no document section",
			// Document intentionally nil — missing required field.
			Tasks: []*workflowv1.WorkflowTask{},
		},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)
	if err != nil {
		t.Logf("validateSpec returned error for missing document (acceptable): %v", err)
		return
	}

	assert.NotEqual(t, serverless.ValidationState_VALID, result.GetState(),
		"workflow with missing document should not be VALID")

	t.Logf("validateSpec result: state=%s, errors=%v", result.GetState().String(), result.GetErrors())
}

func TestValidateSpec_EmptySpec(t *testing.T) {
	require.NotNil(t, grpcConn, "shared gRPC connection must be available")

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	clients := harness.NewClients(grpcConn)

	workflow := &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-test-empty",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{},
	}

	result, err := clients.WorkflowCommand.ValidateSpec(ctx, workflow)
	if err != nil {
		// Graceful error for empty spec is acceptable — no panic.
		t.Logf("validateSpec returned error for empty spec (acceptable, no panic): %v", err)
		return
	}

	assert.NotEqual(t, serverless.ValidationState_VALID, result.GetState(),
		"empty workflow spec should not be VALID")

	t.Logf("validateSpec result: state=%s, errors=%v", result.GetState().String(), result.GetErrors())
}
