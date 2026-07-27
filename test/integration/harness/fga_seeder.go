package harness

import (
	"context"
	"fmt"
)

const (
	// Must match IntegrationTestSecurityConfig.TEST_IDENTITY_ACCOUNT_ID
	testIdentityAccountID = "test-identity-account-id"

	// Must match BootstrapIdentitySeeder.MACHINE_ACCOUNT_ID — the service seeds the
	// real machine account (T06); test mode mints its JWTs with this same subject.
	testMachineAccountID = "machine"

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

		// The machine account's PLATFORM grants (operator on platform:stigmer,
		// owner of itself) are NOT seeded here: BootstrapIdentitySeeder writes
		// them at startup, before the service reports ready — and OpenFGA's raw
		// Write API rejects duplicate tuples with a 400, so re-asserting them
		// would crash this seeder. Only grants the service does NOT own on day 0
		// belong below.

		// Machine account — org admin for auto-grant operations.
		// JIT provisioning with auto_grant_on_org calls createPolicy, which
		// requires can_grant_access on the target org (derived from admin).
		// In production, the machine account receives org admin during org
		// creation — org-scoped, so deliberately not the bootstrap seeder's job.
		{
			User:     "identity_account:" + testMachineAccountID,
			Relation: "admin",
			Object:   "organization:" + TestOrg,
		},
	}

	if err := fga.WriteTuples(ctx, tuples); err != nil {
		return fmt.Errorf("seed base FGA tuples: %w", err)
	}

	return nil
}
