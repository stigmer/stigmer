package agentexecution

import (
	"errors"

	"github.com/rs/zerolog/log"
	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
)

// composeDeclaredPreferencesStep snapshots the organization's declared
// standing context onto the execution spec (DD-002 D2/D4, stigmer/stigmer#293).
//
// The field is SERVER-OWNED: this step stamps spec.declared_preferences
// unconditionally, overwriting anything the caller supplied, so external
// injection of fake "org preferences" through the create request is moot by
// construction. OSS composes org_context only — the local server has no
// per-request user identity, so the user scope collapses into the org scope
// (DD-002 D1); user_context stays empty and is filled by the cloud edition's
// ComposeDeclaredPreferencesStep for eligible human callers.
//
// This is deliberately the first BEST-EFFORT step in this pipeline: an
// execution must never fail to start because its optional preferences could
// not be loaded, so genuine load failures are logged at error level and
// degrade to an empty snapshot instead of failing the create. (Logging at
// error, not warn, is deliberate — quiet degradation of a should-work path
// must stay visible; see the cloud EnsureSessionSandboxStep lesson.)
//
// Snapshot-at-create is the point, not an accident: preferences are mutable,
// executions are immutable audit records, and this field must record exactly
// what the model saw (the conversation_catchup pattern). The runner owns all
// presentation — preamble, per-scope attribution, ordering — via its
// shared/declared-preferences.ts channel module.
type composeDeclaredPreferencesStep struct {
	store store.Store
}

func newComposeDeclaredPreferencesStep(store store.Store) *composeDeclaredPreferencesStep {
	return &composeDeclaredPreferencesStep{store: store}
}

func (s *composeDeclaredPreferencesStep) Name() string {
	return "ComposeDeclaredPreferences"
}

func (s *composeDeclaredPreferencesStep) Execute(ctx *pipeline.RequestContext[*agentexecutionv1.AgentExecution]) error {
	execution := ctx.NewState()
	if execution.Spec == nil {
		execution.Spec = &agentexecutionv1.AgentExecutionSpec{}
	}

	// Claim the server-owned field first, before any load can fail: even the
	// degraded path must leave an empty snapshot, never a caller-supplied one.
	execution.Spec.DeclaredPreferences = &agentexecutionv1.DeclaredPreferences{}
	defer ctx.SetNewState(execution)

	// The caller's org, matching session-ownership resolution in
	// createSessionIfNeededStep (org id == slug in OSS).
	orgID := execution.GetMetadata().GetOrg()
	if orgID == "" {
		orgID = ctx.Input().GetMetadata().GetOrg()
	}
	if orgID == "" {
		log.Debug().Msg("No org on execution metadata, composing no declared preferences")
		return nil
	}

	org := &organizationv1.Organization{}
	if err := s.store.GetResource(ctx.Context(), apiresourcekind.ApiResourceKind_organization, orgID, org); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			log.Debug().
				Str("org_id", orgID).
				Msg("Org not found in store, composing no declared preferences")
			return nil
		}
		log.Error().
			Err(err).
			Str("org_id", orgID).
			Msg("Failed to load org for declared preferences - degrading to none (best-effort contract)")
		return nil
	}

	// Verbatim per DD-002 D2: the server stamps content only; blank-is-absent
	// is the runner's read-side convention, not a server-side transformation.
	execution.Spec.DeclaredPreferences.OrgContext = org.GetSpec().GetPreferences().GetStandingContext()

	if execution.Spec.DeclaredPreferences.OrgContext != "" {
		log.Debug().
			Str("org_id", orgID).
			Int("org_context_len", len(execution.Spec.DeclaredPreferences.OrgContext)).
			Msg("Composed declared preferences from org standing context")
	}

	return nil
}
