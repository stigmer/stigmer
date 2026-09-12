/**
 * Pins the two registry points the identity-account domain adds
 * (20260911.11, Q-IA-9), in the O5 driver-point shape the registry already
 * enforces for organizationDirectory and listReadScope:
 *
 *   - `drivers.identityAccountStore` — the store driver (the cloud serves
 *     the domain over cloud.iam_identity_account through it); single
 *     instance; absent = the OSS adapter over the generic Store;
 *   - `drivers.identityFederation` — the four federation RPC arms plus
 *     providerExists; single instance; absent = the four RPCs refuse
 *     UNIMPLEMENTED with the edition reason (the domain suite pins the
 *     refusal; this file pins the registry);
 *   - the slot `identity-account-provision:post-persist` is declared and
 *     empty with no extensions (registry.test.ts pins the full slot roster).
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import type { IdentityAccountStore } from "../../domain/identityaccount/store.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import { DECLARED_GATE_SLOTS } from "../gate-slots.js";
import type { GateSlotName } from "../gate-slots.js";
import type { IdentityFederation } from "../identity-federation.js";
import { resolveExtensions } from "../registry.js";

const unimplemented = () => Promise.reject(new Error("not exercised here"));

const store: IdentityAccountStore = {
  save: unimplemented,
  update: unimplemented,
  deleteById: unimplemented,
  findById: unimplemented,
  findByIdpId: unimplemented,
  findDirectByIdpId: unimplemented,
  findDirectByEmail: unimplemented,
  findByIds: unimplemented,
};

const federation: IdentityFederation = {
  createFederatedAccount: unimplemented,
  updateFederatedAccount: unimplemented,
  deprovisionFederatedAccount: unimplemented,
  getByExternalSub: unimplemented,
  providerExists: unimplemented,
};

describe("the identityAccountStore driver point", () => {
  it("is undefined with no extensions — the OSS adapter serves", () => {
    expect(resolveExtensions([]).drivers.identityAccountStore).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { identityAccountStore: store } },
    ]);
    expect(resolved.drivers.identityAccountStore).toBe(store);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "store-a", drivers: { identityAccountStore: store } },
        { name: "store-b", drivers: { identityAccountStore: store } },
      ]),
    ).toThrowError(
      /extension 'store-b' registers an IdentityAccountStore, but 'store-a' already did/,
    );
  });
});

describe("the identityFederation capability point", () => {
  it("is undefined with no extensions — the four RPCs refuse", () => {
    expect(resolveExtensions([]).drivers.identityFederation).toBeUndefined();
  });

  it("carries the one registered instance through", () => {
    const resolved = resolveExtensions([
      { name: "cloud-iam", drivers: { identityFederation: federation } },
    ]);
    expect(resolved.drivers.identityFederation).toBe(federation);
  });

  it("throws on a second registration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "fed-a", drivers: { identityFederation: federation } },
        { name: "fed-b", drivers: { identityFederation: federation } },
      ]),
    ).toThrowError(
      /extension 'fed-b' registers an IdentityFederation, but 'fed-a' already did/,
    );
  });
});

describe("the identity-account-provision:post-persist slot", () => {
  it("is declared vocabulary and empty with no extensions", () => {
    expect(
      DECLARED_GATE_SLOTS.has("identity-account-provision:post-persist"),
    ).toBe(true);
    expect(
      resolveExtensions([]).gateSteps.get(
        "identity-account-provision:post-persist",
      ),
    ).toBeUndefined();
  });

  it("accepts a gate step from a unit and keeps unit order", () => {
    const step = (name: string): PipelineStep<DescMessage> => ({
      name,
      execute: () => Promise.resolve(),
    });
    const resolved = resolveExtensions([
      {
        name: "cloud-iam",
        gateSteps: new Map<GateSlotName, PipelineStep<DescMessage>[]>([
          [
            "identity-account-provision:post-persist",
            [step("EnsurePersonalOrganization")],
          ],
        ]),
      },
    ]);
    expect(
      resolved.gateSteps
        .get("identity-account-provision:post-persist")
        ?.map((s) => s.name),
    ).toEqual(["EnsurePersonalOrganization"]);
  });
});
