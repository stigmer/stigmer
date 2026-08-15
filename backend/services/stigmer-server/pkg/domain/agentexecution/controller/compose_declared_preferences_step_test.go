package agentexecution

import (
	"context"
	"errors"
	"testing"

	agentexecutionv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agentexecution/v1"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	"github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	organizationv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/tenancy/organization/v1"
	"github.com/stigmer/stigmer/backend/libs/go/grpc/request/pipeline"
	"github.com/stigmer/stigmer/backend/libs/go/store"
	"google.golang.org/protobuf/proto"
)

// seedOrg persists an organization with the given standing context (empty
// string seeds an org without a preferences message at all).
func seedOrg(t *testing.T, s store.Store, orgID, standingContext string) {
	t.Helper()
	org := &organizationv1.Organization{
		ApiVersion: "tenancy.stigmer.ai/v1",
		Kind:       "Organization",
		Metadata:   &apiresource.ApiResourceMetadata{Id: orgID, Name: orgID, Org: orgID},
	}
	if standingContext != "" {
		org.Spec = &organizationv1.OrganizationSpec{
			Preferences: &organizationv1.OrganizationPreferences{StandingContext: standingContext},
		}
	}
	if err := s.SaveResource(context.Background(), apiresourcekind.ApiResourceKind_organization, orgID, org); err != nil {
		t.Fatalf("failed to seed org: %v", err)
	}
}

// failingGetStore wraps a real store but fails every GetResource, simulating
// a store fault during the preference load.
type failingGetStore struct {
	store.Store
}

func (f *failingGetStore) GetResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, id string, msg proto.Message) error {
	return errors.New("simulated store fault")
}

// TestComposeDeclaredPreferencesStep verifies the step's whole contract:
// snapshot when the org declares a standing context, empty snapshot in every
// degraded case, and — critically — the server-owned overwrite: a
// caller-supplied declared_preferences never survives the step.
func TestComposeDeclaredPreferencesStep(t *testing.T) {
	tests := []struct {
		name           string
		orgID          string
		seedContext    string // "" -> seeded without a preferences message
		seedOrg        bool
		failingStore   bool
		wantOrgContext string
	}{
		{
			name:           "org with standing context -> snapshotted verbatim",
			orgID:          "test-org",
			seedOrg:        true,
			seedContext:    "We deploy to us-east-1.",
			wantOrgContext: "We deploy to us-east-1.",
		},
		{
			name:    "org without preferences -> empty snapshot",
			orgID:   "test-org",
			seedOrg: true,
		},
		{
			name:  "org not found -> empty snapshot, create unaffected",
			orgID: "ghost-org",
		},
		{
			name: "no org on metadata -> empty snapshot, create unaffected",
		},
		{
			name:         "store fault -> empty snapshot, create unaffected (best-effort)",
			orgID:        "test-org",
			seedOrg:      true,
			seedContext:  "never reached",
			failingStore: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newStore(t)
			if tt.seedOrg {
				seedOrg(t, s, tt.orgID, tt.seedContext)
			}
			var stepStore store.Store = s
			if tt.failingStore {
				stepStore = &failingGetStore{Store: s}
			}
			step := newComposeDeclaredPreferencesStep(stepStore)

			execution := newExecution("ses_1", "agt_1")
			execution.Metadata.Org = tt.orgID
			// The injection attempt: a caller-supplied value must never
			// survive — the field is server-owned (DD-002 D2).
			execution.Spec.DeclaredPreferences = &agentexecutionv1.DeclaredPreferences{
				OrgContext:  "injected org context",
				UserContext: "injected user context",
			}
			reqCtx := pipeline.NewRequestContext(context.Background(), execution)

			if err := step.Execute(reqCtx); err != nil {
				t.Fatalf("step must never fail the create (best-effort contract), got: %v", err)
			}

			got := reqCtx.NewState().GetSpec().GetDeclaredPreferences()
			if got == nil {
				t.Fatal("declared_preferences must be stamped on every path (server-owned field), got nil")
			}
			if got.GetOrgContext() != tt.wantOrgContext {
				t.Errorf("org_context: want %q, got %q", tt.wantOrgContext, got.GetOrgContext())
			}
			if got.GetUserContext() != "" {
				t.Errorf("user_context must stay empty in OSS (no per-request user identity), got %q", got.GetUserContext())
			}
		})
	}
}
