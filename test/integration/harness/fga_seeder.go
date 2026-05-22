package harness

import (
	"context"
	"fmt"
)

const (
	// Must match IntegrationTestSecurityConfig.TEST_IDENTITY_ACCOUNT_ID
	testIdentityAccountID = "test-identity-account-id"

	// Must match IntegrationTestDataSeeder.MACHINE_ACCOUNT_ID
	testMachineAccountID = "test-machine-account-id"

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

		// Machine account — platform operator for inProcessChannelAsSystem calls.
		// In production, the machine account is seeded by Mongock migration and
		// its JWT is fetched from Auth0. In test mode, TestMachineAccountJwtProviderConfig
		// mints Stigmer-signed JWTs with this identity as the subject.
		{
			User:     "identity_account:" + testMachineAccountID,
			Relation: "operator",
			Object:   platformStigmer,
		},

		// Machine account — org admin for auto-grant operations.
		// JIT provisioning with auto_grant_on_org calls createPolicy, which
		// requires can_grant_access on the target org (derived from admin).
		// In production, the machine account receives org admin during org creation.
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
