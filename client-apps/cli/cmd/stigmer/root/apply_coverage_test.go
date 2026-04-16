package root

import (
	"testing"

	"github.com/stigmer/stigmer/client-apps/cli/internal/cli/types"
	"github.com/stigmer/stigmer/sdk/go/proto/ai/stigmer/commons/apiresource/apiresourcekind"
	"github.com/stretchr/testify/assert"
)

// kindsWithApplyRPC is the ground truth: every ApiResourceKind whose
// *CommandController proto service defines an Apply RPC.
//
// Maintain this list manually. When a new kind gets an Apply RPC in
// the proto definitions, add it here — the test will fail until the
// kind is either registered in newApplyHandlerRegistry or explicitly
// excluded with a justification.
var kindsWithApplyRPC = []apiresourcekind.ApiResourceKind{
	apiresourcekind.ApiResourceKind_organization,
	apiresourcekind.ApiResourceKind_agent,
	apiresourcekind.ApiResourceKind_workflow,
	apiresourcekind.ApiResourceKind_mcp_server,
	apiresourcekind.ApiResourceKind_project,
	apiresourcekind.ApiResourceKind_identity_provider,
	apiresourcekind.ApiResourceKind_oauth_app,
	apiresourcekind.ApiResourceKind_environment,
	apiresourcekind.ApiResourceKind_agent_instance,
	apiresourcekind.ApiResourceKind_workflow_instance,
	apiresourcekind.ApiResourceKind_session,
	apiresourcekind.ApiResourceKind_execution_context,
}

// applyExcludedKinds lists kinds that have an Apply RPC but intentionally
// do not have an ApplyHandler in the file-apply registry. Each entry must
// have a justification string. Temporary exclusions reference the task
// that will implement them.
var applyExcludedKinds = map[apiresourcekind.ApiResourceKind]string{
	// Permanent exclusions
	apiresourcekind.ApiResourceKind_execution_context: "ephemeral, auto-managed per execution — never user-applied",
	apiresourcekind.ApiResourceKind_project:           "uses SDK synthesis path (executeProjectApply), not file-apply",
}

// TestAllApplyableKindsAreCovered verifies that every proto kind with an
// Apply RPC is either registered in the apply handler registry or explicitly
// excluded with a documented justification. A missing entry means someone
// added an Apply RPC without updating the CLI — the test fails to prevent
// silent gaps.
func TestAllApplyableKindsAreCovered(t *testing.T) {
	reg := newApplyHandlerRegistry()
	registered := reg.RegisteredKinds()

	for _, kind := range kindsWithApplyRPC {
		_, isRegistered := registered[kind]
		_, isExcluded := applyExcludedKinds[kind]

		if !isRegistered && !isExcluded {
			t.Errorf("kind %s has an Apply RPC but is neither registered in "+
				"newApplyHandlerRegistry nor listed in applyExcludedKinds — "+
				"implement an ApplyHandler or add an exclusion with justification",
				kind)
		}
	}
}

// TestNoOrphanedExclusions verifies that every kind in the exclusion list
// still appears in kindsWithApplyRPC. This prevents stale exclusions from
// lingering after a proto kind's Apply RPC is removed.
func TestNoOrphanedExclusions(t *testing.T) {
	applyRPCSet := make(map[apiresourcekind.ApiResourceKind]bool, len(kindsWithApplyRPC))
	for _, kind := range kindsWithApplyRPC {
		applyRPCSet[kind] = true
	}

	for kind, reason := range applyExcludedKinds {
		assert.True(t, applyRPCSet[kind],
			"applyExcludedKinds contains %s (%s) but it is not in kindsWithApplyRPC — "+
				"remove the stale exclusion", kind, reason)
	}
}

// TestNoDoubleRegistration verifies that a kind is not both registered
// AND excluded — that would indicate a completed implementation whose
// exclusion was not cleaned up.
func TestNoDoubleRegistration(t *testing.T) {
	reg := newApplyHandlerRegistry()
	registered := reg.RegisteredKinds()

	for kind, reason := range applyExcludedKinds {
		if registered[kind] {
			t.Errorf("kind %s is both registered in the handler registry and "+
				"excluded (%s) — remove the exclusion since the handler exists",
				kind, reason)
		}
	}
}

// TestRegisteredHandlersMatchVerbSupport verifies that every kind with a
// registered ApplyHandler also has VerbApply: true in the CLI type system's
// verb support matrix. A mismatch means the handler exists but the type
// system doesn't know the kind supports apply, which would prevent
// 'stigmer apply -f' from accepting YAML files for that kind.
func TestRegisteredHandlersMatchVerbSupport(t *testing.T) {
	reg := newApplyHandlerRegistry()

	for _, handler := range reg.All() {
		kind := handler.Kind()
		assert.True(t, types.SupportsVerb(kind, types.VerbApply),
			"kind %s has an ApplyHandler but is not marked as VerbApply "+
				"in verb_support.go — add VerbApply: true for this kind",
			kind)
	}
}
