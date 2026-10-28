import { describe, it, expect } from "vitest";
import { create, toJson } from "@bufbuild/protobuf";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationSpecSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import {
  IdentityAccountSchema,
  type IdentityAccount,
} from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSpecSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/spec_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import {
  buildOrganizationProto,
  toOrganizationInput,
} from "../gen/organization";
import {
  buildIdentityAccountProto,
  toIdentityAccountInput,
} from "../gen/identityaccount";

/**
 * A toXxxInput mapper restates a loaded resource as the input that makes
 * it again (a copy), so it must round-trip EVERY field of a loaded
 * resource through the generated builder without loss. These tests pin
 * that contract: fully-populated resource → mapper → builder → spec (as
 * JSON, defaults omitted) deep-equals the original. If a mapper drops a
 * field, a copy silently loses it.
 */

function fullOrganization(): Organization {
  return create(OrganizationSchema, {
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: {
      id: "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Acme Corp",
      slug: "acme",
      labels: { tier: "gold" },
      visibility: ApiResourceVisibility.visibility_private,
    },
    spec: {
      description: "We make everything.",
      logoUrl: "https://acme.example/logo.png",
      externalId: "cust-4411",
      parentOrg: "org_01jaaaaaaaaaaaaaaaaaaaaaaa",
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
      // The field declares its kind, so the builder writes it, as it does
      // every annotated reference.
      federationIssuerRef: { org: "acme", slug: "acme-okta", kind: ApiResourceKind.federation_issuer },
      preferences: {
        standingContext: "Keep answers terse.",
        defaultHarness: "claude",
        defaultNativeModel: "claude-sonnet-4.6",
        defaultClaudeModel: "claude-sonnet-5",
      },
    },
  });
}

describe("toOrganizationInput", () => {
  it("round-trips a fully-populated organization spec through the builder", () => {
    const org = fullOrganization();

    const built = buildOrganizationProto(toOrganizationInput(org));

    expect(toJson(OrganizationSpecSchema, built.spec!)).toEqual(
      toJson(OrganizationSpecSchema, org.spec!),
    );
    expect(built.metadata?.name).toBe("Acme Corp");
    expect(built.metadata?.slug).toBe("acme");
    expect(built.metadata?.org, "an organization belongs to no organization").toBe("");
    expect(built.metadata?.labels).toEqual({ tier: "gold" });
    expect(built.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_private,
    );
  });

  it("preserves preferences when a caller overrides only profile fields (the wipe-bug class)", () => {
    const org = fullOrganization();

    const built = buildOrganizationProto({
      ...toOrganizationInput(org),
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

    const built = buildOrganizationProto(toOrganizationInput(org));

    expect(toJson(OrganizationSpecSchema, built.spec!)).toEqual({});
  });

  it("carries no org: an organization's own metadata.org is always empty", () => {
    const org = create(OrganizationSchema, {
      metadata: { name: "Bare", slug: "bare" },
    });

    expect(toOrganizationInput(org).org).toBeUndefined();
  });

  it("carries metadata.id, which a copy clears", () => {
    const built = buildOrganizationProto(
      toOrganizationInput(fullOrganization()),
    );

    expect(built.metadata?.id).toBe("org_01jaaaaaaaaaaaaaaaaaaaaaaa");
  });
});

describe("toIdentityAccountInput", () => {
  it("round-trips a fully-populated identity account spec through the builder", () => {
    const account = fullIdentityAccount();

    const built = buildIdentityAccountProto(
      toIdentityAccountInput(account),
    );

    expect(toJson(IdentityAccountSpecSchema, built.spec!)).toEqual(
      toJson(IdentityAccountSpecSchema, account.spec!),
    );
    expect(built.metadata?.name).toBe("Ada Lovelace");
    expect(built.metadata?.labels).toEqual({ team: "platform" });
  });

  it("carries org and slug", () => {
    const input = toIdentityAccountInput(fullIdentityAccount());

    expect(input.org).toBe("acme");
    expect(input.slug).toBe("ada-lovelace");
  });

  it("carries metadata.id and the slug of a real (org-less) account", () => {
    // Identity accounts are platform-scoped: metadata.org is never set in
    // production, so the id and the slug are what name one.
    const account = create(IdentityAccountSchema, {
      metadata: {
        id: "ida_01JEXAMPLE",
        name: "ada@acme.example",
        slug: "ada-acme-example",
      },
      spec: { idpId: "auth0|abc123" },
    });

    const built = buildIdentityAccountProto(
      toIdentityAccountInput(account),
    );

    expect(built.metadata?.id).toBe("ida_01JEXAMPLE");
    expect(built.metadata?.slug).toBe("ada-acme-example");
  });

  it("preserves the rest of the spec when a caller overrides only preferences", () => {
    const account = fullIdentityAccount();
    const mapped = toIdentityAccountInput(account);

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
    const mapped = toIdentityAccountInput(account);

    // The correct editor pattern for a nested message: spread the mapper's
    // COMPLETE preferences and override only the edited field. A bare
    // `preferences: { standingContext }` literal would wipe the structured
    // defaults — the same whole-message wipe a partial input causes,
    // one level down.
    const built = buildIdentityAccountProto({
      ...mapped,
      preferences: { ...mapped.preferences, standingContext: "Terser still." },
    });

    expect(built.spec?.preferences?.standingContext).toBe("Terser still.");
    expect(built.spec?.preferences?.defaultHarness).toBe("claude");
    expect(built.spec?.preferences?.defaultNativeModel).toBe("claude-sonnet-4.6");
    expect(built.spec?.preferences?.defaultClaudeModel).toBe("claude-sonnet-5");
  });

  it("clears standing context to wire-absent when the text is emptied", () => {
    const account = fullIdentityAccount();
    const mapped = toIdentityAccountInput(account);

    const built = buildIdentityAccountProto({
      ...mapped,
      preferences: { ...mapped.preferences, standingContext: "" },
    });

    // Proto3 empty string is the field default — wire-identical to absent,
    // which the server compose steps treat as "no preference declared".
    expect(built.spec?.preferences?.standingContext ?? "").toBe("");
    // Clearing one field never disturbs its siblings.
    expect(built.spec?.preferences?.defaultHarness).toBe("claude");
  });
});
