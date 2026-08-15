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
//
// NESTED MESSAGE RULE: `CompleteInput` only sees TOP-LEVEL keys — a nested
// message (e.g. `preferences`) is one key whose object literal would keep
// compiling when codegen adds fields INSIDE it, recreating the wipe bug one
// level down. Every nested-message literal in this file must therefore be
// built by a dedicated `toXxxInput` helper whose return literal is itself
// typed `CompleteInput<XxxInput>`. Editors that override a nested message
// must spread the mapper's complete value and override only their fields:
//
//   preferences: { ...mapped.preferences, standingContext: next }

import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccountPreferences } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import type { OrganizationPreferences } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";
import type {
  IdentityAccountInput,
  IdentityAccountPreferencesInput,
} from "./gen/identityaccount.js";
import type {
  OrganizationInput,
  OrganizationPreferencesInput,
} from "./gen/organization.js";
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
 *
 * Carries `metadata.id` from the loaded resource: the update pipeline
 * addresses id-first (exact), falling back to org + slug only when the id
 * is absent.
 */
export function toOrganizationUpdateInput(
  org: Organization,
): OrganizationInput {
  const input: CompleteInput<OrganizationInput> = {
    id: org.metadata?.id || undefined,
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
      ? toOrganizationPreferencesInput(org.spec.preferences)
      : undefined,
  };
  return input;
}

/**
 * Maps loaded {@link OrganizationPreferences} to a complete
 * {@link OrganizationPreferencesInput} (nested-message rule above).
 */
function toOrganizationPreferencesInput(
  preferences: OrganizationPreferences,
): OrganizationPreferencesInput {
  const input: CompleteInput<OrganizationPreferencesInput> = {
    standingContext: preferences.standingContext || undefined,
  };
  return input;
}

/**
 * Maps a loaded {@link IdentityAccount} to a complete
 * {@link IdentityAccountInput} for `identityAccount.update()`.
 *
 * Carrying `metadata.id` is LOAD-BEARING here, not just an optimization:
 * identity accounts are platform-scoped (no `metadata.org`), so the update
 * pipeline's org + slug fallback structurally cannot match one (`'' = NULL`
 * is never true in the store). Only the id-first lookup can address the
 * resource.
 */
export function toIdentityAccountUpdateInput(
  account: IdentityAccount,
): IdentityAccountInput {
  const input: CompleteInput<IdentityAccountInput> = {
    id: account.metadata?.id || undefined,
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
      ? toIdentityAccountPreferencesInput(account.spec.preferences)
      : undefined,
  };
  return input;
}

/**
 * Maps loaded {@link IdentityAccountPreferences} to a complete
 * {@link IdentityAccountPreferencesInput} (nested-message rule above).
 */
function toIdentityAccountPreferencesInput(
  preferences: IdentityAccountPreferences,
): IdentityAccountPreferencesInput {
  const input: CompleteInput<IdentityAccountPreferencesInput> = {
    standingContext: preferences.standingContext || undefined,
    defaultHarness: preferences.defaultHarness || undefined,
    defaultNativeModel: preferences.defaultNativeModel || undefined,
    defaultCursorModel: preferences.defaultCursorModel || undefined,
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
