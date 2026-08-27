/**
 * Pins the extension registry's merge semantics and the DD-006 §2b
 * loud-fail contract (sub-project 20260826.09/O1): explicit empty
 * defaults, unit-order concatenation for list points, single-declaration
 * enforcement for authorizer and edition, unique unit names, the
 * unknown-gate-slot boot throw, and the O5 driver points (single-instance
 * providers, name-keyed storage-driver registration with duplicate and
 * built-in-shadow throws). The composed-server behavior (services on
 * both routers, edition on the wire) is pinned by
 * extension-composition.test.ts; empty-set wire byte-identity is pinned by
 * the conformance rosters.
 */
import { describe, expect, it } from "vitest";

import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import type { DescMessage } from "@bufbuild/protobuf";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import type { ModelCatalogProvider } from "../../domain/workflow/registry/model-catalog-provider.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import type { WorkerFactory } from "../../temporal/manager.js";
import type { Authorizer } from "../authorizer.js";
import { DECLARED_GATE_SLOTS, GATE_SLOT_NAMES } from "../gate-slots.js";
import type { GateSlotName } from "../gate-slots.js";
import type { IdentityVerifier } from "../identity.js";
import { resolveExtensions } from "../registry.js";
import type { ServerExtension } from "../registry.js";

const allowAll: Authorizer = {
  authorize: () => Promise.resolve({ kind: "allow" }),
};

const denyAll: Authorizer = {
  authorize: () => Promise.resolve({ kind: "deny", reason: "unit test" }),
};

function verifier(name: string): IdentityVerifier {
  return { name, verify: () => Promise.resolve(null) };
}

// Never invoked — the factory's identity is what the merge tests assert.
const workerFactory: WorkerFactory = () =>
  Promise.reject(new Error("unit-test worker factory — never started"));

// Driver fakes: identity is all the merge tests assert; no method runs.
function fakeCatalog(): ModelCatalogProvider {
  return {
    document: () => "{}",
    isValidModel: () => false,
    hasHarness: () => false,
    hasAnyModels: () => false,
    isValidModelOnAnyHarness: () => false,
    canonicalModelsAcrossHarnesses: () => [],
    canonicalModels: () => [],
    hasPricingVariant: () => false,
    hasPricingVariantForHarness: () => false,
    canonicalModelsWithVariant: () => [],
    canonicalModelsWithVariantForHarness: () => [],
    hasCapabilityForHarness: () => false,
    canonicalModelsWithCapabilityForHarness: () => [],
  };
}

function fakeCredentials(): RunnerCredentialProvider {
  return {
    isEnabled: () => false,
    mint: () => {
      throw new Error("unit-test credential provider — never minted");
    },
    verify: () => {
      throw new Error("unit-test credential provider — never verified");
    },
  };
}

const fakeStorageDriver = (): ArtifactStorage => {
  throw new Error("unit-test storage driver factory — never constructed");
};

describe("resolveExtensions — defaults", () => {
  it("resolves the omitted set to explicit empty defaults, edition oss", () => {
    const resolved = resolveExtensions();
    expect(resolved.unitNames).toEqual([]);
    expect(resolved.edition).toBe(ServerEdition.oss);
    expect(resolved.authorizer).toBeUndefined();
    expect(resolved.identityVerifiers).toEqual([]);
    expect(resolved.gateSteps.size).toBe(0);
    expect(resolved.statusObservers).toEqual([]);
    expect(resolved.responseDecorators).toEqual([]);
    expect(resolved.drivers.modelCatalogProvider).toBeUndefined();
    expect(resolved.drivers.runnerCredentialProvider).toBeUndefined();
    expect(resolved.drivers.artifactStorageDrivers.size).toBe(0);
    expect(resolved.services).toEqual([]);
    expect(resolved.workers).toEqual([]);
  });

  it("resolves the empty list identically to the omitted set", () => {
    expect(resolveExtensions([])).toEqual(resolveExtensions());
  });
});

