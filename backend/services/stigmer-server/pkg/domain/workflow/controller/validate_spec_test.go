package workflow

import (
	"context"
	"strings"
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	serverlessv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/workflow/validation"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// newValidateSpecController builds a controller wired with the real in-process
// validator. ValidateSpec never touches the store or the instance client, so
// both are nil here.
func newValidateSpecController() *WorkflowController {
	return NewWorkflowController(nil, nil, validation.NewInProcessValidator())
}

func mustStruct(t *testing.T, m map[string]any) *structpb.Struct {
	t.Helper()
	s, err := structpb.NewStruct(m)
	require.NoError(t, err)
	return s
}

// validWorkflow returns a structurally valid single-task workflow that passes
// both validation layers. Tests mutate a copy to exercise specific failures.
func validWorkflow(t *testing.T) *workflowv1.Workflow {
	t.Helper()
	return &workflowv1.Workflow{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Workflow",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "validate-unit-valid",
			Org:  "test-org",
		},
		Spec: &workflowv1.WorkflowSpec{
			Description: "valid workflow",
			Document: &workflowv1.WorkflowDocument{
				Dsl:       "1.0.0",
				Namespace: "test-org",
				Name:      "validate-unit-valid",
				Version:   "1.0.0",
			},
			Tasks: []*workflowv1.WorkflowTask{
				{
					Name:       "setGreeting",
					Kind:       workflowv1.WorkflowTaskKind_set_vars,
					TaskConfig: mustStruct(t, map[string]any{"variables": map[string]any{"greeting": "hello"}}),
					Export:     &workflowv1.Export{As: "${.}"},
				},
			},
		},
	}
}

func TestValidateSpec_Valid(t *testing.T) {
	c := newValidateSpecController()

	result, err := c.ValidateSpec(context.Background(), validWorkflow(t))

	require.NoError(t, err, "a valid workflow must not produce a gRPC error")
	require.NotNil(t, result)
	assert.Equal(t, serverlessv1.ValidationState_VALID, result.GetState())
	assert.Empty(t, result.GetErrors())
	assert.NotEmpty(t, result.GetYaml(), "VALID result should carry the generated CNCF YAML")
}

// TestValidateSpec_Layer2InvalidTaskKind: an unknown task kind passes Layer 1
// (kind is a non-zero enum value) and is caught by the domain validator.
func TestValidateSpec_Layer2InvalidTaskKind(t *testing.T) {
	c := newValidateSpecController()

	wf := validWorkflow(t)
	wf.Spec.Tasks[0].Kind = workflowv1.WorkflowTaskKind(999)

	result, err := c.ValidateSpec(context.Background(), wf)

	require.NoError(t, err, "an unknown task kind is a user error, not a gRPC fault")
	require.NotNil(t, result)
	assert.Equal(t, serverlessv1.ValidationState_INVALID, result.GetState())
	assert.NotEmpty(t, result.GetErrors(), "unknown task kind must produce structured errors")
}

// TestValidateSpec_Layer2CrossRefTypo: a switch case referencing a non-existent
// task passes Layer 1 and is caught by the domain cross-reference validator.
func TestValidateSpec_Layer2CrossRefTypo(t *testing.T) {
	c := newValidateSpecController()

	wf := validWorkflow(t)
	wf.Spec.Tasks = []*workflowv1.WorkflowTask{
		{
			Name:       "initVars",
			Kind:       workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: mustStruct(t, map[string]any{"variables": map[string]any{"severity": "critical"}}),
		},
		{
			Name: "routeBySeverity",
			Kind: workflowv1.WorkflowTaskKind_switch_case,
			TaskConfig: mustStruct(t, map[string]any{
				"cases": []any{
					map[string]any{"name": "critical", "when": "${ true }", "then": "handleCriticl"},
				},
			}),
		},
		{
			Name:       "handleCritical",
			Kind:       workflowv1.WorkflowTaskKind_set_vars,
			TaskConfig: mustStruct(t, map[string]any{"variables": map[string]any{"result": "handled"}}),
		},
	}

	result, err := c.ValidateSpec(context.Background(), wf)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, serverlessv1.ValidationState_INVALID, result.GetState())
	joined := strings.Join(result.GetErrors(), " ")
	assert.Contains(t, joined, "handleCriticl", "cross-ref error should name the dangling target")
}

// TestValidateSpec_Layer1MissingDocument: a missing required field is folded
// into a structured INVALID result (Layer 1), NOT thrown as a gRPC error.
func TestValidateSpec_Layer1MissingDocument(t *testing.T) {
	c := newValidateSpecController()

	wf := validWorkflow(t)
	wf.Spec.Document = nil

	result, err := c.ValidateSpec(context.Background(), wf)

	require.NoError(t, err, "a missing required field must be structured INVALID, not a gRPC error")
	require.NotNil(t, result)
	assert.Equal(t, serverlessv1.ValidationState_INVALID, result.GetState())
	require.NotEmpty(t, result.GetErrors())
	joined := strings.Join(result.GetErrors(), " ")
	assert.Contains(t, joined, "document", "Layer-1 error should reference the offending field")
	assert.Contains(t, joined, "\u2013", "Layer-1 error should use the shared '<path> – <message>' format")
}

// TestValidateSpec_Layer1EmptyTasks: tasks has a min_items=1 constraint.
func TestValidateSpec_Layer1EmptyTasks(t *testing.T) {
	c := newValidateSpecController()

	wf := validWorkflow(t)
	wf.Spec.Tasks = nil

	result, err := c.ValidateSpec(context.Background(), wf)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, serverlessv1.ValidationState_INVALID, result.GetState())
	assert.NotEmpty(t, result.GetErrors())
}

