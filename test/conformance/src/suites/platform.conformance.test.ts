// Platform conformance — server identity, model readiness and runner bootstrap (Class A).
// Domain: conformance suites.
//
// PlatformQueryController is not a resource domain: it is the server's
// self-description surface. getServerInfo is what clients call on startup to
// learn the edition and version instead of guessing from the URL,
// getModelReadiness is what a member's client asks before a run (which
// models can run in this organization), and getRunnerBootstrapConfig is the
// one authenticated door an embedded runner self-bootstraps through. The contract asserted here is the response SHAPE
// both editions must honor:
//
//   - getServerInfo names a real edition (never unspecified), a non-empty
//     version, and what an Environment does on the server (`environments`,
//     present on every edition).
//   - getRunnerBootstrapConfig always carries reachable Temporal coordinates,
//     and its token/key fields follow the PRESENCE-BASED contract: an empty
//     token means "not minted" (OSS serves no side-channel proxy; a cloud
//     server may lack a signing key), and the companion fields (token_type,
//     expires_in_seconds, key ids) are present exactly when their principal
//     is — never half-populated. Clients branch on presence, so a
//     half-populated response is a broken contract even when every field is
//     individually well-formed.
//   - getLicenseStatus answers on every edition and follows the same
//     presence contract: the state names what the server holds, claims are
//     present exactly when a ticket verified, key_id exactly when a ticket
//     was presented, checked_at always. The open-source targets and the
//     cloud answer `absent` (neither holds a key); the enterprise target
//     answers `valid` from the license its primary runs on
//     (CapabilityFlags.licenseStatus).
//
//   - getModelReadiness answers every edition the same SHAPE for an
//     organization: the two providers (anthropic, openai) in the server's
//     order, each with a specified availability and a parent organization
//     exactly when one serves it; every catalog model on every offered
//     engine (stigmer, claude), each at its provider's availability by the
//     one rule (Claude needs anthropic, Stigmer needs its model's provider,
//     else no provider and unknown); the input's model judged exactly when
//     named. Whose keys
//     the answer reads differs by edition (the organization's own on the
//     cloud, the runners' declaration on open source), so the values are not
//     pinned here: that each answer is the refusal create gives is held by
//     suites-execution/run-admission.conformance.test.ts. Who may ask (any
//     member, never an outsider, NOT_FOUND for an organization the server
//     does not hold) runs on the target's enforcing lane.
//
// getRunnerScopedToken is deliberately NOT covered here: its arms are gated
// on runner-class credentials (embedded_runner / sandbox token types) that only exist mid-execution, so it belongs to the
// execution-lifecycle slice.
import { Code } from "@connectrpc/connect";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { LicenseState } from "@stigmer/apis/ai/stigmer/platform/v1/license_pb";
import {
  ProviderAvailability,
  type GetModelReadinessOutput,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { ServerEdition } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { foreignId, uniqueName } from "../support/naming";
import { createTarget, enforcingLaneOf, type EnforcingLane, type TargetProfile } from "../targets";

const capabilities = createTarget().capabilities;

let target: TargetProfile;
let clients: ConformanceClients;
let enforcing: Awaited<ReturnType<typeof enforcingLaneOf>>;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  enforcing = await enforcingLaneOf(target);
});

afterAll(async () => {
  await target?.teardown();
});

describe("Platform conformance — getServerInfo", () => {
  it("[rpc:PlatformQueryController.getServerInfo] names exactly the edition the target's composition declares, and a non-empty version", async () => {
    const info = await clients.platformQuery.getServerInfo({});

    expect(
      info.edition,
      "edition is the deployment-mode signal clients branch on — unspecified is a broken server",
    ).not.toBe(ServerEdition.server_edition_unspecified);
    // Equality, not membership: a composition that lost its edition
    // declaration falls back to oss, which a set check would still admit.
    expect(
      info.edition,
      `the ${target.name} target serves ${ServerEdition[target.edition]}`,
    ).toBe(target.edition);
    expect(info.version, "version must identify the build").not.toBe("");
    // What an Environment does here is a fact every edition states; each
    // answer is held to the refusal it predicts by
    // environment.conformance.test.ts.
    expect(info.environments, "every server that knows the field sets environments").toBeDefined();
  });

  it("[rpc:PlatformQueryController.getServerInfo] is stable across calls — server identity does not drift within a run", async () => {
    const first = await clients.platformQuery.getServerInfo({});
    const second = await clients.platformQuery.getServerInfo({});

    expect(second.edition).toBe(first.edition);
    expect(second.version).toBe(first.version);
  });
});

