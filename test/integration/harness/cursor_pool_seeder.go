package harness

import (
	"context"
	"fmt"

	cursoraccountv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/platform/cursoraccount/v1"
	"google.golang.org/grpc"
)

// SeedSharedPoolCursorAccount provisions the shared-pool CursorAccount the
// cloud proxy's key selection requires — since the DD-008 amendment removed
// the STIGMER_PROXY_CURSOR_API_KEY env fallback, DB-resident CursorAccount
// records are the ONLY Cursor credential source, and an empty pool REJECTs
// every proxied Cursor call with a 503. Without this seed, no cursor-harness
// execution can succeed in the suite (oss#482).
//
// It goes through the real operator RPCs rather than the repository so the
// suite exercises the production provisioning path, including both LIVE
// Cursor API validations:
//   - upsertCursorAccount proves adminAPIKey against GET /teams/members
//     (team Admin API key — a different credential class from memberAPIKey);
//   - addCursorMemberKey proves memberAPIKey against GET /v1/me and binds
//     its owning member (user-scoped keys only; admin keys are rejected).
//
// An enabled account with no org assignment IS the shared pool, and a
// freshly added enabled key is immediately routable (no sync needed:
// CursorKeyRoutability reads a missing roster snapshot as eligible).
//
// conn must authenticate as a principal holding can_manage_cursor_accounts
// on platform:stigmer — the suite's tokenless owner qualifies via the
// `operator` tuple written by SeedBaseFGATuples.
func SeedSharedPoolCursorAccount(ctx context.Context, conn grpc.ClientConnInterface, adminAPIKey, memberAPIKey string) error {
	client := cursoraccountv1.NewCursorAccountCommandControllerClient(conn)

	account, err := client.UpsertCursorAccount(ctx, &cursoraccountv1.UpsertCursorAccountInput{
		Account: &cursoraccountv1.CursorAccount{
			DisplayName: "integration-harness shared pool",
			AdminApiKey: adminAPIKey,
			Enabled:     true,
			// OrgIds stays empty: org assignment would make this a
			// DEDICATED account serving only that org.
		},
	})
	if err != nil {
		return fmt.Errorf("upsertCursorAccount: %w", err)
	}

	if _, err := client.AddCursorMemberKey(ctx, &cursoraccountv1.AddCursorMemberKeyInput{
		AccountId: account.GetAccountId(),
		ApiKey:    memberAPIKey,
		Label:     "integration-harness pool key",
	}); err != nil {
		return fmt.Errorf("addCursorMemberKey: %w", err)
	}

	return nil
}
