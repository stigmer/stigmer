import { describe, it, expect } from "vitest";
import { create, toJson } from "@bufbuild/protobuf";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSpecSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/spec_pb";
import { ManagementMode } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/enum_pb";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { buildOrganizationProto } from "../gen/organization";
import { buildIdentityAccountProto } from "../gen/identityaccount";
import {
  toOrganizationUpdateInput,
  toIdentityAccountUpdateInput,
} from "../update-input";

/**
 * Update RPCs are full-spec replacements, so a complete mapper must
 * round-trip EVERY mutable field of a loaded resource through the generated
 * builder without loss. These tests pin that contract: fully-populated
 * resource → mapper → builder → spec (as JSON, defaults omitted) deep-equals
 * the original. If a mapper drops a field, the wipe-bug class is back.
 */

function fullOrganization(): Organization {
  return create(OrganizationSchema, {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: {
      id: "acme",
      name: "Acme Corp",
      slug: "acme",
      org: "acme",
      labels: { tier: "gold" },
      visibility: ApiResourceVisibility.visibility_private,
    },
    spec: {
      description: "We make everything.",
      logoUrl: "https://acme.example/logo.png",
      managementMode: ManagementMode.self_managed,
      identityProviderRef: {
        org: "acme",
        slug: "acme-okta",
        kind: ApiResourceKind.identity_provider,
      },
      externalOrgId: "ext-org-1",
      isPersonal: true,
      preferences: { standingContext: "We deploy to us-east-1." },
    },
  });
}

function fullIdentityAccount(): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: {
      id: "ia-123",
      name: "Ada Lovelace",
      slug: "ada-lovelace",
      org: "acme",
      labels: { team: "platform" },
      visibility: ApiResourceVisibility.visibility_private,
    },
    spec: {
      idpId: "auth0|abc123",
      email: "ada@acme.example",
      firstName: "Ada",
      lastName: "Lovelace",
      pictureUrl: "https://acme.example/ada.png",
      isMachineAccount: true,
      provisioningMode: IdentityAccountProvisioningMode.federated,
      identityProviderRef: { org: "acme", slug: "acme-okta" },
      preferences: {
        standingContext: "Keep answers terse.",
        defaultHarness: "cursor",
        defaultNativeModel: "claude-sonnet-4.6",
        defaultCursorModel: "composer-2.5",
      },
    },
  });
}

describe("toOrganizationUpdateInput", () => {
  it("round-trips a fully-populated organization spec through the builder", () => {
    const org = fullOrganization();

    const built = buildOrganizationProto(toOrganizationUpdateInput(org));

    expect(toJson(OrganizationSpecSchema, built.spec!)).toEqual(
      toJson(OrganizationSpecSchema, org.spec!),
    );
    expect(built.metadata?.name).toBe("Acme Corp");
    expect(built.metadata?.slug).toBe("acme");
    expect(built.metadata?.org).toBe("acme");
    expect(built.metadata?.labels).toEqual({ tier: "gold" });
    expect(built.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_private,
    );
  });

  it("preserves preferences when a caller overrides only profile fields (the wipe-bug class)", () => {
    const org = fullOrganization();

    const built = buildOrganizationProto({
      ...toOrganizationUpdateInput(org),
      description: "New description",
    });

    expect(built.spec?.preferences?.standingContext).toBe(
      "We deploy to us-east-1.",
    );
    expect(built.spec?.description).toBe("New description");
    expect(built.spec?.logoUrl).toBe("https://acme.example/logo.png");
  });

  it("maps an empty spec without inventing values", () => {
    const org = create(OrganizationSchema, {
      metadata: { name: "Bare", slug: "bare", org: "bare" },
      spec: {},
    });

    const built = buildOrganizationProto(toOrganizationUpdateInput(org));

    expect(toJson(OrganizationSpecSchema, built.spec!)).toEqual({});
  });

  it("falls back to the slug when metadata.org is empty", () => {
    const org = create(OrganizationSchema, {
      metadata: { name: "Bare", slug: "bare" },
    });

    expect(toOrganizationUpdateInput(org).org).toBe("bare");
  });
});

describe("toIdentityAccountUpdateInput", () => {
  it("round-trips a fully-populated identity account spec through the builder", () => {
    const account = fullIdentityAccount();

    const built = buildIdentityAccountProto(
      toIdentityAccountUpdateInput(account),
    );

    expect(toJson(IdentityAccountSpecSchema, built.spec!)).toEqual(
      toJson(IdentityAccountSpecSchema, account.spec!),
    );
    expect(built.metadata?.name).toBe("Ada Lovelace");
    expect(built.metadata?.labels).toEqual({ team: "platform" });
  });

  it("carries org and slug — the update pipeline's fallback address", () => {
    const input = toIdentityAccountUpdateInput(fullIdentityAccount());

    expect(input.org).toBe("acme");
    expect(input.slug).toBe("ada-lovelace");
  });

  it("preserves the rest of the spec when a caller overrides only preferences", () => {
    const account = fullIdentityAccount();
    const mapped = toIdentityAccountUpdateInput(account);

    const built = buildIdentityAccountProto({
      ...mapped,
      preferences: { ...mapped.preferences, standingContext: "Prefer bullet points." },
    });

    expect(built.spec?.preferences?.standingContext).toBe(
      "Prefer bullet points.",
    );
    expect(built.spec?.email).toBe("ada@acme.example");
    expect(built.spec?.idpId).toBe("auth0|abc123");
    expect(built.spec?.provisioningMode).toBe(
      IdentityAccountProvisioningMode.federated,
    );
  });

  it("preserves structured defaults when only standing context is edited (nested wipe-bug class)", () => {
    const account = fullIdentityAccount();
    const mapped = toIdentityAccountUpdateInput(account);

    // The correct editor pattern for a nested message: spread the mapper's
    // COMPLETE preferences and override only the edited field. A bare
    // `preferences: { standingContext }` literal would wipe the structured
    // defaults — the session-4 wipe bug recurring one level down.
    const built = buildIdentityAccountProto({
      ...mapped,
      preferences: { ...mapped.preferences, standingContext: "Terser still." },
    });

    expect(built.spec?.preferences?.standingContext).toBe("Terser still.");
    expect(built.spec?.preferences?.defaultHarness).toBe("cursor");
    expect(built.spec?.preferences?.defaultNativeModel).toBe("claude-sonnet-4.6");
    expect(built.spec?.preferences?.defaultCursorModel).toBe("composer-2.5");
  });

  it("clears standing context to wire-absent when the text is emptied", () => {
    const account = fullIdentityAccount();
    const mapped = toIdentityAccountUpdateInput(account);

    const built = buildIdentityAccountProto({
      ...mapped,
      preferences: { ...mapped.preferences, standingContext: "" },
    });

    // Proto3 empty string is the field default — wire-identical to absent,
    // which the server compose steps treat as "no preference declared".
    expect(built.spec?.preferences?.standingContext ?? "").toBe("");
    // Clearing one field never disturbs its siblings.
    expect(built.spec?.preferences?.defaultHarness).toBe("cursor");
  });
});
