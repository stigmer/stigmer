//go:build integration

// Apply-time validation of datastore principal bindings (dont-dos/001),
// over the wire against the real service: bindings that subject
// matching could never resolve are refused at apply instead of applying
// cleanly and silently never matching.
//
// Two validation layers are exercised, with their distinct status
// codes:
//
//   - spec-local subject integrity (unsupported principal kind,
//     duplicate subjects) — the parity-locked SpecValidator, shared
//     byte-identically with the OSS edition: INVALID_ARGUMENT;
//   - referential integrity (account existence, org membership, the
//     membership-gated did-you-mean) — the cloud-only
//     ValidateBindingPrincipalsStep against real Mongo:
//     FAILED_PRECONDITION.
//
// Every rejection asserts the exact message bytes: they are the
// operator-facing contract the CLI and console render verbatim.
package integration

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/google/uuid"
	datastorev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/datastore/v1"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	iampolicyv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/iampolicy/v1"
	"github.com/stigmer/stigmer/test/integration/harness"
	"github.com/stretchr/testify/require"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// seedBindingPrincipal materializes an identity account in Mongo (and,
// when membershipRelation is non-empty, its assignable relation on
// TestOrg in the iam_policy mirror) so datastore principal bindings can
// pass — or deliberately fail — the apply-time referential validation.
func seedBindingPrincipal(t *testing.T, ctx context.Context, input harness.SeedIdentityAccountInput, membershipRelation string) {
	t.Helper()

	mongoURI := fmt.Sprintf("mongodb://%s:%s", testHarness.Mongo.Host, testHarness.Mongo.Port)
	seeder, err := harness.NewMongoSeeder(ctx, mongoURI, "stigmer_test")
	require.NoError(t, err, "connect mongo seeder")
	defer seeder.Close(ctx)

	require.NoError(t, seeder.SeedIdentityAccount(ctx, input), "seed identity account %s", input.ID)
	if membershipRelation != "" {
		require.NoError(t, seeder.SeedOrgMembership(ctx, input.ID, harness.TestOrg, membershipRelation),
			"seed org membership for %s", input.ID)
	}
}

// bindingValidationSpec is the minimal spec the scenarios mutate: one
// declared role, one collection, and whatever bindings a case needs.
func bindingValidationSpec(bindings ...*datastorev1.DatastoreRoleBinding) *datastorev1.DatastoreSpec {
	return &datastorev1.DatastoreSpec{
		Description: "binding-validation integration fixture",
		Authorization: &datastorev1.DatastoreAuthorization{
			Roles:    []*datastorev1.DatastoreRole{{Name: "admin"}},
			Bindings: bindings,
		},
		Collections: []*datastorev1.CollectionDeclaration{{
			Name:   "notes",
			Fields: []*datastorev1.FieldDeclaration{{Name: "text", Type: datastorev1.FieldType_string}},
			Grants: []*datastorev1.DatastoreGrant{{
				Role:  "admin",
				Verbs: []datastorev1.DatastoreVerb{datastorev1.DatastoreVerb_read},
			}},
		}},
	}
}

func principalRoleBinding(kind, id, role string) *datastorev1.DatastoreRoleBinding {
	return &datastorev1.DatastoreRoleBinding{
		Subject: &datastorev1.DatastoreSubject{
			Kind: &datastorev1.DatastoreSubject_Principal{
				Principal: &iampolicyv1.ApiResourceRef{Kind: kind, Id: id},
			},
		},
		Role: role,
	}
}

// applyDatastore attempts a raw apply (no require.NoError — the
// scenarios assert rejections) and returns the error.
func applyDatastore(ctx context.Context, base *harness.Clients, spec *datastorev1.DatastoreSpec) error {
	_, err := base.DatastoreCommand.Apply(ctx, &datastorev1.Datastore{
		ApiVersion: harness.TestAPIVersion,
		Kind:       "Datastore",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: "binding-validation-" + uuid.New().String()[:8],
			Org:  harness.TestOrg,
		},
		Spec: spec,
	})
	return err
}

