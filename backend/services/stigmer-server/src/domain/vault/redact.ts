/**
 * Redaction: every vault leaving the server shows its entries' names,
 * addresses and metadata and never a value. Values are write-only for
 * everyone, their owner included, so there is no marker to round-trip:
 * entries change only through their own RPCs, which take new values, and
 * update keeps stored entries whatever the request carries.
 */
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";

/** Blanks every value, token and refresh token in place. */
export function redactVault(vault: Vault | undefined): void {
  for (const secret of Object.values(vault?.spec?.secrets ?? {})) {
    secret.value = "";
  }
  for (const connection of Object.values(vault?.spec?.connections ?? {})) {
    connection.token = "";
    if (connection.signIn !== undefined) {
      connection.signIn.refreshToken = "";
    }
  }
}