// TestValidateSpec_Layer1BadDsl: the dsl field must match ^1\.0\.0$. This proves
// ValidateSpec is a strict superset of Create — it catches proto-level
// constraints the domain validator alone does not check.
func TestValidateSpec_Layer1BadDsl(t *testing.T) {
	c := newValidateSpecController()

	wf := validWorkflow(t)
	wf.Spec.Document.Dsl = "2.0.0"

	result, err := c.ValidateSpec(context.Background(), wf)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, serverlessv1.ValidationState_INVALID, result.GetState())
	joined := strings.Join(result.GetErrors(), " ")
	assert.Contains(t, joined, "dsl", "bad dsl version should be reported as a Layer-1 violation")
}

func TestValidateSpec_NilInput(t *testing.T) {
	c := newValidateSpecController()

	t.Run("nil workflow", func(t *testing.T) {
		_, err := c.ValidateSpec(context.Background(), nil)
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
	})

	t.Run("nil spec", func(t *testing.T) {
		_, err := c.ValidateSpec(context.Background(), &workflowv1.Workflow{})
		require.Error(t, err)
		assert.Equal(t, codes.InvalidArgument, status.Code(err))
	})
}

// TestValidateSpec_NilValidator guards the defensive INTERNAL path when the
// controller is constructed without a validator (Layer 1 still runs).
func TestValidateSpec_NilValidator(t *testing.T) {
	c := NewWorkflowController(nil, nil, nil)

	_, err := c.ValidateSpec(context.Background(), validWorkflow(t))

	require.Error(t, err, "a spec that passes Layer 1 needs the validator for Layer 2")
	assert.Equal(t, codes.Internal, status.Code(err))
}

// TestValidateSpec_Layer2TaskConfigConstraints: message-level CEL rules on the
// typed task config fire at validate time (stigmer#805). wait's Duration carries
// duration.non_zero, yet task_config is an opaque Struct at Layer 1 — only the
// Layer-2 constraints step (protovalidate over the strict-unmarshaled typed
// message) can see it. The error string is byte-lockstep with the cloud Java
// validator: "task '<name>' (<kind>): <path> – <message>".
func TestValidateSpec_Layer2TaskConfigConstraints(t *testing.T) {
	c := newValidateSpecController()

	wf := validWorkflow(t)
	wf.Spec.Tasks = []*workflowv1.WorkflowTask{
		{
			Name:       "conditional_wait",
			Kind:       workflowv1.WorkflowTaskKind_wait,
			TaskConfig: mustStruct(t, map[string]any{"duration": map[string]any{}}),
		},
	}

	result, err := c.ValidateSpec(context.Background(), wf)

	require.NoError(t, err, "a config constraint violation is a user error, not a gRPC fault")
	require.NotNil(t, result)
	assert.Equal(t, serverlessv1.ValidationState_INVALID, result.GetState())
	assert.Contains(t, result.GetErrors(),
		"task 'conditional_wait' (wait): duration \u2013 at least one duration field must be non-zero")
}

// TestValidateSpec_Layer2TaskConfigConstraintsNested: the constraints step must
// reach tasks nested inside control-flow configs (for_each/fork/try_catch do
// blocks and compensate lists) — their task_config is a Struct inside the
// parent's typed config, invisible to both Layer 1 and the parent's own
// protovalidate run.
func TestValidateSpec_Layer2TaskConfigConstraintsNested(t *testing.T) {
	c := newValidateSpecController()

	wf := validWorkflow(t)
	wf.Spec.Tasks = []*workflowv1.WorkflowTask{
		{
			Name: "loopItems",
			Kind: workflowv1.WorkflowTaskKind_for_each,
			TaskConfig: mustStruct(t, map[string]any{
				"each": "item",
				"in":   "${ .items }",
				"do": []any{
					map[string]any{
						"name":        "nestedWait",
						"kind":        "wait",
						"task_config": map[string]any{"duration": map[string]any{}},
					},
				},
			}),
		},
	}

	result, err := c.ValidateSpec(context.Background(), wf)

	require.NoError(t, err)
	require.NotNil(t, result)
	assert.Equal(t, serverlessv1.ValidationState_INVALID, result.GetState())
	assert.Contains(t, result.GetErrors(),
		"task 'nestedWait' (wait): duration \u2013 at least one duration field must be non-zero")
}

// TestProtoFieldViolations_Format locks the exact cross-edition format so a drift
// away from the "<field.path> – <message>" shape (mirrored from the Java
// ProtoMessageFieldsValidator) is caught.
func TestProtoFieldViolations_Format(t *testing.T) {
	wf := validWorkflow(t)
	wf.Spec.Document = nil // triggers a required-field violation on spec.document

	violations, systemErr := protoFieldViolations(wf)

	require.NoError(t, systemErr)
	require.NotEmpty(t, violations)

	var documentViolation string
	for _, v := range violations {
		if strings.Contains(v, "document") {
			documentViolation = v
			break
		}
	}
	require.NotEmpty(t, documentViolation, "expected a violation for spec.document, got %v", violations)

	// Format is "<path> – <message>": path segment, space, en-dash, space, message.
	assert.Contains(t, documentViolation, " \u2013 ")
	parts := strings.SplitN(documentViolation, " \u2013 ", 2)
	require.Len(t, parts, 2)
	assert.Contains(t, parts[0], "document", "path segment should be the dotted field path")
	assert.NotEmpty(t, parts[1], "message segment should be the protovalidate message")
}
