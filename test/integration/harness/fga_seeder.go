package harness

import (
	"context"
	"fmt"
)

const (
	// Must match IntegrationTestSecurityConfig.TEST_IDENTITY_ACCOUNT_ID
	testIdentityAccountID = "test-identity-account-id"

	// Singleton platform resource used for operator permissions
	platformStigmer = "platform:stigmer"
)

// SeedBaseFGATuples writes the minimum FGA tuples required for the integration
// test identity to operate. These tuples mirror what production bootstrapping
// and user-signup flows would create.
//
// Without these tuples, the test identity cannot create resources, execute
// agents, or access any org-scoped data when real FGA is active.
func SeedBaseFGATuples(ctx context.Context, fga *OpenFGAContainer) error {
	tuples := []RelationshipTuple{
		// Platform operator — grants can_bootstrap_iam, can_impersonate,
		// can_update_usage, can_execute_billing_ops, etc.
		{
			User:     "identity_account:" + testIdentityAccountID,
			Relation: "operator",
			Object:   platformStigmer,
		},

		// Org ownership — the test identity owns the test org.
		// This grants owner > admin > member > viewer transitively.
		{
			User:     "identity_account:" + testIdentityAccountID,
			Relation: "owner",
			Object:   "organization:" + TestOrg,
		},

		// Self-ownership — the test identity owns its own identity_account
		// (grants can_view/can_edit/can_delete per iam/identity_account.fga).
		// Production writes this tuple in provisionMyAccount's create
		// pipeline (IamPolicyCreationService SELF ownership); the harness
		// seeds the account row directly into postgres, so the tuple must
		// be mirrored here or self-updates (e.g. account preferences saves)
		// fail PERMISSION_DENIED.
		{
			User:     "identity_account:" + testIdentityAccountID,
			Relation: "owner",
			Object:   "identity_account:" + testIdentityAccountID,
		},

		// The machine account's PLATFORM grants (operator on platform:stigmer,
		// owner of itself) are NOT seeded here: BootstrapIdentitySeeder writes
		// them at startup, before the service reports ready — and OpenFGA's raw
		// Write API rejects duplicate tuples with a 400, so re-asserting them
		// would crash this seeder. Only grants the service does NOT own on day 0
		// belong below.
		//
		// The machine account deliberately holds NO org-scoped grants: system
		// operations that grant org roles (JIT auto-grant, invitation redeem)
		// go through bootstrapPolicy, which checks can_bootstrap_iam on
		// platform:stigmer. Seeding org admin here would mask production bugs
		// where a flow wrongly uses createPolicy (issue #329).
	}

	if err := fga.WriteTuples(ctx, tuples); err != nil {
		return fmt.Errorf("seed base FGA tuples: %w", err)
	}

	return nil
}
