/**
 * The reads over the API key list index (list-index.ts): every key whose
 * creator stamp names one of the given owners, newest first, decoded once.
 *
 * Owners, not one owner: a key minted before its owner was provisioned
 * carries the issuer subject as its stamp, not the account id
 * (verifier.ts), so a lane that means "this account's keys" asks for both
 * names an account whose subject is its own has had (`ownerNamesOf`). The
 * index answers each name; a row is kept
 * only when its decoded stamp is one of them, so an unproven row the store
 * re-derived can never smuggle in another owner's key. A row that does not
 * decode is skipped, as a list skips a corrupt row.
 */
import { fromBinary } from "@bufbuild/protobuf";

import type { ApiKey } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ApiKeySchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";

import { compareCreatedAtDesc } from "../../pipeline/steps/helpers.js";
import type { Store } from "../../store/interface.js";
import { subjectIsOwn } from "../identityaccount/own-subject.js";
import { apiKeyListIndex } from "./list-index.js";

/**
 * The names an account's keys are stamped with: its id, and its subject
 * when the subject is the platform's own (`subjectIsOwn`), the stamp a key
 * minted before the account existed carries. That is the rule the verifier's
 * direct lookup reads, so every key a raw-subject stamp lets speak for the
 * account is listed for it and deleted with it. A subject someone else
 * chose (a federation issuer, a mint, the server for a service account)
 * names no key: a provider that asserted another person's subject must not
 * reach that person's keys.
 */
export function ownerNamesOf(
  accountId: string,
  account: IdentityAccount | undefined,
): string[] {
  return account?.spec !== undefined && subjectIsOwn(account)
    ? [accountId, account.spec.idpId]
    : [accountId];
}

/** The stamp the key speaks for: its creator's id, "" when it carries none. */
export function ownerOfKey(key: ApiKey): string {
  return key.status?.audit?.specAudit?.createdBy?.id ?? "";
}

/** Every key owned by any of `owners`, newest first; empty names are ignored. */
export async function keysOwnedBy(
  store: Store,
  owners: ReadonlyArray<string>,
): Promise<ApiKey[]> {
  const names = [...new Set(owners.filter((owner) => owner !== ""))];
  if (names.length === 0) {
    return [];
  }
  const rows = await store.queryResources(apiKeyListIndex, {
    anyKey: names.map((value) => ({ name: "owner" as const, value })),
  });
  const keys: ApiKey[] = [];
  for (const row of rows) {
    let key: ApiKey;
    try {
      key = fromBinary(ApiKeySchema, row.data);
    } catch {
      continue;
    }
    if (names.includes(ownerOfKey(key))) {
      keys.push(key);
    }
  }
  return keys.sort((a, b) =>
    compareCreatedAtDesc(
      a.status?.audit?.specAudit?.createdAt,
      b.status?.audit?.specAudit?.createdAt,
    ),
  );
}
