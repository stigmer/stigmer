import { CursorAccountsConsole } from "@stigmer/react";

/**
 * Platform-operator console for managed Cursor accounts: the Cursor
 * teams (admin keys, member execution keys, org assignments) backing the
 * cursor harness, with roster coverage and per-member cycle spend.
 *
 * Reached via the operator-gated "Platform" nav group (see
 * `useSettingsNavGroups` — fail-closed on `can_manage_cursor_accounts`
 * on `platform:stigmer`). The nav gate is discoverability only; the
 * server permission is the real boundary, and non-operators who navigate
 * here by URL see the authorization notice the console renders.
 */
export default function CursorAccountsPage() {
  return <CursorAccountsConsole />;
}
