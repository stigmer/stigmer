package harness

import (
	"context"
	"fmt"
)

// BootstrapOperatorInput names the pre-auth operator a production-security-mode
// boot needs before its first authenticated call.
type BootstrapOperatorInput struct {
	// IdentityAccountID is the internal identity account id (metadata.id) —
	// the principal every FGA tuple below names.
	IdentityAccountID string
	// IdpID is the JWT "sub" the mock identity tenant mints for this operator
	// (spec.idpId). The production interceptor resolves Auth0 subjects to
	// accounts through this field, so it must equal the minted claim exactly.
	IdpID string
	// Email, Name, FirstName, LastName fill the account document; none is
	// load-bearing for authorization.
	Email     string
	Name      string
	FirstName string
	LastName  string
	// Org is the organization the operator owns (organization:<Org>) — the
	// only org a fresh boot is guaranteed to let it create resources in.
	Org string
}

// SeedBootstrapOperator seeds the one identity a production-security-mode Java
// boot cannot create for itself: a human platform operator that exists before
// any credential has been accepted. It writes the identity_account row
// directly (IdentitySeeder — the sole legitimate pre-auth back door) and the
// three FGA tuples production would have granted that account:
//
//   - operator on platform:stigmer (can_bootstrap_iam, can_impersonate, ...)
//   - owner of organization:<Org> (owner > admin > member > viewer)
//   - owner of its own identity_account (what provisionMyAccount's SELF tuple
//     grants; without it self-updates fail PERMISSION_DENIED)
//
// Two consumers, one implementation: test/integration-security boots the JAR
// in production mode for its JWT arms, and the conformance launcher
// (cmd/conformance-cloudenv) boots it the same way so the edge posture is
// observable to the cross-edition suite. Both then mint a tenant JWT with
// sub = IdpID and drive every further step through production RPCs.
//
// The machine account's grants are NOT seeded here: BootstrapIdentitySeeder
// writes them at startup and OpenFGA's raw Write API rejects duplicates.
//
// fga may be nil (the security suite treats OpenFGA as optional); the identity
// row is still seeded so the interceptor resolves the subject.
func SeedBootstrapOperator(ctx context.Context, pg *AppPostgresContainer, fga *OpenFGAContainer, in BootstrapOperatorInput) error {
	if in.IdentityAccountID == "" || in.IdpID == "" || in.Org == "" {
		return fmt.Errorf("seed bootstrap operator: IdentityAccountID, IdpID and Org are required (got %q, %q, %q)",
			in.IdentityAccountID, in.IdpID, in.Org)
	}

	if err := NewIdentitySeeder(pg).SeedIdentityAccount(ctx, SeedIdentityAccountInput{
		ID:        in.IdentityAccountID,
		IdpID:     in.IdpID,
		Email:     in.Email,
		Name:      in.Name,
		FirstName: in.FirstName,
		LastName:  in.LastName,
	}); err != nil {
		return fmt.Errorf("seed bootstrap operator identity: %w", err)
	}

	if fga == nil {
		return nil
	}
	principal := "identity_account:" + in.IdentityAccountID
	tuples := []RelationshipTuple{
		{User: principal, Relation: "operator", Object: platformStigmer},
		{User: principal, Relation: "owner", Object: "organization:" + in.Org},
		{User: principal, Relation: "owner", Object: principal},
	}
	if err := fga.WriteTuples(ctx, tuples); err != nil {
		return fmt.Errorf("seed bootstrap operator FGA tuples: %w", err)
	}
	return nil
}
