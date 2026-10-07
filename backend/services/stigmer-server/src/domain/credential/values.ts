/**
 * Credential values for runs — the server's internal read of credentials
 * and their decrypted fields, the sanctioned path a run's resolution
 * (resolve.ts) and the sign-in lane take. The RPC surface redacts every
 * secret (revealField being the one single-field reveal, a person's own
 * only); a run needs the values themselves, and it never asks through the
 * RPC surface, which has no caller that could stand for "this run".
 *
 * Reads are by organization: the credential list index (list-index.ts)
 * answers one organization's rows, so a run reads its own organization's
 * credentials and nothing else, and a person's credentials are looked up
 * in the run's organization only.
 *
 * Error doctrine, per field:
 *   - a value-scoped decrypt failure (tampered, truncated, wrong key) is
 *     scoped to that one value: WARN and treat the field as absent, so a
 *     run that needed it is refused for a missing value rather than given
 *     junk;
 *   - an infrastructure failure (no key configured, the codec unavailable)
 *     propagates: the stored ciphertext may be fine, and skipping it would
 *     start the run silently missing a credential.
 *
 * Returned values are PLAINTEXT, for a run's values only. Never surface
 * them in an API response, a log or an error message.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Logger } from "../../boot/logger.js";
import { EncryptionUnavailableError } from "../../encryption/encryption.js";
import type { SecretService } from "../../encryption/encryption.js";
import { internalError } from "../../pipeline/errors.js";
import type { Store } from "../../store/interface.js";
import { credentialListIndex } from "./list-index.js";

/** Every credential of `org`, decoded, secrets still sealed. A row that does not decode is skipped. */
export async function credentialsOfOrg(
  store: Store,
  org: string,
): Promise<Credential[]> {
  if (org === "") {
    return [];
  }
  const rows = await store.queryResources(credentialListIndex, { org });
  const credentials: Credential[] = [];
  for (const row of rows) {
    let credential: Credential;
    try {
      credential = fromBinary(CredentialSchema, row.data);
    } catch {
      continue;
    }
    if ((credential.metadata?.org ?? "") === org) {
      credentials.push(credential);
    }
  }
  return credentials;
}

/** The credential a reference names among `credentials`, by organization and slug. */
export function credentialByReference(
  credentials: ReadonlyArray<Credential>,
  ref: ApiResourceReference,
): Credential | undefined {
  return credentials.find(
    (credential) =>
      (credential.metadata?.org ?? "") === ref.org &&
      (credential.metadata?.slug ?? "") === ref.slug,
  );
}

/** Decrypts credential fields for a run. */
export class CredentialValues {
  constructor(
    private readonly secretService: SecretService,
    private readonly logger: Logger,
  ) {}

  /**
   * The plaintext of `credential`'s field `name`, or undefined when the
   * credential holds no such field or its value cannot be decrypted (the
   * value-scoped arm of the module header). An empty value is a value.
   */
  async fieldValue(
    credential: Credential,
    name: string,
  ): Promise<string | undefined> {
    const field = credential.spec?.fields[name];
    if (field === undefined) {
      return undefined;
    }
    if (field.plain || !this.secretService.isEncrypted(field.value)) {
      return field.value;
    }
    try {
      return await this.secretService.decrypt(field.value);
    } catch (error) {
      const credentialId = credential.metadata?.id ?? "";
      if (error instanceof EncryptionUnavailableError) {
        throw internalError(
          error,
          `credential ${credentialId} holds an encrypted field '${name}' but no encryption key is configured`,
        );
      }
      this.logger.warn(
        "Undecryptable ciphertext in a credential field — treated as absent",
        {
          field: name,
          credentialId,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return undefined;
    }
  }
}