describe("Platform conformance — getLicenseStatus", () => {
  it.skipIf(capabilities.licenseStatus !== "absent")("[rpc:PlatformQueryController.getLicenseStatus] answers absent with no claims, no key and a checked_at — the presence contract of a keyless server", async () => {
    const status = await clients.platformQuery.getLicenseStatus({});

    expect(
      status.state,
      "unspecified is a broken server; a target that holds no key answers absent",
    ).toBe(LicenseState.absent);
    // Presence follows the state: absent means nothing was presented, so
    // there is no key to name and no claims to report.
    expect(status.claims, "absent carries no claims").toBeUndefined();
    expect(status.keyId, "absent names no key").toBe("");
    expect(status.checkedAt, "checked_at is always set").toBeDefined();
  });

  it.skipIf(capabilities.licenseStatus !== "licensed")("[rpc:PlatformQueryController.getLicenseStatus] answers valid with the ticket's claims, the key that signed it and a checked_at — the presence contract of a licensed server", async () => {
    const status = await clients.platformQuery.getLicenseStatus({});

    expect(status.state, "a current license verified at boot is valid").toBe(LicenseState.valid);
    // Presence follows the state: a ticket verified, so its claims are
    // reported, and the key it named is the issuer's signing key.
    expect(status.claims, "valid carries the ticket's claims").toBeDefined();
    expect(status.keyId, "valid names the key that signed the ticket").toMatch(/^license-signing:.+$/);
    expect(status.checkedAt, "checked_at is always set").toBeDefined();
  });
});

// The providers every answer reports, in the server's order: the names
// provider keys are saved under.
const READINESS_PROVIDERS = ["anthropic", "openai"];

// The engines a readiness answer lists models for, in the order it lists them.
const READINESS_ENGINES = [Harness.STIGMER, Harness.CLAUDE];

// Every availability a provider can be reported at; unspecified is a broken
// server.
const SPECIFIED_AVAILABILITIES = [
  ProviderAvailability.served_by_organization,
  ProviderAvailability.served_by_parent_organization,
  ProviderAvailability.served_by_runners,
  ProviderAvailability.missing_from_organization,
  ProviderAvailability.missing_from_runners,
  ProviderAvailability.availability_unknown,
];

function availabilityByProvider(answer: GetModelReadinessOutput): Map<string, ProviderAvailability> {
  return new Map(answer.providers.map((p) => [p.provider, p.availability]));
}

describe("Platform conformance — getModelReadiness", () => {
  it("[rpc:PlatformQueryController.getModelReadiness] reports exactly anthropic and openai in that order, each at a specified availability, naming a parent organization exactly when one serves it", async () => {
    const { org } = await target.provisionTenancy();
    const answer = await clients.platformQuery.getModelReadiness({ org });

    expect(answer.providers.map((p) => p.provider), "every provider, in the server's order").toEqual(READINESS_PROVIDERS);
    for (const provider of answer.providers) {
      expect(SPECIFIED_AVAILABILITIES, `${provider.provider} is at a specified availability`).toContain(
        provider.availability,
      );
      expect(
        provider.parentOrg !== "",
        `${provider.provider} names a parent organization exactly when one serves it`,
      ).toBe(provider.availability === ProviderAvailability.served_by_parent_organization);
    }
  });

  it("[rpc:PlatformQueryController.getModelReadiness] lists models on every offered engine in engine order, each at its provider's availability, and unknown where it names no provider", async () => {
    const { org } = await target.provisionTenancy();
    const answer = await clients.platformQuery.getModelReadiness({ org });
    const byProvider = availabilityByProvider(answer);

    const engines = answer.models.map((m) => m.harness);
    expect(new Set(engines), "every offered engine lists its models").toEqual(new Set(READINESS_ENGINES));
    expect(
      engines,
      "engine order: stigmer, then claude",
    ).toEqual([...engines].sort((a, b) => READINESS_ENGINES.indexOf(a) - READINESS_ENGINES.indexOf(b)));
    for (const model of answer.models) {
      expect(model.model, "a listed model names itself").not.toBe("");
      if (model.provider === "") {
        expect(model.availability, `${model.model} needs no provider the server judges`).toBe(
          ProviderAvailability.availability_unknown,
        );
        continue;
      }
      expect(READINESS_PROVIDERS, `${model.model} needs a reported provider`).toContain(model.provider);
      expect(model.availability, `${model.model} stands where ${model.provider} stands`).toBe(
        byProvider.get(model.provider),
      );
    }
  });

  it("[rpc:PlatformQueryController.getModelReadiness] a Claude model needs anthropic, and a Stigmer-harness model its own provider", async () => {
    const { org } = await target.provisionTenancy();
    const answer = await clients.platformQuery.getModelReadiness({ org });

    for (const model of answer.models) {
      switch (model.harness) {
        case Harness.CLAUDE:
          expect(model.provider, `the Claude engine runs ${model.model} on Anthropic`).toBe("anthropic");
          break;
        default:
          expect(["anthropic", "openai", ""], `${model.model} on the Stigmer harness needs its own provider`).toContain(
            model.provider,
          );
      }
    }
  });

  it("[rpc:PlatformQueryController.getModelReadiness] judges nothing when the input names no model, and judges an openai: model on the Stigmer harness as needing openai", async () => {
    const { org } = await target.provisionTenancy();

    const unnamed = await clients.platformQuery.getModelReadiness({ org });
    expect(unnamed.judged, "no model named, none judged").toBeUndefined();

    const model = `openai:${uniqueName("conformance-model")}`;
    const named = await clients.platformQuery.getModelReadiness({ org, model: { harness: Harness.STIGMER, model } });
    expect(named.judged, "the named model is judged").toBeDefined();
    expect(named.judged?.harness).toBe(Harness.STIGMER);
    expect(named.judged?.model, "the judged model is the reference the input named").toBe(model);
    expect(named.judged?.provider, "an openai: reference needs openai").toBe("openai");
    expect(named.judged?.availability, "judged at openai's availability").toBe(
      availabilityByProvider(named).get("openai"),
    );
  });

  // The shipped single-organization edition fills a request that names no
  // organization with its one (single-organization.conformance.test.ts), so
  // there the same input is answered, not refused.
  it.skipIf(capabilities.singleOrganization)("[rpc:PlatformQueryController.getModelReadiness] refuses an input naming no organization (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.platformQuery.getModelReadiness({ org: "" }),
      Code.InvalidArgument,
      "getModelReadiness with no organization",
    );
  });
});

