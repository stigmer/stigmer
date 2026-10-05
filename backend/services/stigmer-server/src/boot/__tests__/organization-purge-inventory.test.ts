/**
 * Pins the organization purge's composition (../organization-purge.ts).
 *
 * What it pins:
 *   - CORE_PURGED_KINDS, the list boot checks coverage with before its
 *     first side effect, is exactly the kinds of `newCoreKindPurges` plus
 *     `iam_policy`, each kind purged once;
 *   - the open-source edition's served organization-scoped kinds are all
 *     owned by the core, so it boots with no unit contributing anything;
 *   - a wider edition's kinds that units serve are refused until a unit
 *     removes or retains them, and a kind owned twice is refused;
 *   - the stage order: core quiesce, the units' stages in unit order, then
 *     content, shred, children, final.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import { silentLogger } from "../../extensions/__tests__/composed-support.js";
import type {
  OrganizationPurgeStage,
  ResolvedOrganizationPurge,
} from "../../extensions/organization-purge.js";
import { newResourceIdentityAccountStore } from "../../domain/identityaccount/resource-store.js";
import { newResourcePlatformClientStore } from "../../domain/platformclient/resource-store.js";
import { SecretService } from "../../encryption/encryption.js";
import { tempStore } from "../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../store/sqlite/__tests__/support.js";
import {
  CORE_PURGED_KINDS,
  assertOrganizationPurgeCoverage,
  newCoreKindPurges,
  orderOrganizationPurgeStages,
} from "../organization-purge.js";

const NO_UNITS: ResolvedOrganizationPurge = { stages: [], retains: [] };

function stage(
  name: string,
  kinds?: ReadonlyArray<ApiResourceKind>,
): OrganizationPurgeStage {
  return {
    name,
    ...(kinds === undefined ? {} : { kinds }),
    run: () => Promise.resolve({ more: false }),
  };
}

let fx: TempStore;

beforeEach(() => {
  fx = tempStore();
});

afterEach(async () => {
  await fx.cleanup();
});

describe("the core's kind purges", () => {
  it("CORE_PURGED_KINDS is the kind purges' kinds plus iam_policy, each purged once", () => {
    const purges = newCoreKindPurges({
      store: fx.store,
      logger: silentLogger,
      grantPath: { cleanupResource: () => Promise.resolve() },
      authorizationLifecycle: undefined,
      secretService: SecretService.create(undefined),
      artifactStorage: {
        delete: () => Promise.resolve(),
        download: () => Promise.resolve(new Uint8Array()),
        exists: () => Promise.resolve(false),
        upload: () => Promise.resolve(),
      },
      scheduleClock: () => undefined,
      channelRuntime: undefined,
      platformClients: newResourcePlatformClientStore(fx.store),
      accounts: newResourceIdentityAccountStore(fx.store),
      accountLifecycle: undefined,
    });
    const kinds = [purges.quiesce.kind, ...purges.content.map((p) => p.kind)];
    expect(new Set(kinds).size, "no kind is purged twice").toBe(kinds.length);
    expect(purges.quiesce.kind).toBe(ApiResourceKind.schedule);
    expect(
      [...new Set([...kinds, ApiResourceKind.iam_policy])].sort(),
    ).toEqual([...CORE_PURGED_KINDS].sort());
  });
});

describe("assertOrganizationPurgeCoverage", () => {
  it("the open-source edition boots with no unit contribution", () => {
    expect(() =>
      assertOrganizationPurgeCoverage({
        edition: ServerEdition.oss,
        coreKinds: CORE_PURGED_KINDS,
        units: NO_UNITS,
      }),
    ).not.toThrow();
  });

  it("refuses a wider edition whose units' kinds nothing removes or retains", () => {
    expect(() =>
      assertOrganizationPurgeCoverage({
        edition: ServerEdition.cloud,
        coreKinds: CORE_PURGED_KINDS,
        units: NO_UNITS,
      }),
    ).toThrow(/'identity_provider'.*'invitation'.*'subscription'.*'team'|nothing removes them/);
  });

  it("admits the wider edition once a unit removes or retains each kind", () => {
    expect(() =>
      assertOrganizationPurgeCoverage({
        edition: ServerEdition.cloud,
        coreKinds: CORE_PURGED_KINDS,
        units: {
          stages: [
            {
              unit: "identity",
              stage: stage("identity", [
                ApiResourceKind.identity_provider,
                ApiResourceKind.invitation,
                ApiResourceKind.team,
              ]),
            },
          ],
          retains: [
            {
              unit: "billing",
              retained: {
                kind: ApiResourceKind.subscription,
                reason: "money",
              },
            },
          ],
        },
      }),
    ).not.toThrow();
  });

  it("refuses a kind owned twice, naming both owners", () => {
    expect(() =>
      assertOrganizationPurgeCoverage({
        edition: ServerEdition.oss,
        coreKinds: CORE_PURGED_KINDS,
        units: {
          stages: [
            { unit: "extra", stage: stage("extra", [ApiResourceKind.agent]) },
          ],
          retains: [],
        },
      }),
    ).toThrow(/'agent' \(the core purge, extension 'extra' stage 'extra'\)/);
  });
});

describe("orderOrganizationPurgeStages", () => {
  it("runs core quiesce, the units' stages in unit order, then content, shred, children and final", () => {
    const order = orderOrganizationPurgeStages({
      quiesce: stage("quiesce"),
      units: {
        stages: [
          { unit: "billing", stage: stage("billing") },
          { unit: "channels", stage: stage("channels") },
        ],
        retains: [],
      },
      content: stage("content"),
      shred: stage("shred"),
      children: stage("children"),
      final: stage("final"),
    });
    expect(order.map((s) => s.name)).toEqual([
      "quiesce",
      "billing",
      "channels",
      "content",
      "shred",
      "children",
      "final",
    ]);
  });
});
