/**
 * The license verdict as units (editions/enterprise.ts), without a
 * database: what `composeEnterprise` hands the library's process body.
 *
 *   - no key, or a blank one: exactly the open-source edition's unit, the
 *     shipped server's own, even when the Enterprise egress variable holds
 *     a value the licensed server would refuse;
 *   - a verified key: two units. `enterprise-license` declares the
 *     Enterprise edition, the organization limit the license grants (none
 *     when it grants none), reports the license, signs the server's own
 *     tokens with open source's ring on its key ladder (a configured key
 *     that does not load refuses the boot), registers the grant scope, and
 *     refuses a person's new organization once the license has lapsed
 *     while admitting the server acting as itself, warns at boot exactly
 *     when the license has already ended, and declares the
 *     access history's window when the operator set one (logged at boot
 *     either way); with no key the window is not composed; registers the
 *     operator's list of who may create an organization ahead of the
 *     growth gate only when a list is set (logged at boot either way);
 *     `enterprise-identity` is the identity unit. Neither declares the
 *     require-authentication posture.
 *
 * The pool a licensed server builds over DATABASE_URL opens no connection
 * until it is used, so these cases compose without a database.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { CallerIdentity, PipelineStep } from "@stigmer/server";
import { createLogger, loadConfig, openSourceEdition, RequestContext, serverActingFor } from "@stigmer/server";

import { ENTERPRISE_IDENTITY_UNIT } from "../../extension/enterprise-identity.js";
import { LICENSE_RENEWAL_MESSAGE } from "../../license/growth.js";
import { licenseClaims, newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import { readEnterpriseSettings } from "../enterprise-config.js";
import { composeEnterprise, ENTERPRISE_LICENSE_UNIT } from "../enterprise.js";
import { ORGANIZATION_CREATORS_STEP } from "../organization-creators.js";
import { SILENT_LOGGER } from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
/** The token key ladder's place for these cases: their own home, never the person's running them. */
const KEY_LOADER = { env: {}, homeDir: mkdtempSync(path.join(tmpdir(), "enterprise-keys-")) };
const boot = {
  config: loadConfig({
    STIGMER_MODEL_REGISTRY_REFRESH: "off",
    DATABASE_URL: "postgres://unused@127.0.0.1:1/unused",
    STIGMER_OIDC_ISSUER: "https://sso.acme.example",
    STIGMER_OIDC_AUDIENCE: "https://stigmer.acme.example/api",
  }),
  logger: SILENT_LOGGER,
};

/** An organization create's context for `caller`, as the library's chain hands it to the slot. */
function creating(caller: CallerIdentity): RequestContext<typeof OrganizationSchema> {
  return new RequestContext(
    OrganizationSchema,
    create(OrganizationSchema, { metadata: { slug: "acme" } }),
    caller,
    ApiResourceKind.organization,
  );
}

