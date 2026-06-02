package workflowexecution

import (
	"testing"

	workflowexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowexecution/v1"
	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeWorkflowRefStep_InstanceOnly_ResolvesWorkflowId(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	instance := &workflowinstancev1.WorkflowInstance{
		Metadata: &apiresource.ApiResourceMetadata{Id: "wfi-1", Org: "test"},
		Spec:     &workflowinstancev1.WorkflowInstanceSpec{WorkflowId: "wf-1"},
	}
	require.NoError(t, store.SaveResource(contextWithWorkflowInstanceKind(), apiresourcekind.ApiResourceKind_workflow_instance, "wfi-1", instance))

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-1"},
		Spec:     &workflowexecutionv1.WorkflowExecutionSpec{WorkflowInstanceId: "wfi-1"},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newNormalizeWorkflowRefStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	require.NoError(t, step.Execute(reqCtx))

	normalized := reqCtx.NewState()
	assert.Equal(t, "wf-1", normalized.GetSpec().GetWorkflowId(),
		"should resolve workflow_id from the instance when only workflow_instance_id is set")
	assert.Equal(t, "wfi-1", normalized.GetSpec().GetWorkflowInstanceId(),
		"should preserve the existing workflow_instance_id")
}

func TestNormalizeWorkflowRefStep_WorkflowIdAlreadySet_NoOp(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	// Instance points at a different workflow; the step must not overwrite an
	// explicitly provided workflow_id.
	instance := &workflowinstancev1.WorkflowInstance{
		Metadata: &apiresource.ApiResourceMetadata{Id: "wfi-2", Org: "test"},
		Spec:     &workflowinstancev1.WorkflowInstanceSpec{WorkflowId: "wf-other"},
	}
	require.NoError(t, store.SaveResource(contextWithWorkflowInstanceKind(), apiresourcekind.ApiResourceKind_workflow_instance, "wfi-2", instance))

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-2"},
		Spec: &workflowexecutionv1.WorkflowExecutionSpec{
			WorkflowId:         "wf-explicit",
			WorkflowInstanceId: "wfi-2",
		},
		Status: &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newNormalizeWorkflowRefStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	require.NoError(t, step.Execute(reqCtx))

	assert.Equal(t, "wf-explicit", reqCtx.NewState().GetSpec().GetWorkflowId(),
		"should leave an already-populated workflow_id untouched")
}

func TestNormalizeWorkflowRefStep_NoInstance_GracefulSkip(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-3"},
		Spec:     &workflowexecutionv1.WorkflowExecutionSpec{},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newNormalizeWorkflowRefStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	require.NoError(t, step.Execute(reqCtx), "step should not fail when nothing is resolvable")
	assert.Empty(t, reqCtx.NewState().GetSpec().GetWorkflowId(),
		"should not set workflow_id when no instance is referenced")
}

func TestNormalizeWorkflowRefStep_InstanceNotFound_GracefulSkip(t *testing.T) {
	store, err := sqlite.NewStore(t.TempDir() + "/test.sqlite")
	require.NoError(t, err)
	defer store.Close()

	execution := &workflowexecutionv1.WorkflowExecution{
		Metadata: &apiresource.ApiResourceMetadata{Id: "exec-4"},
		Spec:     &workflowexecutionv1.WorkflowExecutionSpec{WorkflowInstanceId: "wfi-missing"},
		Status:   &workflowexecutionv1.WorkflowExecutionStatus{},
	}

	step := newNormalizeWorkflowRefStep(store)
	reqCtx := pipeline.NewRequestContext(contextWithWorkflowExecutionKind(), execution)

	require.NoError(t, step.Execute(reqCtx), "step should be best-effort when the instance cannot be loaded")
	assert.Empty(t, reqCtx.NewState().GetSpec().GetWorkflowId(),
		"should not set workflow_id when the instance is missing")
}
