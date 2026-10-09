/**
 * The vault domain's fixed words and limits, in one place so the
 * controller, the service and the resolver say the same thing.
 *
 * My vault's slug derives from its person's id (`myVaultSlugOf`), so a
 * person's My vault has the same slug in every organization and no other
 * person's can take it. The slug is not what keeps one My vault per
 * person per organization: that is the `vault_person` name claim the
 * first write takes before the row exists (service.ts
 * `MY_VAULT_NAME_KIND`). The id is hashed rather than slugified because an
 * identity id may be an email (the trusted-local operator) or carry
 * characters a slug refuses; the `my-vault-` prefix is refused to shared
 * vaults so no name can take one.
 */
import { createHash } from "node:crypto";

/** The name every My vault carries. */
export const MY_VAULT_NAME = "My vault";

/** The slug prefix only My vaults carry. */
export const MY_VAULT_SLUG_PREFIX = "my-vault";

/** The most entries (secrets and connections together) one vault holds: rows are read whole on every run. */
export const MAX_VAULT_ENTRIES = 100;

/** The Git host whose connection clones a repository and the console's GitHub reads use. */
export const GITHUB_HOST = "github.com";

/** The slug of a person's My vault: deterministic from their id, unique per person. */
export function myVaultSlugOf(person: string): string {
  const digest = createHash("sha256").update(person, "utf8").digest("hex");
  return `${MY_VAULT_SLUG_PREFIX}-${digest.slice(0, 24)}`;
}

/** Whether a slug is reserved to My vaults. */
export function isMyVaultSlug(slug: string): boolean {
  return slug === MY_VAULT_SLUG_PREFIX || slug.startsWith(`${MY_VAULT_SLUG_PREFIX}-`);
}

export const MY_VAULT_SLUG_REFUSAL =
  `a shared vault's slug cannot start with '${MY_VAULT_SLUG_PREFIX}': that prefix belongs to each person's own My vault`;

export const MY_VAULT_VISIBILITY_REFUSAL =
  "My vault is always private: its logins and secrets serve only its owner's own runs. " +
  "Create a shared vault with only what your team needs, and share that instead";

export const OWNER_IMMUTABLE_REFUSAL =
  "a vault's owner cannot change: it is set by the server when the vault is created";

export const SHARED_VAULT_OWNER_REFUSAL =
  "create makes a shared vault, owned by its organization: save to your own My vault " +
  "with setSecrets or setConnection and `mine` instead";

export function vaultFullMessage(current: number, adding: number): string {
  return (
    `a vault holds at most ${MAX_VAULT_ENTRIES} logins and secrets together; ` +
    `this one holds ${current} and the write adds ${adding}. Remove entries it no longer needs, ` +
    "or keep them in another vault"
  );
}

/** `subject` names the value, already worded ("secret 'API_KEY'"). */
export function markerRejectionMessage(subject: string): string {
  return `${subject}: the redaction marker is not a value; send the real value to replace it`;
}

/** `subject` names the value, already worded ("secret 'API_KEY'"). */
export function forgedCiphertextMessage(subject: string): string {
  return (
    `${subject} must be plaintext: values carrying the 'enc:' encryption prefix ` +
    "are not accepted from clients"
  );
}

/**
 * Secret names no vault or conversation may hold: entries live in plain
 * objects, where these names reach the object's prototype instead of an
 * entry.
 */
const RESERVED_SECRET_NAMES: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/** The refusal for a reserved secret name, or undefined for a usable one. */
export function reservedSecretNameRefusal(name: string): string | undefined {
  return RESERVED_SECRET_NAMES.has(name)
    ? `'${name}' cannot name a secret: the name is reserved`
    : undefined;
}
