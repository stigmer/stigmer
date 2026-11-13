// `stigmer embedding [set]` (commands/embedding.ts), its pure halves: the
// flags read into the two settings `set` changes; the settings after a
// change (a role needs account creation on, so a role asked for turns it on
// and turning it off clears the role); and the settings as a person reads
// them, origins and vaults shown as they stand.

import { create } from "@bufbuild/protobuf";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { UsageError } from "../../errors/index.js";
import { embeddingResult, nextSettings, parseSetFlags } from "../embedding.js";

const OFF = { createAccountsOnSignIn: false, signInRole: IamRole.iam_role_unspecified };
const MEMBER = { createAccountsOnSignIn: true, signInRole: IamRole.member };

describe("parseSetFlags", () => {
  it("reads on/off and a role word", () => {
    expect(parseSetFlags({ createAccountsOnSignIn: "on", signInRole: "member" })).toEqual(MEMBER);
    expect(parseSetFlags({ createAccountsOnSignIn: "OFF" })).toEqual({ createAccountsOnSignIn: false });
    expect(parseSetFlags({ signInRole: "none" })).toEqual({ signInRole: IamRole.iam_role_unspecified });
  });
  it("refuses owner, an unknown word, and nothing to change", () => {
    expect(() => parseSetFlags({ signInRole: "owner" })).toThrow(/cannot be owner/);
    expect(() => parseSetFlags({ createAccountsOnSignIn: "yes" })).toThrow(UsageError);
    expect(() => parseSetFlags({})).toThrow(/nothing to change/);
  });
});

describe("nextSettings", () => {
  it("turns account creation on with the role it is given", () => {
    expect(nextSettings(OFF, MEMBER)).toEqual(MEMBER);
    expect(nextSettings(OFF, { signInRole: IamRole.viewer })).toEqual({ createAccountsOnSignIn: true, signInRole: IamRole.viewer });
  });
  it("keeps the role when only creation is said, and clears it when creation goes off", () => {
    expect(nextSettings(MEMBER, { createAccountsOnSignIn: true })).toEqual(MEMBER);
    expect(nextSettings(MEMBER, { createAccountsOnSignIn: false })).toEqual(OFF);
  });
  it("refuses a role with account creation off", () => {
    expect(() => nextSettings(OFF, { createAccountsOnSignIn: false, signInRole: IamRole.member })).toThrow(/needs account creation on/);
  });
});

describe("embeddingResult", () => {
  it("shows creation, role, origins and vaults as they stand", () => {
    const organization = create(OrganizationSchema, {
      metadata: { id: "org_1", slug: "acme" },
      spec: { embedding: { createAccountsOnSignIn: true, signInRole: IamRole.member, allowedOrigins: ["https://app.acme.test"] } },
    });
    const result = embeddingResult(organization, "Embedding settings");
    expect(result.sections[0]?.fields).toEqual([
      { key: "Organization", value: "acme" },
      { key: "Accounts on sign-in", value: "made on a person's first sign-in" },
      { key: "Their role", value: "member" },
      { key: "Allowed origins", value: "https://app.acme.test" },
      { key: "Vaults", value: "none" },
    ]);
    expect(result.hints).toEqual([]);
  });
  it("names a role set does not offer by its own name", () => {
    const organization = create(OrganizationSchema, {
      metadata: { slug: "acme" },
      spec: { embedding: { createAccountsOnSignIn: true, signInRole: IamRole.owner } },
    });
    expect(embeddingResult(organization, "Embedding settings").sections[0]?.fields[2]).toEqual({ key: "Their role", value: "owner" });
  });

  it("says how to let an app's users in when creation is off", () => {
    const result = embeddingResult(create(OrganizationSchema, { metadata: { slug: "acme" } }), "Embedding settings");
    expect(result.sections[0]?.fields[1]).toEqual({ key: "Accounts on sign-in", value: "off: your app makes them first" });
    expect(result.hints[0]).toContain("stigmer embedding set --create-accounts-on-sign-in on --sign-in-role member");
  });
});
