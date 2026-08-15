// Complete update-input mappers.
//
// The platform's update RPCs are FULL-SPEC REPLACEMENTS: the request spec
// wholesale overwrites the stored spec (both editions; only a small
// server-side preserve list of immutable identifiers survives). A client
// that sends only the fields it edits therefore silently WIPES every other
// mutable spec field — a data-loss bug class, not a single bug
// (stigmer/stigmer#293 Phase 1 surfaced it when `spec.preferences` set via
// CLI was dropped by a console profile save).
//
// These mappers are the structural fix: they convert a LOADED resource into
// a complete `*Input` for the generated update builders. Editors spread the
// mapper output and override only the fields they edit:
//
//   await update({ ...toOrganizationUpdateInput(org), description: next });
//
// The `CompleteInput` mapped type removes optionality from every Input key,
// so when codegen adds a new Input field, compilation fails HERE — the one
// place a human must decide how the new field round-trips — instead of the
// field silently wiping in every subset-editing form.

import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { IdentityAccountInput } from "./gen/identityaccount.js";
import type { OrganizationInput } from "./gen/organization.js";
import type { ResourceRef } from "./gen/types.js";

/**
 * Every key of `T`, required to be present. Optional keys keep their
 * `| undefined` value type (explicit `undefined` is stripped by the proto
 * builders), so a mapper cannot compile while omitting an Input field.
 *
 * Mapping over `keyof Required<T>` (instead of a homomorphic `-?` map)
 * is deliberate: `-?` would also strip `undefined` from optional value
 * types, forcing fake values for genuinely absent fields.
 */
type CompleteInput<T> = { [K in keyof Required<T>]: T[K] };

/**
 * Maps a loaded {@link Organization} to a complete {@link OrganizationInput}
 * for `organization.update()`.
 *
 * Proto3 scalar defaults (empty string, `false`, enum `0`) are normalized to
 * `undefined` — omitting them is wire-identical to sending the default, and
 * it keeps the built proto in the builders' canonical shape.
 */
export function toOrganizationUpdateInput(
  org: Organization,
): OrganizationInput {
  const input: CompleteInput<OrganizationInput> = {
    name: org.metadata?.name ?? "",
    slug: org.metadata?.slug || undefined,
    org: org.metadata?.org || org.metadata?.slug || "",
    labels: nonEmptyLabels(org.metadata?.labels),
    visibility: org.metadata?.visibility || undefined,
    description: org.spec?.description || undefined,
    logoUrl: org.spec?.logoUrl || undefined,
    managementMode: org.spec?.managementMode || undefined,
    identityProviderRef: toResourceRef(org.spec?.identityProviderRef),
    externalOrgId: org.spec?.externalOrgId || undefined,
    isPersonal: org.spec?.isPersonal || undefined,
    preferences: org.spec?.preferences
      ? { standingContext: org.spec.preferences.standingContext || undefined }
      : undefined,
  };
  return input;
}

/**
 * Maps a loaded {@link IdentityAccount} to a complete
 * {@link IdentityAccountInput} for `identityAccount.update()`.
 *
 * The generated builder never sets `metadata.id`; the update pipeline
 * locates the resource by org + slug instead (and authorizes against the
 * loaded resource's id), so carrying `org` and `slug` here is what makes
 * the update addressable.
 */
export function toIdentityAccountUpdateInput(
  account: IdentityAccount,
): IdentityAccountInput {
  const input: CompleteInput<IdentityAccountInput> = {
    name: account.metadata?.name ?? "",
    slug: account.metadata?.slug || undefined,
    org: account.metadata?.org ?? "",
    labels: nonEmptyLabels(account.metadata?.labels),
    visibility: account.metadata?.visibility || undefined,
    idpId: account.spec?.idpId ?? "",
    email: account.spec?.email || undefined,
    firstName: account.spec?.firstName || undefined,
    lastName: account.spec?.lastName || undefined,
    pictureUrl: account.spec?.pictureUrl || undefined,
    isMachineAccount: account.spec?.isMachineAccount || undefined,
    provisioningMode: account.spec?.provisioningMode || undefined,
    identityProviderRef: toResourceRef(account.spec?.identityProviderRef),
    preferences: account.spec?.preferences
      ? {
          standingContext:
            account.spec.preferences.standingContext || undefined,
        }
      : undefined,
  };
  return input;
}

function nonEmptyLabels(
  labels: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return labels && Object.keys(labels).length > 0 ? labels : undefined;
}

function toResourceRef(
  ref: ApiResourceReference | undefined,
): ResourceRef | undefined {
  // The builders treat a ref without org and slug as absent; mirror that so
  // an empty message round-trips to "no reference".
  if (!ref || (!ref.org && !ref.slug)) return undefined;
  return {
    org: ref.org,
    slug: ref.slug,
    ...(ref.version && { version: ref.version }),
    ...(ref.kind && { kind: ref.kind }),
  };
}
