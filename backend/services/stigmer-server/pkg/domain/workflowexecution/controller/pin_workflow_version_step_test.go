package workflowexecution

import (
	"testing"

	workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/serverless"
	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPinWorkflowVersionStep_DirectWorkflowId(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	ctx := contextWithWorkflowKind()

	workflow := &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Id: "wf-1", Org: "test"},
		Status: &workflowv1.WorkflowStatus{
			VersionHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
			ServerlessWorkflowValidation: &serverless.ServerlessWorkflowValidation{
				State: serverless.ValidationState_VALID,
				Yaml:  "document: {}\n",
			},
		},
	}
	require.NoError(t, store.SaveResource(ctx, apiresourcekind.ApiResourceKind_workflow, "wf-1", workflow))

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-1"},
		Spec:     &workflowexecutionv1.WorkflowExecutionSpec{WorkflowId: "wf-1"},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newPinWorkflowVersionStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	err = step.Execute(reqCtx)
	require.NoError(t, err)

	pinned := reqCtx.NewState()
	assert.Equal(t, "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890", pinned.Status.WorkflowVersionHash,
		"should pin version hash from workflow status")
}

func TestPinWorkflowVersionStep_InstanceOnlyResolution(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	ctx := contextWithWorkflowKind()
	instanceCtx := contextWithWorkflowInstanceKind()

	workflow := &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Id: "wf-2", Org: "test"},
		Status: &workflowv1.WorkflowStatus{
			VersionHash: "deadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeef12",
		},
	}
	require.NoError(t, store.SaveResource(ctx, apiresourcekind.ApiResourceKind_workflow, "wf-2", workflow))

	instance := &workflowinstancev1.WorkflowInstance{
		Metadata: &apiresource.ApiResourceMetadata{Id: "wfi-2", Org: "test"},
		Spec:     &workflowinstancev1.WorkflowInstanceSpec{WorkflowId: "wf-2"},
	}
	require.NoError(t, store.SaveResource(instanceCtx, apiresourcekind.ApiResourceKind_workflow_instance, "wfi-2", instance))

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-2"},
		Spec:     &workflowexecutionv1.WorkflowExecutionSpec{WorkflowInstanceId: "wfi-2"},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newPinWorkflowVersionStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	err = step.Execute(reqCtx)
	require.NoError(t, err)

	pinned := reqCtx.NewState()
	assert.Equal(t, "deadbeef1234567890deadbeef1234567890deadbeef1234567890deadbeef12", pinned.Status.WorkflowVersionHash,
		"should resolve workflow_id from instance and pin the version hash")
}

func TestPinWorkflowVersionStep_NoWorkflowId_NoInstance(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-3"},
		Spec:     &workflowexecutionv1.WorkflowExecutionSpec{},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newPinWorkflowVersionStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	err = step.Execute(reqCtx)
	require.NoError(t, err, "step should not fail — graceful skip")

	pinned := reqCtx.NewState()
	assert.Empty(t, pinned.Status.WorkflowVersionHash,
		"should not pin when no workflow is resolvable")
}

func TestPinWorkflowVersionStep_WorkflowWithoutVersionHash(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	ctx := contextWithWorkflowKind()

	workflow := &workflowv1.Workflow{
		Metadata: &apiresource.ApiResourceMetadata{Id: "wf-legacy", Org: "test"},
		Status:   &workflowv1.WorkflowStatus{},
	}
	require.NoError(t, store.SaveResource(ctx, apiresourcekind.ApiResourceKind_workflow, "wf-legacy", workflow))

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-4"},
		Spec:     &workflowexecutionv1.WorkflowExecutionSpec{WorkflowId: "wf-legacy"},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newPinWorkflowVersionStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	err = step.Execute(reqCtx)
	require.NoError(t, err, "step should not fail — graceful skip for pre-versioning workflows")

	pinned := reqCtx.NewState()
	assert.Empty(t, pinned.Status.WorkflowVersionHash,
		"should not pin for workflows without version_hash")
}

func TestPinWorkflowVersionStep_WorkflowNotFound(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-5"},
		Spec:     &workflowexecutionv1.WorkflowExecutionSpec{WorkflowId: "wf-nonexistent"},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newPinWorkflowVersionStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	err = step.Execute(reqCtx)
	require.NoError(t, err, "step should not fail — best-effort when workflow not found")

	pinned := reqCtx.NewState()
	assert.Empty(t, pinned.Status.WorkflowVersionHash,
		"should not pin when workflow cannot be loaded")
}