describe("Platform conformance — getModelReadiness authorization (on the enforcing lane)", () => {
  function laneOrSkip(ctx: { skip: (note?: string) => never }): EnforcingLane {
    if (enforcing.lane === undefined) ctx.skip(enforcing.reason);
    return enforcing.lane;
  }

  it("[rpc:PlatformQueryController.getModelReadiness] a member of the organization may ask", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const tenancy = await lane.provisionTenancy();
    const member = await lane.provisionMember(tenancy);

    const answer = await member.platformQuery.getModelReadiness({ org: tenancy.org });
    expect(answer.providers.map((p) => p.provider)).toEqual(READINESS_PROVIDERS);
  });

  it("[rpc:PlatformQueryController.getModelReadiness] refuses a caller with no role on the organization (PermissionDenied, with the annotation copy)", async (ctx) => {
    const lane = laneOrSkip(ctx);
    const { org } = await lane.provisionTenancy();
    const outsider = await lane.provisionIdentity();

    const denied = await expectGrpcCode(
      () => outsider.platformQuery.getModelReadiness({ org }),
      Code.PermissionDenied,
      "an outsider asking for another organization's model readiness",
    );
    expect(denied.rawMessage).toBe("unauthorized to view this organization's models");
  });

  it("[rpc:PlatformQueryController.getModelReadiness] answers an organization the server does not hold NotFound", async (ctx) => {
    const lane = laneOrSkip(ctx);

    await expectGrpcCode(
      () => lane.clients.platformQuery.getModelReadiness({ org: foreignId("org") }),
      Code.NotFound,
      "model readiness for an organization the server does not hold",
    );
  });
});

describe("Platform conformance — getRunnerBootstrapConfig", () => {
  it("[rpc:PlatformQueryController.getRunnerBootstrapConfig] carries Temporal coordinates and presence-consistent token fields", async () => {
    const config = await clients.platformQuery.getRunnerBootstrapConfig({});

    expect(config.temporalAddress, "a runner cannot bootstrap without an address").not.toBe("");
    expect(config.temporalAddress, "address is host:port").toMatch(/^.+:\d+$/);
    expect(config.temporalNamespace, "a runner cannot bootstrap without a namespace").not.toBe("");

    // The presence-based token contract: all-or-nothing, never half-populated.
    if (config.runnerAccessToken === "") {
      expect(config.tokenType, "no token means no token_type").toBe("");
      expect(
        config.runnerAccessTokenExpiresInSeconds,
        "no token means no expiry countdown",
      ).toBe(0);
    } else {
      expect(config.tokenType, "a minted token is a Bearer token").toBe("Bearer");
      expect(
        config.runnerAccessTokenExpiresInSeconds,
        "a minted token carries its lifetime",
      ).toBeGreaterThan(0);
    }

    // The payload-encryption key pairs follow the same presence coupling.
    expect(
      config.payloadEncryptionKeyId === "",
      "key id is present exactly when the key is",
    ).toBe(config.payloadEncryptionKey === "");
    expect(
      config.payloadEncryptionSecondaryKeyId === "",
      "secondary key id is present exactly when the secondary key is",
    ).toBe(config.payloadEncryptionSecondaryKey === "");
  });
});
