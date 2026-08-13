package workflowinstance

import (
	"context"
	"testing"

	workflowinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflowinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourcelib "github.com/stigmer/stigmer/backend/libs/go/apiresource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The workflow twin of the agentinstance guard tests. Because this package's
// setup wires the REAL workflow create pipeline (in-process gRPC), the
// rejection test is end-to-end: workflow create provisions the default
// instance through defaultinstance.BuildRequest (labels + status pointer),
// and the guard rejects the visibility update on it.

func TestWorkflowInstanceController_UpdateVisibility_RejectsDefaultInstance(t *testing.T) {
	controllers := setupTestController(t)
	defer controllers.store.Close()

	created := createTestWorkflow(t, controllers, "guarded-workflow", "")
	defaultInstanceID := created.GetStatus().GetDefaultInstanceId()
	require.NotEmpty(t, defaultInstanceID, "workflow create must provision a default instance")

	// The provisioned default carries the cloud edition's stored shape.
	stored := &workflowinstancev1.WorkflowInstance{}
	require.NoError(t, controllers.store.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_workflow_instance, defaultInstanceID, stored))
	assert.True(t, apiresourcelib.IsDefaultInstance(stored.GetMetadata()),
		"workflow create must stamp the default-instance label")
	assert.Equal(t, apiresourcelib.ReservedLabelTrue,
		stored.GetMetadata().GetLabels()[apiresourcelib.SystemManagedLabel],
		"workflow create must stamp the system-managed label")

	_, err := controllers.workflowInstance.UpdateVisibility(contextWithWorkflowInstanceKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: defaultInstanceID,
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.Error(t, err, "visibility update on a default instance must be rejected")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"expected FAILED_PRECONDITION, got %s: %s", st.Code(), st.Message())
	assert.Contains(t, st.Message(),
		"Default instances do not have their own visibility - access always follows "+
			"the parent blueprint. Change the blueprint's visibility instead.",
		"rejection text is part of the cross-edition contract")
}

func TestWorkflowInstanceController_UpdateVisibility_RejectsPointedDefaultInstance_LegacyUnlabeled(t *testing.T) {
	controllers := setupTestController(t)
	defer controllers.store.Close()

	created := createTestWorkflow(t, controllers, "legacy-workflow", "")
	defaultInstanceID := created.GetStatus().GetDefaultInstanceId()
	require.NotEmpty(t, defaultInstanceID)

	// Simulate the legacy shape: strip the labels the factory now stamps.
	// The parent workflow's status.default_instance_id (authoritative)
	// must keep the guard holding without any backfill.
	stored := &workflowinstancev1.WorkflowInstance{}
	require.NoError(t, controllers.store.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_workflow_instance, defaultInstanceID, stored))
	stored.Metadata.Labels = nil
	require.NoError(t, controllers.store.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_workflow_instance, defaultInstanceID, stored))

	_, err := controllers.workflowInstance.UpdateVisibility(contextWithWorkflowInstanceKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: defaultInstanceID,
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.Error(t, err)
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"the authoritative pointer branch must hold for unlabeled legacy defaults")
}

func TestWorkflowInstanceController_UpdateVisibility_AllowsStandaloneInstance(t *testing.T) {
	controllers := setupTestController(t)
	defer controllers.store.Close()

	created := createTestWorkflow(t, controllers, "standalone-parent", "")

	// A personal (standalone) instance of the same workflow: neither guard
	// branch may fire, and the level contract stays the instance's own.
	instance := &workflowinstancev1.WorkflowInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "WorkflowInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "my-personal-instance",
			Org:  "test-org",
		},
		Spec: &workflowinstancev1.WorkflowInstanceSpec{
			WorkflowId:  created.GetMetadata().GetId(),
			Description: "visibility guard fixture",
		},
	}
	createdInstance, err := controllers.workflowInstance.Create(contextWithWorkflowInstanceKind(), instance)
	require.NoError(t, err)

	updated, err := controllers.workflowInstance.UpdateVisibility(contextWithWorkflowInstanceKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: createdInstance.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err, "standalone instances keep their own visibility contract")
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_org, updated.GetMetadata().GetVisibility())
}
