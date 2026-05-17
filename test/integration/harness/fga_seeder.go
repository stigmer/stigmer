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
			Object:   "organization:" + testOrg,
		},
	}

	if err := fga.WriteTuples(ctx, tuples); err != nil {
		return fmt.Errorf("seed base FGA tuples: %w", err)
	}

	return nil
}
