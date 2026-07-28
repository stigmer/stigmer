package harness

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	apiresource "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
	identityaccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/iam/identityaccount/v1"
	"github.com/stretchr/testify/require"
)

// CreateIdentityAccount provisions an identity account through the real create
// RPC — the storage-neutral front door. Tests seeded this way never depend on
// the persistence engine. IdentitySeeder remains only for the
// integration-security suite, whose production security mode cannot make
// authenticated RPCs before an account exists.
//
// The server assigns metadata.id and derives metadata.slug from the name —
// callers consume both from the returned account instead of choosing them.
// The account is deleted on test cleanup (best effort).
func CreateIdentityAccount(t *testing.T, ctx context.Context, clients *Clients, name, email string) *identityaccountv1.IdentityAccount {
	t.Helper()

	account, err := clients.IdentityAccountCommand.Create(ctx, &identityaccountv1.IdentityAccount{
		ApiVersion: "iam.stigmer.ai/v1",
		Kind:       "IdentityAccount",
		Metadata: &apiresource.ApiResourceMetadata{
			Name: name,
		},
		Spec: &identityaccountv1.IdentityAccountSpec{
			// idp_id is required by proto validation; seeded accounts are
			// never authenticated via an IdP, so a unique synthetic subject
			// suffices (and can never collide with a real one).
			IdpId: "integration-seed|" + uuid.New().String(),
			Email: email,
		},
	})
	require.NoError(t, err, "create identity account %q", name)
	require.NotEmpty(t, account.GetMetadata().GetId(), "created identity account must carry a server-assigned id")
	require.NotEmpty(t, account.GetMetadata().GetSlug(), "created identity account must carry a server-derived slug")

	t.Logf("created identity account: id=%s slug=%s name=%q",
		account.GetMetadata().GetId(), account.GetMetadata().GetSlug(), name)

	t.Cleanup(func() {
		cleanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, err := clients.IdentityAccountCommand.Delete(cleanCtx,
			&identityaccountv1.IdentityAccountId{Value: account.GetMetadata().GetId()})
		if err != nil {
			t.Logf("warning: failed to clean up identity account %s: %v", account.GetMetadata().GetId(), err)
		}
	})

	return account
}