func TestDatastoreBindingValidation_Apply(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	base := harness.NewClients(grpcConn)
	suffix := uuid.New().String()[:8]

	// The cast: a member (exists + assignable relation on TestOrg), and
	// an outsider (exists on the platform, no relations in TestOrg).
	memberID := "idt-binding-val-member-" + suffix
	memberSlug := "binding-val-member-" + suffix
	outsiderID := "idt-binding-val-outsider-" + suffix
	seedBindingPrincipal(t, ctx, harness.SeedIdentityAccountInput{
		ID:    memberID,
		Slug:  memberSlug,
		Email: memberSlug + "@test.stigmer.ai",
		Name:  "Binding Validation Member",
	}, "member")
	seedBindingPrincipal(t, ctx, harness.SeedIdentityAccountInput{
		ID:    outsiderID,
		Email: "binding-val-outsider-" + suffix + "@test.stigmer.ai",
		Name:  "Binding Validation Outsider",
	}, "")

	requireRejects := func(t *testing.T, err error, code codes.Code, message string) {
		t.Helper()
		require.Error(t, err, "the apply must be rejected")
		st := status.Convert(err)
		require.Equal(t, code, st.Code(), "status code (message: %s)", st.Message())
		require.Equal(t, message, st.Message(), "the rejection is operator-facing contract text")
	}

	t.Run("a member principal binding applies cleanly", func(t *testing.T) {
		harness.CreateDatastore(t, ctx, base, "binding-val-positive",
			bindingValidationSpec(principalRoleBinding("identity_account", memberID, "admin")))
	})

	t.Run("a nonexistent principal id is refused with the id-not-slug guidance", func(t *testing.T) {
		ghost := "idt-binding-val-ghost-" + suffix
		err := applyDatastore(ctx, base,
			bindingValidationSpec(principalRoleBinding("identity_account", ghost, "admin")))
		requireRejects(t, err, codes.FailedPrecondition,
			fmt.Sprintf("binding principal %q does not resolve to an identity account;"+
				" bindings match by the account id, never by slug or email", ghost))
	})

	t.Run("an org member's slug in the id field gets a did-you-mean carrying the real id", func(t *testing.T) {
		err := applyDatastore(ctx, base,
			bindingValidationSpec(principalRoleBinding("identity_account", memberSlug, "admin")))
		requireRejects(t, err, codes.FailedPrecondition,
			fmt.Sprintf("binding principal %q does not resolve to an identity account;"+
				" bindings match by the account id, never by slug or email"+
				" — %q is the slug of org member %q; bind that id instead",
				memberSlug, memberSlug, memberID))
	})

	t.Run("a real but non-member id is refused as not a member", func(t *testing.T) {
		err := applyDatastore(ctx, base,
			bindingValidationSpec(principalRoleBinding("identity_account", outsiderID, "admin")))
		requireRejects(t, err, codes.FailedPrecondition,
			fmt.Sprintf("binding principal %q is not a member of organization %q;"+
				" only org members can hold record-layer roles", outsiderID, harness.TestOrg))
	})

	t.Run("a team principal kind is refused by the shared spec validator", func(t *testing.T) {
		err := applyDatastore(ctx, base,
			bindingValidationSpec(principalRoleBinding("team", "tm-binding-val-"+suffix, "admin")))
		requireRejects(t, err, codes.InvalidArgument,
			`binding principal kind "team" is not supported (only identity_account principals can be bound)`)
	})

	t.Run("duplicate binding subjects are refused by index, without echoing the subject", func(t *testing.T) {
		err := applyDatastore(ctx, base, bindingValidationSpec(
			principalRoleBinding("identity_account", memberID, "admin"),
			principalRoleBinding("identity_account", memberID, "admin")))
		requireRejects(t, err, codes.InvalidArgument,
			"bindings[1] duplicates the subject of bindings[0]")
	})
}
