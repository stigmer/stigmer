import { LicensesConsole } from "@stigmer/react";

/**
 * Platform-operator console for Stigmer licenses: the renewal calendar of
 * every license issued, the issue form, and each license's signed ticket.
 *
 * Reached via the operator-gated "Platform" nav group (see
 * `useSettingsNavGroups` — fail-closed on `can_issue_license` on
 * `platform:stigmer`). The nav gate is discoverability only; the server
 * permission is the real boundary, and non-operators who navigate here by
 * URL see the authorization notice the console renders.
 */
export default function LicensesPage() {
  return <LicensesConsole />;
}
