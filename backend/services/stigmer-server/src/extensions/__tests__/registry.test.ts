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
import type { ChannelRuntime } from "../../domain/agentchannel/channel-runtime.js";
import type { SecretCodec } from "../../encryption/codec.js";
import type { ModelCatalogProvider } from "../../domain/workflow/registry/model-catalog-provider.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RunnerCredentialProvider } from "../../runnerauth/runner-credential-provider.js";
import type { SandboxProvisionerFactory } from "../../sandbox/provisioner.js";
import type { WorkerFactory } from "../../temporal/manager.js";
import type { Authorizer } from "../authorizer.js";
import type { CallerGuard } from "../caller-guards.js";
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

// Never invoked — the guard's identity is what the merge tests assert.
function callerGuard(name: string): CallerGuard {
  return { name, guard: () => Promise.resolve() };
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

const fakeSandboxDriver: SandboxProvisionerFactory = () => {
  throw new Error("unit-test sandbox driver factory — never constructed");
};

// Never invoked — the merge tests assert identity and the §2b throws.
function fakeCodec(version: string): SecretCodec {
  const never = (): never => {
    throw new Error("unit-test secret codec — never invoked");
  };
  return { version, encrypt: never, decrypt: never };
}

function fakeChannelRuntime(): ChannelRuntime {
  const never = (): never => {
    throw new Error("unit-test channel runtime — never invoked");
  };
  return {
    installs: { initiateInstall: never, completeInstall: never },
    messaging: {
      sendMessage: never,
      listTemplates: never,
      listMessagingChannels: never,
    },
    conversations: {
      listConversations: never,
      getConversation: never,
      getTimeline: never,
      getMediaDownloadUrl: never,
      reply: never,
      takeOver: never,
      handBack: never,
      clearAttention: never,
      escalate: never,
    },
    enforceWriteConstraints: never,
    teardownOnDelete: never,
  };
}

describe("resolveExtensions — defaults", () => {
  it("resolves the omitted set to explicit empty defaults, edition oss", () => {
    const resolved = resolveExtensions();
    expect(resolved.unitNames).toEqual([]);
    expect(resolved.edition).toBe(ServerEdition.oss);
    expect(resolved.requireAuthentication).toBeUndefined();
    expect(resolved.authorizer).toBeUndefined();
    expect(resolved.identityVerifiers).toEqual([]);
    expect(resolved.callerGuards).toEqual([]);
    expect(resolved.gateSteps.size).toBe(0);
    expect(resolved.statusObservers).toEqual([]);
    expect(resolved.responseDecorators).toEqual([]);
    expect(resolved.drivers.modelCatalogProvider).toBeUndefined();
    expect(resolved.drivers.runnerCredentialProvider).toBeUndefined();
    expect(resolved.drivers.artifactStorageDrivers.size).toBe(0);
    expect(resolved.drivers.sandboxProvisionerDrivers.size).toBe(0);
    expect(resolved.drivers.channelRuntime).toBeUndefined();
    expect(resolved.drivers.secretCodecs.size).toBe(0);
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
        callerGuards: [callerGuard("g1")],
        services: [registerA],
        statusTransitionHooks: { observers: [observerA] },
      },
      {
        name: "beta",
        edition: ServerEdition.cloud,
        requireAuthentication: true,
        authorizer: allowAll,
        identityVerifiers: [verifier("b1")],
        callerGuards: [callerGuard("g2"), callerGuard("g3")],
        services: [registerB],
        workers: [workerFactory],
        statusTransitionHooks: { responseDecorators: [decoratorB] },
      },
    ]);
    expect(resolved.unitNames).toEqual(["alpha", "beta"]);
    expect(resolved.edition).toBe(ServerEdition.cloud);
    expect(resolved.requireAuthentication).toEqual({ declaredBy: "beta" });
    expect(resolved.authorizer).toBe(allowAll);
    expect(resolved.identityVerifiers.map((v) => v.name)).toEqual([
      "a1",
      "a2",
      "b1",
    ]);
    expect(resolved.callerGuards.map((g) => g.name)).toEqual([
      "g1",
      "g2",
      "g3",
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

  it("merges the O6 sandbox-provisioner drivers as a name-keyed map across units", () => {
    const resolved = resolveExtensions([
      {
        name: "fly-unit",
        drivers: {
          sandboxProvisionerDrivers: new Map([
            ["fly-machines", fakeSandboxDriver],
          ]),
        },
      },
      {
        name: "firecracker-unit",
        drivers: {
          sandboxProvisionerDrivers: new Map([
            ["firecracker", fakeSandboxDriver],
          ]),
        },
      },
    ]);
    expect(
      [...resolved.drivers.sandboxProvisionerDrivers.keys()].sort(),
    ).toEqual(["firecracker", "fly-machines"]);
    expect(resolved.drivers.sandboxProvisionerDrivers.get("fly-machines")).toBe(
      fakeSandboxDriver,
    );
  });

  it("keeps the declared ChannelRuntime as the resolved singleton (C3 ruling Q1)", () => {
    const runtime = fakeChannelRuntime();
    const resolved = resolveExtensions([
      { name: "channels", drivers: { channelRuntime: runtime } },
    ]);
    expect(resolved.drivers.channelRuntime).toBe(runtime);
  });

  it("keeps the declared ListReadScope as the resolved singleton (20260830.01)", () => {
    const scope = {
      authorizedResourceIds: () => Promise.resolve(new Set<string>()),
      restrictListEntries: () => Promise.resolve(new Set<string>()),
    };
    const resolved = resolveExtensions([
      { name: "iam", drivers: { listReadScope: scope } },
    ]);
    expect(resolved.drivers.listReadScope).toBe(scope);
    // The empty state resolves explicitly, never a missing key.
    expect(resolveExtensions([]).drivers.listReadScope).toBeUndefined();
  });

  it("keeps the declared ScheduleFireCallerMint as the resolved singleton (stigmer-cloud#572)", () => {
    const mint = {
      mintFireCaller: () =>
        Promise.resolve({
          identityId: "ida_sched",
          callerClass: "schedule",
          issuer: "stigmer",
          rawToken: "jwt",
        }),
    };
    const resolved = resolveExtensions([
      { name: "iam", drivers: { scheduleFireCaller: mint } },
    ]);
    expect(resolved.drivers.scheduleFireCaller).toBe(mint);
    // The empty state resolves explicitly, never a missing key.
    expect(resolveExtensions([]).drivers.scheduleFireCaller).toBeUndefined();
  });

  it("throws on a second ScheduleFireCallerMint, naming both units", () => {
    const mint = {
      mintFireCaller: () =>
        Promise.resolve({
          identityId: "ida_sched",
          callerClass: "schedule",
          issuer: "stigmer",
          rawToken: "jwt",
        }),
    };
    expect(() =>
      resolveExtensions([
        { name: "mint-a", drivers: { scheduleFireCaller: mint } },
        { name: "mint-b", drivers: { scheduleFireCaller: mint } },
      ]),
    ).toThrowError(
      /extension 'mint-b' registers a ScheduleFireCallerMint, but 'mint-a' already did/,
    );
  });

  it("merges secret codecs as a version-keyed map across units (20260830.04)", () => {
    const v2 = fakeCodec("v2");
    const v3 = fakeCodec("v3");
    const resolved = resolveExtensions([
      {
        name: "vault-envelope",
        drivers: { secretCodecs: new Map([["v2", v2]]) },
      },
      { name: "vault-kv", drivers: { secretCodecs: new Map([["v3", v3]]) } },
    ]);
    expect([...resolved.drivers.secretCodecs.keys()].sort()).toEqual([
      "v2",
      "v3",
    ]);
    expect(resolved.drivers.secretCodecs.get("v2")).toBe(v2);
    expect(resolved.drivers.secretCodecs.get("v3")).toBe(v3);
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

  it("throws on a second ListReadScope, naming both units", () => {
    const scope = {
      authorizedResourceIds: () => Promise.resolve(new Set<string>()),
      restrictListEntries: () => Promise.resolve(new Set<string>()),
    };
    expect(() =>
      resolveExtensions([
        { name: "scope-a", drivers: { listReadScope: scope } },
        { name: "scope-b", drivers: { listReadScope: scope } },
      ]),
    ).toThrowError(
      /extension 'scope-b' registers a ListReadScope, but 'scope-a' already did/,
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

  it("throws on a second require-authentication declaration, naming both units (20260904.02)", () => {
    expect(() =>
      resolveExtensions([
        { name: "first-posture", requireAuthentication: true },
        { name: "second-posture", requireAuthentication: true },
      ]),
    ).toThrowError(
      /extension 'second-posture' declares the require-authentication posture, but 'first-posture' already did/,
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
      "sandbox-acquisition:gate",
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

  it("throws on a second ChannelRuntime, naming both units", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "channels-a",
          drivers: { channelRuntime: fakeChannelRuntime() },
        },
        {
          name: "channels-b",
          drivers: { channelRuntime: fakeChannelRuntime() },
        },
      ]),
    ).toThrow(
      "extension 'channels-b' registers a ChannelRuntime, but 'channels-a' already did — exactly one may be composed",
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

  it("throws on a duplicated sandbox-provisioner name across units, naming both", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "first-sbx",
          drivers: {
            sandboxProvisionerDrivers: new Map([["fly", fakeSandboxDriver]]),
          },
        },
        {
          name: "second-sbx",
          drivers: {
            sandboxProvisionerDrivers: new Map([["fly", fakeSandboxDriver]]),
          },
        },
      ]),
    ).toThrowError(
      /extension 'second-sbx' registers sandbox provisioner 'fly', but 'first-sbx' already did/,
    );
  });

  it("throws on a sandbox-provisioner name shadowing a built-in driver", () => {
    for (const name of ["local-process", "docker", "kubernetes"]) {
      expect(() =>
        resolveExtensions([
          {
            name: "shadowing",
            drivers: {
              sandboxProvisionerDrivers: new Map([[name, fakeSandboxDriver]]),
            },
          },
        ]),
      ).toThrowError(
        new RegExp(
          `extension 'shadowing' registers sandbox provisioner '${name}', which shadows a built-in driver`,
        ),
      );
    }
  });

  it("throws on a secret codec registered as v1, shadowing the built-in", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "shadowing",
          drivers: { secretCodecs: new Map([["v1", fakeCodec("v1")]]) },
        },
      ]),
    ).toThrow(
      "extension 'shadowing' registers secret codec 'v1', which shadows the built-in static-key codec — the v1 token is reserved",
    );
  });

  it("throws on a duplicated secret-codec version across units, naming both", () => {
    expect(() =>
      resolveExtensions([
        {
          name: "first-vault",
          drivers: { secretCodecs: new Map([["v2", fakeCodec("v2")]]) },
        },
        {
          name: "second-vault",
          drivers: { secretCodecs: new Map([["v2", fakeCodec("v2")]]) },
        },
      ]),
    ).toThrowError(
      /extension 'second-vault' registers secret codec 'v2', but 'first-vault' already did/,
    );
  });

  it("throws on an undispatchable secret-codec token or a key/version mismatch", () => {
    // A token read dispatch could never route to (not v<digits>).
    expect(() =>
      resolveExtensions([
        {
          name: "bad-token",
          drivers: { secretCodecs: new Map([["vault", fakeCodec("vault")]]) },
        },
      ]),
    ).toThrowError(/version tokens must match v<digits>/);
    // A key that does not equal the codec's own declared version.
    expect(() =>
      resolveExtensions([
        {
          name: "mismatched",
          drivers: { secretCodecs: new Map([["v2", fakeCodec("v3")]]) },
        },
      ]),
    ).toThrowError(
      /extension 'mismatched' registers secret codec 'v2' \(codec declares 'v3'\)/,
    );
  });
});