describe("resolveExtensions — merge semantics", () => {
  it("concatenates list points in unit order and keeps declared singletons", () => {
    const registerA = (): void => {};
    const registerB = (): void => {};
    const observerA = (): void => {};
    const decoratorB = (): void => {};
    const resolved = resolveExtensions([
      {
        name: "alpha",
        identityVerifiers: [verifier("a1"), verifier("a2")],
        services: [registerA],
        statusTransitionHooks: { observers: [observerA] },
      },
      {
        name: "beta",
        edition: ServerEdition.cloud,
        authorizer: allowAll,
        identityVerifiers: [verifier("b1")],
        services: [registerB],
        workers: [workerFactory],
        statusTransitionHooks: { responseDecorators: [decoratorB] },
      },
    ]);
    expect(resolved.unitNames).toEqual(["alpha", "beta"]);
    expect(resolved.edition).toBe(ServerEdition.cloud);
    expect(resolved.authorizer).toBe(allowAll);
    expect(resolved.identityVerifiers.map((v) => v.name)).toEqual([
      "a1",
      "a2",
      "b1",
    ]);
    expect(resolved.services).toEqual([registerA, registerB]);
    expect(resolved.workers).toEqual([workerFactory]);
    expect(resolved.statusObservers).toEqual([observerA]);
    expect(resolved.responseDecorators).toEqual([decoratorB]);
  });

  it("merges the O5 driver points: singleton providers, name-keyed storage drivers across units", () => {
    const catalog = fakeCatalog();
    const credentials = fakeCredentials();
    const resolved = resolveExtensions([
      {
        name: "catalog-unit",
        drivers: {
          modelCatalogProvider: catalog,
          artifactStorageDrivers: new Map([["r2-skill", fakeStorageDriver]]),
        },
      },
      {
        name: "credential-unit",
        drivers: {
          runnerCredentialProvider: credentials,
          artifactStorageDrivers: new Map([
            ["r2-artifacts", fakeStorageDriver],
          ]),
        },
      },
    ]);
    expect(resolved.drivers.modelCatalogProvider).toBe(catalog);
    expect(resolved.drivers.runnerCredentialProvider).toBe(credentials);
    expect([...resolved.drivers.artifactStorageDrivers.keys()].sort()).toEqual([
      "r2-artifacts",
      "r2-skill",
    ]);
    expect(resolved.drivers.artifactStorageDrivers.get("r2-skill")).toBe(
      fakeStorageDriver,
    );
  });
});

