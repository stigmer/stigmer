/**
 * The one data migration that repairs identity-account slugs, once, when
 * metadata.slug gained its 63-character bound and every derived slug was
 * held to the slug rules. Before that, an account's slug was derived from
 * its email or subject with no check (ValidateProto ran before the
 * derivation), so a stored account may hold a slug the rules refuse: one
 * longer than 63 characters, one starting with a digit, or none at all.
 * ValidateProto reads the slug an update sends back, so such an account
 * could no longer be updated. Both open-source drivers run this step; the
 * cloud's own migration over its account table applies the same
 * `repairAccountSlug`, so the two editions repair alike.
 *
 * Why the rule and the derivation are frozen here rather than imported from
 * the domain (domain/identityaccount/slug.ts accountSlugFor). A migration
 * is a statement about the store as it was when the rule changed: a later
 * release that changes the live derivation must not change what this step
 * does to a database it has not reached yet (public-visibility-retired.ts
 * gives the same reason for its kind table). The derivation below is the
 * live one as of this step, and an account created after it gets the same
 * slug from the live function.
 *
 * What changes. Only `metadata.slug`, and only where the frozen rule
 * refuses it or it is empty; every other byte is re-encoded from the same
 * values (protobuf-es keeps unknown fields), and an account whose slug the
 * rule admits is left untouched. Accounts are unique by subject, never by
 * slug, and nothing reads an account by slug, so a new slug collides with
 * nothing. `resource_audit` keeps its history. A row this step cannot
 * decode fails the whole transaction, as every data migration's does.
 */
import { createHash } from "node:crypto";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";

import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

import { generateSlug } from "../pipeline/steps/slug.js";

/** The enum NAME the drivers' `kind` column holds for an identity account. */
export const IDENTITY_ACCOUNT_KIND = "identity_account";

/** metadata.slug's rule when this step was written: 2 to 63, a letter first, a letter or digit last. */
const SLUG_RULE = /^[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const MAX_SLUG_LENGTH = 63;
const MIN_SLUG_LENGTH = 2;
const HASH_DIGITS = 8;

/**
 * The slug a stored account takes when the frozen rule refuses its own, or
 * `undefined` when its slug stands. The derivation is accountSlugFor's as of
 * this step: the shared generator over the name, then the subject, then the
 * id; `a-` before a leading non-letter; a cut to 54 with 8 hex digits of the
 * source's SHA-256 when too long or too short.
 */
export function repairAccountSlug(account: IdentityAccount): string | undefined {
  const metadata = account.metadata;
  const current = metadata?.slug ?? "";
  if (SLUG_RULE.test(current)) {
    return undefined;
  }
  const sources = [metadata?.name ?? "", account.spec?.idpId ?? "", metadata?.id ?? ""];
  let source = "";
  let slug = "";
  for (const candidate of sources) {
    slug = generateSlug(candidate);
    source = candidate;
    if (slug !== "") {
      break;
    }
  }
  if (slug === "") {
    throw new Error("the account has no name, subject or id to derive a slug from");
  }
  if (!/^[a-z]/.test(slug)) {
    slug = `a-${slug}`;
  }
  if (slug.length > MAX_SLUG_LENGTH || slug.length < MIN_SLUG_LENGTH) {
    const hash = createHash("sha256").update(source).digest("hex").slice(0, HASH_DIGITS);
    slug = `${slug.slice(0, MAX_SLUG_LENGTH - HASH_DIGITS - 1).replace(/-+$/, "")}-${hash}`;
  }
  return slug === current ? undefined : slug;
}

/**
 * One stored account row's bytes with its slug repaired, or `undefined` when
 * the row is left as it is.
 */
export function repairedAccountSlugRow(data: Uint8Array): Uint8Array | undefined {
  const account = fromBinary(IdentityAccountSchema, data);
  const slug = repairAccountSlug(account);
  if (slug === undefined) {
    return undefined;
  }
  account.metadata = account.metadata ?? create(ApiResourceMetadataSchema);
  account.metadata.slug = slug;
  return toBinary(IdentityAccountSchema, account);
}
