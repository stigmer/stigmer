package agentinstance

import (
	"context"
	"testing"

	agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
	agentinstancev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentinstance/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	apiresourcelib "github.com/stigmer/stigmer/backend/libs/go/apiresource"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"github.com/stigmer/stigmer/backend/services/stigmer-server/pkg/domain/agentinstance/defaultinstance"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// The default-instance guard (RejectDefaultInstanceVisibilityUpdate) keys on
// the stigmer.ai/default-instance label OR the parent agent's authoritative
// status.default_instance_id pointer. These tests pin both branches, the
// non-default pass-throughs, and the cloud error precedence. The cross-
// edition contract (exact code + message against a live server) is pinned
// by the conformance suite; these pin the OSS wiring.

// defaultInstanceRejectionMessage is cloud's exact rejection text — asserted
// verbatim so the OSS step cannot drift from the cross-edition contract.
const defaultInstanceRejectionMessage = "Default instances do not have their own visibility - " +
	"access always follows the parent blueprint. Change the blueprint's visibility instead."

// createInstanceForVisibility persists an instance through the real create
// pipeline. Labels may be nil.
func createInstanceForVisibility(t *testing.T, controller *AgentInstanceController, name, agentID string, labels map[string]string) *agentinstancev1.AgentInstance {
	t.Helper()
	instance := &agentinstancev1.AgentInstance{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "AgentInstance",
		Metadata: &apiresource.ApiResourceMetadata{
			Name:   name,
			Org:    "test-org",
			Labels: labels,
		},
		Spec: &agentinstancev1.AgentInstanceSpec{
			AgentId:     agentID,
			Description: "visibility guard fixture",
		},
	}
	created, err := controller.Create(contextWithAgentInstanceKind(), instance)
	require.NoError(t, err, "fixture instance %q should create", name)
	return created
}

// saveParentAgent persists an agent row directly to the store (deliberately
// bypassing the agent controller, whose create pipeline would auto-create a
// default instance and pollute fixture counts), with status.default_instance_id
// set to defaultInstanceID (may be empty). Create's LoadParentAgent step reads
// the same store through the in-process Agent service, so a row saved here
// satisfies parent validation.
func saveParentAgent(t *testing.T, s store.Store, agentID, org, defaultInstanceID string) {
	t.Helper()
	agent := &agentv1.Agent{
		ApiVersion: "agentic.stigmer.ai/v1",
		Kind:       "Agent",
		Metadata: &apiresource.ApiResourceMetadata{
			Id:   agentID,
			Name: "guard-parent-agent",
			Org:  org,
		},
		Status: &agentv1.AgentStatus{DefaultInstanceId: defaultInstanceID},
	}
	require.NoError(t, s.SaveResource(context.Background(),
		apiresourcekind.ApiResourceKind_agent, agentID, agent))
}

func requireDefaultInstanceRejection(t *testing.T, err error) {
	t.Helper()
	require.Error(t, err, "visibility update on a default instance must be rejected")
	st, ok := status.FromError(err)
	require.True(t, ok)
	assert.Equal(t, codes.FailedPrecondition, st.Code(),
		"expected FAILED_PRECONDITION, got %s: %s", st.Code(), st.Message())
	assert.Contains(t, st.Message(), defaultInstanceRejectionMessage,
		"rejection text is part of the cross-edition contract")
}

func TestAgentInstanceController_UpdateVisibility_RejectsLabeledDefaultInstance(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	// The shape defaultinstance.BuildRequest stamps at create.
	saveParentAgent(t, s, "agt_parent", "test-org", "")
	created := createInstanceForVisibility(t, controller, "labeled-default", "agt_parent", map[string]string{
		apiresourcelib.DefaultInstanceLabel: apiresourcelib.ReservedLabelTrue,
		apiresourcelib.SystemManagedLabel:   apiresourcelib.ReservedLabelTrue,
	})

	_, err := controller.UpdateVisibility(contextWithAgentInstanceKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	requireDefaultInstanceRejection(t, err)

	// The rejected attempt must not have changed the stored level.
	stored := &agentinstancev1.AgentInstance{}
	require.NoError(t, s.GetResource(context.Background(),
		apiresourcekind.ApiResourceKind_agent_instance, created.GetMetadata().GetId(), stored))
	assert.NotEqual(t, apiresource.ApiResourceVisibility_visibility_org, stored.GetMetadata().GetVisibility())
}

func TestAgentInstanceController_UpdateVisibility_RejectsPointedDefaultInstance_LegacyUnlabeled(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	// Legacy shape: instances created before OSS stamped labels carry none,
	// but the parent's status.default_instance_id still marks them — the
	// authoritative branch must hold without any backfill. The parent is
	// saved first (create validates it exists), then re-saved with the
	// default pointer once the instance ID is known.
	saveParentAgent(t, s, "agt_legacy_parent", "test-org", "")
	created := createInstanceForVisibility(t, controller, "legacy-default", "agt_legacy_parent", nil)
	saveParentAgent(t, s, "agt_legacy_parent", "test-org", created.GetMetadata().GetId())

	_, err := controller.UpdateVisibility(contextWithAgentInstanceKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	requireDefaultInstanceRejection(t, err)
}

func TestAgentInstanceController_UpdateVisibility_AllowsStandaloneInstanceOfExistingAgent(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	// A personal (standalone) instance of an agent whose default is some
	// OTHER instance: neither guard branch may fire.
	saveParentAgent(t, s, "agt_shared_parent", "test-org", "ain_some_other_default")
	created := createInstanceForVisibility(t, controller, "personal-instance", "agt_shared_parent", nil)

	updated, err := controller.UpdateVisibility(contextWithAgentInstanceKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err, "standalone instances keep their own visibility contract")
	assert.Equal(t, apiresource.ApiResourceVisibility_visibility_org, updated.GetMetadata().GetVisibility())
}

func TestAgentInstanceController_UpdateVisibility_AllowsOrphanInstance(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	// Parent agent deleted after the instance was created: nothing marks
	// the instance default, and the guard must not invent a failure mode
	// for the one legitimate operation an orphan supports. (The parent must
	// exist AT create — LoadParentAgent rejects unknown parents, oss#645 —
	// so the orphan is produced by deleting it afterwards.)
	saveParentAgent(t, s, "agt_deleted_parent", "test-org", "")
	created := createInstanceForVisibility(t, controller, "orphan-instance", "agt_deleted_parent", nil)
	require.NoError(t, s.DeleteResource(context.Background(),
		apiresourcekind.ApiResourceKind_agent, "agt_deleted_parent"))

	_, err := controller.UpdateVisibility(contextWithAgentInstanceKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_org,
	})
	require.NoError(t, err, "orphan instances pass the default-instance guard")
}

func TestAgentInstanceController_UpdateVisibility_DefaultRejectionPrecedesLevelCheck(t *testing.T) {
	controller, s := setupTestController(t)
	defer s.Close()

	// A default instance asked for an unsupported level must fail the
	// default-instance guard (FAILED_PRECONDITION), not the level check
	// (INVALID_ARGUMENT) — cloud runs the guard first, and the conformance
	// suite's standalone-instance workaround relied on exactly this order.
	saveParentAgent(t, s, "agt_parent2", "test-org", "")
	created := createInstanceForVisibility(t, controller, "default-bad-level", "agt_parent2", map[string]string{
		apiresourcelib.DefaultInstanceLabel: apiresourcelib.ReservedLabelTrue,
	})

	_, err := controller.UpdateVisibility(contextWithAgentInstanceKind(), &apiresource.UpdateVisibilityInput{
		ResourceId: created.GetMetadata().GetId(),
		Visibility: apiresource.ApiResourceVisibility_visibility_platform,
	})
	requireDefaultInstanceRejection(t, err)
}

func TestDefaultInstanceBuildRequest_StampsSystemManagedLabels(t *testing.T) {
	request := defaultinstance.BuildRequest(&apiresource.ApiResourceMetadata{
		Id:   "agt_x",
		Name: "My Agent",
		Slug: "my-agent",
		Org:  "org-1",
	})

	assert.Equal(t, "my-agent-default", request.GetMetadata().GetName())
	assert.Equal(t, "my-agent-default", defaultinstance.Slug("my-agent"))
	assert.Equal(t, "org-1", request.GetMetadata().GetOrg())
	assert.Equal(t, "agt_x", request.GetSpec().GetAgentId())
	labels := request.GetMetadata().GetLabels()
	assert.Equal(t, apiresourcelib.ReservedLabelTrue, labels[apiresourcelib.DefaultInstanceLabel],
		"default-instance marker must match the cloud edition's stored shape")
	assert.Equal(t, apiresourcelib.ReservedLabelTrue, labels[apiresourcelib.SystemManagedLabel],
		"system-managed marker must match the cloud edition's stored shape")
	assert.True(t, apiresourcelib.IsDefaultInstance(request.GetMetadata()),
		"the guard predicate must recognize the factory's output")
	// Deliberately unset: default instances carry no visibility of their own.
	assert.Equal(t, apiresource.ApiResourceVisibility_api_resource_visibility_unspecified,
		request.GetMetadata().GetVisibility())
}