describe("resolveExtensions — loud-fail throws (DD-006 §2b)", () => {
  it("throws on an empty unit name", () => {
    expect(() => resolveExtensions([{ name: "" }])).toThrowError(/empty name/);
  });

  it("throws on a duplicate unit name, naming it", () => {
    expect(() =>
      resolveExtensions([{ name: "billing" }, { name: "billing" }]),
    ).toThrowError(/duplicate extension name 'billing'/);
  });

  it("throws on a second Authorizer, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "first-authz", authorizer: allowAll },
        { name: "second-authz", authorizer: denyAll },
      ]),
    ).toThrowError(
      /extension 'second-authz' registers an Authorizer, but 'first-authz' already did/,
    );
  });

  it("throws on a second edition declaration, naming both units", () => {
    expect(() =>
      resolveExtensions([
        { name: "first-edition", edition: ServerEdition.cloud },
        { name: "second-edition", edition: ServerEdition.oss },
      ]),
    ).toThrowError(
      /extension 'second-edition' declares the server edition, but 'first-edition' already did/,
    );
  });

  it("throws on a declared-but-unspecified edition", () => {
    expect(() =>
      resolveExtensions([
        { name: "vague", edition: ServerEdition.server_edition_unspecified },
      ]),
    ).toThrowError(/edition 'server_edition_unspecified'/);
  });

  it("throws on a registration into an unknown gate slot, listing the declared slots", () => {
    const step: PipelineStep<DescMessage> = {
      name: "UnitTestGate",
      execute: () => {},
    };
    // A misspelled slot cannot typecheck against GateSlotName — the cast
    // exercises the runtime arm of the two-layer contract (a JS consumer,
    // or a composition built against a pin where a slot has moved, must
    // throw at boot, never no-op).
    const gateSteps = new Map([
      ["agent-execution-create:pre-side-effect", [step]],
    ]) as unknown as ReadonlyMap<
      GateSlotName,
      ReadonlyArray<PipelineStep<DescMessage>>
    >;
    const unit: ServerExtension = { name: "typo-gate", gateSteps };
    expect(() => resolveExtensions([unit])).toThrowError(
      /extension 'typo-gate' registered gate steps into unknown slot 'agent-execution-create:pre-side-effect' — declared slots: 'agent-execution-create:pre-side-effect-gate'/,
    );
  });

  it("accepts registrations into declared slots, concatenating in unit order", () => {
    const stepNamed = (name: string): PipelineStep<DescMessage> => ({
      name,
      execute: () => {},
    });
    const resolved = resolveExtensions([
      {
        name: "billing",
        gateSteps: new Map<
          GateSlotName,
          ReadonlyArray<PipelineStep<DescMessage>>
        >([
          [
            "agent-execution-create:pre-side-effect-gate",
            [stepNamed("BillingPreflight")],
          ],
          ["org-create:post-persist", [stepNamed("SeedTuples")]],
        ]),
      },
      {
        name: "capacity",
        gateSteps: new Map<
          GateSlotName,
          ReadonlyArray<PipelineStep<DescMessage>>
        >([
          [
            "agent-execution-create:pre-side-effect-gate",
            [stepNamed("CapacityGate")],
          ],
        ]),
      },
    ]);
    expect(
      resolved.gateSteps
        .get("agent-execution-create:pre-side-effect-gate")
        ?.map((s) => s.name),
    ).toEqual(["BillingPreflight", "CapacityGate"]);
    expect(
      resolved.gateSteps.get("org-create:post-persist")?.map((s) => s.name),
    ).toEqual(["SeedTuples"]);
  });

  it("keeps DECLARED_GATE_SLOTS in lockstep with the ratified slot names", () => {
    // The boot-time set derives from the one literal tuple; this pin
    // catches an accidental edit to either the tuple or the derivation
    // (the names are protected vocabulary — blueprint 03 §3a).
    expect([...DECLARED_GATE_SLOTS].sort()).toEqual(
      [...GATE_SLOT_NAMES].sort(),
    );
    expect([...GATE_SLOT_NAMES].sort()).toEqual([
      "agent-execution-create:pre-side-effect-gate",
      "agent-execution-recover:pre-side-effect-gate",
      "agent-execution-submit-approval:gate",
      "org-create:post-persist",
      "session-create:pre-side-effect-gate",
    ]);
  });

  it("throws on a second ModelCatalogProvider, naming both units", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "first-catalog",
          drivers: { modelCatalogProvider: fakeCatalog() },
        },
        {
          name: "second-catalog",
          drivers: { modelCatalogProvider: fakeCatalog() },
        },
      ]),
    ).toThrowError(
      /extension 'second-catalog' registers a ModelCatalogProvider, but 'first-catalog' already did/,
    );
  });

  it("throws on a second RunnerCredentialProvider, naming both units", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "first-cred",
          drivers: { runnerCredentialProvider: fakeCredentials() },
        },
        {
          name: "second-cred",
          drivers: { runnerCredentialProvider: fakeCredentials() },
        },
      ]),
    ).toThrowError(
      /extension 'second-cred' registers a RunnerCredentialProvider, but 'first-cred' already did/,
    );
  });

  it("throws on a duplicate storage-driver name across units, naming both", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "first-blob",
          drivers: {
            artifactStorageDrivers: new Map([["gcs", fakeStorageDriver]]),
          },
        },
        {
          name: "second-blob",
          drivers: {
            artifactStorageDrivers: new Map([["gcs", fakeStorageDriver]]),
          },
        },
      ]),
    ).toThrowError(
      /extension 'second-blob' registers artifact-storage driver 'gcs', but 'first-blob' already did/,
    );
  });

  it("throws on a storage-driver name shadowing a built-in backend", () => {
    for (const name of ["local", "r2"]) {
      expect(() =>
        resolveExtensions([
          {
            name: "shadowing",
            drivers: {
              artifactStorageDrivers: new Map([[name, fakeStorageDriver]]),
            },
          },
        ]),
      ).toThrowError(
        new RegExp(
          `extension 'shadowing' registers artifact-storage driver '${name}', which shadows a built-in backend`,
        ),
      );
    }
  });
});