describe("composeEnterprise: the verdict as units", () => {
  it.each([
    ["no key", undefined],
    ["an empty key", ""],
    ["a key of whitespace", "  \n "],
  ])("composes exactly the open-source edition for %s", async (_name, licenseKey) => {
    expect(await composeEnterprise(boot, { licenseKey })).toEqual([openSourceEdition]);
  });

  it("composes exactly the open-source edition from the entry's reading when no key is set and the egress variable is a typo", async () => {
    const settings = readEnterpriseSettings({ STIGMER_OUTBOUND_EGRESS: "bogus" });
    expect(await composeEnterprise(boot, settings)).toEqual([openSourceEdition]);
  });

  it("composes the license unit and the identity unit for a verified key, the limit from the license", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30, maxOrgs: 3 });
    const units = await composeEnterprise(boot, { licenseKey: writeTicket(signer, claims), ring: signer.ring, keyLoader: KEY_LOADER });
    expect(units.map((unit) => unit.name)).toEqual([ENTERPRISE_LICENSE_UNIT, ENTERPRISE_IDENTITY_UNIT]);
    const [license, identity] = units;
    expect(license?.edition).toBe(ServerEdition.enterprise);
    expect(license?.orgLimit).toBe(3);
    expect(license?.drivers?.licenseStatus).toBeDefined();
    expect(license?.drivers?.grantScope).toBeDefined();
    expect(license?.drivers?.platformTokenKeys?.signer).toBeDefined();
    expect(license?.drivers?.outboundEgress?.name).toBe("strict");
    expect(license?.drivers?.outboundEgress?.blockedReason("127.0.0.1")).not.toBeNull();
    expect(license?.drivers?.outboundEgress?.blockedReason("10.0.0.5")).not.toBeNull();
    expect(license?.gateSteps?.get("org-create:pre-side-effect-gate")?.map((step) => step.name)).toEqual([
      "GrowthGate",
    ]);
    expect(license?.onComposed).toBeDefined();
    expect(identity?.drivers?.grantScope).toBeUndefined();
    for (const unit of units) {
      expect(unit.requireAuthentication, unit.name).toBeUndefined();
    }
  });

  it("refuses the boot when a configured token key does not load, as the open-source ladder does", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
    await expect(
      composeEnterprise(boot, {
        licenseKey: writeTicket(signer, claims),
        ring: signer.ring,
        keyLoader: {
          env: { STIGMER_PLATFORM_TOKEN_KEY: Buffer.from("not a key").toString("base64") },
          homeDir: KEY_LOADER.homeDir,
        },
      }),
    ).rejects.toThrow(/STIGMER_PLATFORM_TOKEN_KEY/);
  });

  it("trusts only the compiled keys when no ring is passed, so a ticket signed by any other key is refused as unknown", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
    await expect(
      composeEnterprise(boot, { licenseKey: writeTicket(signer, claims), keyLoader: KEY_LOADER }),
    ).rejects.toThrow(/signed by a key this build of Stigmer Enterprise does not trust/);
  });

  it("warns when the token key comes from the home directory rather than the variable, and not when the variable is set", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
    const warnings: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: (line: string) => {
        warnings.push(String((JSON.parse(line) as { message?: unknown }).message ?? ""));
      },
    });
    await composeEnterprise(
      { config: boot.config, logger },
      { licenseKey: writeTicket(signer, claims), ring: signer.ring, keyLoader: KEY_LOADER },
    );
    expect(warnings.filter((message) => message.startsWith("STIGMER_PLATFORM_TOKEN_KEY is not set"))).toHaveLength(1);

    warnings.length = 0;
    await composeEnterprise(
      { config: boot.config, logger },
      {
        licenseKey: writeTicket(signer, claims),
        ring: signer.ring,
        keyLoader: { env: { STIGMER_PLATFORM_TOKEN_KEY: "" }, homeDir: KEY_LOADER.homeDir },
      },
    );
    expect(warnings.filter((message) => message.startsWith("STIGMER_PLATFORM_TOKEN_KEY is not set"))).toHaveLength(1);

    warnings.length = 0;
    const { generateKeyPairSync } = await import("node:crypto");
    const pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
    await composeEnterprise(
      { config: boot.config, logger },
      {
        licenseKey: writeTicket(signer, claims),
        ring: signer.ring,
        keyLoader: { env: { STIGMER_PLATFORM_TOKEN_KEY: Buffer.from(pem).toString("base64") }, homeDir: KEY_LOADER.homeDir },
      },
    );
    expect(warnings).toEqual([]);
  });

  it("registers the relaxed posture only on the operator's word: private addresses reachable, link-local still refused", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
    const [license] = await composeEnterprise(boot, {
      licenseKey: writeTicket(signer, claims),
      ring: signer.ring,
      keyLoader: KEY_LOADER,
      egress: "relaxed",
    });
    const policy = license?.drivers?.outboundEgress;
    expect(policy?.name).toBe("relaxed");
    expect(policy?.blockedReason("10.0.0.5")).toBeNull();
    expect(policy?.blockedReason("169.254.169.254")).not.toBeNull();
  });

  it("reads the wall clock when none is passed: a license whose grace has ended refuses a person's new organization, not the server's own", async () => {
    const signer = newTestSigner();
    const ended = licenseClaims({ issuedAt: new Date("2026-01-01T00:00:00Z"), days: 30, graceDays: 7 });
    const [license] = await composeEnterprise(boot, {
      licenseKey: writeTicket(signer, ended),
      ring: signer.ring,
      keyLoader: KEY_LOADER,
    });
    const [growth] = (license?.gateSteps?.get("org-create:pre-side-effect-gate") ?? []) as ReadonlyArray<
      PipelineStep<typeof OrganizationSchema>
    >;
    const person: CallerIdentity = {
      identityId: "ida_0123456789abcdefghjkmnpqrs",
      callerClass: "user",
      issuer: "https://sso.acme.example",
      rawToken: "t",
    };
    await expect(growth?.execute(creating(person))).rejects.toThrow(/license has ended/);
    await expect(growth?.execute(creating(serverActingFor("system")))).resolves.toBeUndefined();
  });

  it("warns at boot with the renewal copy when the license has already ended, and not while it is current", async () => {
    const signer = newTestSigner();
    const warnings: string[] = [];
    const logger = createLogger({
      level: "warn",
      pretty: false,
      write: (line: string) => {
        warnings.push(String((JSON.parse(line) as { message?: unknown }).message ?? ""));
      },
    });
    const issuedAt = new Date("2026-01-01T00:00:00Z");
    const ended = licenseClaims({ issuedAt, days: 30, graceDays: 7 });
    const options = { ring: signer.ring, keyLoader: KEY_LOADER };
    await composeEnterprise(
      { config: boot.config, logger },
      { ...options, licenseKey: writeTicket(signer, ended), clock: () => new Date(issuedAt.getTime() + 38 * 24 * 60 * 60 * 1000) },
    );
    expect(warnings.filter((message) => message === LICENSE_RENEWAL_MESSAGE)).toHaveLength(1);

    warnings.length = 0;
    await composeEnterprise(
      { config: boot.config, logger },
      { ...options, licenseKey: writeTicket(signer, ended), clock: () => new Date(issuedAt.getTime() + 36 * 24 * 60 * 60 * 1000) },
    );
    expect(warnings, "inside grace").not.toContain(LICENSE_RENEWAL_MESSAGE);
  });

  it("declares the operator's access-history window on the license unit, and logs how long the history is kept", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      pretty: false,
      write: (line: string) => {
        lines.push(String((JSON.parse(line) as { message?: unknown }).message ?? ""));
      },
    });
    const licensed = { licenseKey: writeTicket(signer, claims), ring: signer.ring, keyLoader: KEY_LOADER };
    const [windowed] = await composeEnterprise(
      { config: boot.config, logger },
      { ...licensed, accessHistoryRetentionDays: 365 },
    );
    expect(windowed?.accessHistoryRetentionDays).toBe(365);
    expect(lines).toContain("access history kept for 365 days");

    lines.length = 0;
    const [forGood] = await composeEnterprise({ config: boot.config, logger }, licensed);
    expect(forGood?.accessHistoryRetentionDays).toBeUndefined();
    expect(lines).toContain("access history kept for good");

    expect(await composeEnterprise(boot, { licenseKey: undefined, accessHistoryRetentionDays: 365 })).toEqual([
      openSourceEdition,
    ]);
  });

  it("registers the creators list ahead of the growth gate only when one is set, and logs who may create", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
    const lines: string[] = [];
    const logger = createLogger({
      level: "info",
      pretty: false,
      write: (line: string) => {
        lines.push(String((JSON.parse(line) as { message?: unknown }).message ?? ""));
      },
    });
    const licensed = { licenseKey: writeTicket(signer, claims), ring: signer.ring, keyLoader: KEY_LOADER };
    const slot = (unit: Awaited<ReturnType<typeof composeEnterprise>>[number] | undefined) =>
      unit?.gateSteps?.get("org-create:pre-side-effect-gate")?.map((step) => step.name);

    const [listed] = await composeEnterprise(
      { config: boot.config, logger },
      { ...licensed, organizationCreators: new Set(["ida_0123456789abcdefghjkmnpqrs", "ida_tvwxyz0123456789abcdefghjk"]) },
    );
    expect(slot(listed)).toEqual([ORGANIZATION_CREATORS_STEP, "GrowthGate"]);
    expect(lines).toContain("organizations may be created by 2 listed accounts");

    lines.length = 0;
    const [open] = await composeEnterprise({ config: boot.config, logger }, licensed);
    expect(slot(open)).toEqual(["GrowthGate"]);
    expect(lines).toContain("organizations may be created by anyone signed in");

    expect(
      await composeEnterprise(boot, { licenseKey: undefined, organizationCreators: new Set(["ida_0123456789abcdefghjkmnpqrs"]) }),
    ).toEqual([openSourceEdition]);
  });

  it("declares no organization limit when the license grants none", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
    const [license] = await composeEnterprise(boot, { licenseKey: writeTicket(signer, claims), ring: signer.ring, keyLoader: KEY_LOADER });
    expect(license?.orgLimit).toBeUndefined();
  });

  it("reports the verified license's state at the time the library asks", async () => {
    const signer = newTestSigner();
    const claims = licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 });
    const [license] = await composeEnterprise(boot, { licenseKey: writeTicket(signer, claims), ring: signer.ring, keyLoader: KEY_LOADER });
    const status = await license?.drivers?.licenseStatus?.status(new Date(ISSUED.getTime() + 24 * 60 * 60 * 1000));
    expect(status).toMatchObject({ keyId: signer.keyId });
  });
});
