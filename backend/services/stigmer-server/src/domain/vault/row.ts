/**
 * What a vault row says about itself: whose My vault it is, and which
 * sealed values it carries. A leaf of the vault domain, imported by the
 * service, the delete chain's tail and every other vault module, so the
 * service can run that tail (a My vault created for someone who left
 * while it was created, service.ts `ensureMine`) without an import cycle.
 */
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";

/** The person a My vault belongs to, or undefined for a shared vault. */
export function personOf(vault: Vault | undefined): string | undefined {
  const owner = vault?.spec?.owner;
  return owner?.case === "person" ? owner.value : undefined;
}

/** Whether a vault is someone's My vault. */
export function isMyVault(vault: Vault | undefined): boolean {
  return personOf(vault) !== undefined;
}

/** The sealed values a vault carries: the delete chain's extractor. */
export function sealedValuesOfVault(vault: Vault): string[] {
  const values: string[] = [];
  for (const secret of Object.values(vault.spec?.secrets ?? {})) {
    values.push(secret.value);
  }
  for (const connection of Object.values(vault.spec?.connections ?? {})) {
    values.push(connection.token, connection.signIn?.refreshToken ?? "");
  }
  return values.filter((value) => value !== "");
}
