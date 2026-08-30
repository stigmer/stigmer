/**
 * The extension registry — the ONE extension surface of the convergence
 * program (20260826.02 blueprint/03 §2, DD-006; built by sub-project
 * 20260826.09 / O1). `composeServer` gains an optional `extensions` list
 * of named contribution units; this module merges them into the resolved
 * registry the composition stages consume. With no units, OSS behaves
 * byte-identically to today — every point resolves to an explicit empty
 * default, never a nullable surprise (the composition doctrine).
 *
 * Why a LIST of named units and not one flat object: the cloud composes
 * MANY extension packages (billing, IAM lifecycle, channel delivery, the
 * FGA authorizer, drivers — blueprint §10), each contributing its piece.
 * Units give the §2b collision rules something real to enforce — a second
 * Authorizer is representable and therefore rejectable — and every boot
 * error names its offending unit(s). Single-instance points share one
 * uniform merge rule (at most one declaring unit; a second throws naming
 * both); list points concatenate in unit order.
 *
 * Loud-fail discipline (DD-006 §2b): resolution runs FIRST in
 * composeServer, before any stage has side effects. Registering into a
 * gate slot that does not exist, duplicating a unit name, or doubling a
 * single-instance point is a boot throw. Nothing degrades silently.
 *
 * Consumption map (each point's consumer entry): services + workers +
 * edition are consumed here in O1; identity verifiers + authorizer land
 * with O2; gate steps are consumed at the chain splice sites (the
 * gate-slots.ts slot table) and status hooks at the agentexecution
 * transition sites (status-observers.ts), both O4; the O5 driver kinds
 * (catalog provider, artifact-storage registration, runner-credential
 * provider) and O6's sandbox provisioners are consumed at their
 * compose.ts construction sites.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";

import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { ArtifactStorageDriverFactory } from "../artifactstorage/artifact-storage.js";
import { BUILT_IN_STORAGE_TYPES } from "../artifactstorage/artifact-storage.js";
import type { ChannelRuntime } from "../domain/agentchannel/channel-runtime.js";
import type { SecretCodec } from "../encryption/codec.js";
import { V1_VERSION } from "../encryption/v1-codec.js";
import type { ListReadScope } from "./list-read-scope.js";
import type { ModelCatalogProvider } from "../domain/workflow/registry/model-catalog-provider.js";
import type { VisitorErrorPolicy } from "../pipeline/interceptors/error-boundary.js";
import type { PipelineStep } from "../pipeline/pipeline.js";
import type { RunnerCredentialProvider } from "../runnerauth/runner-credential-provider.js";
import type { SandboxProvisionerFactory } from "../sandbox/provisioner.js";
import { BUILT_IN_SANDBOX_PROVISIONER_TYPES } from "../sandbox/provisioner.js";
import type { WorkerFactory } from "../temporal/manager.js";
import type { Authorizer } from "./authorizer.js";
import type { ExtensionDrivers } from "./drivers.js";
import { DECLARED_GATE_SLOTS } from "./gate-slots.js";
import type { GateSlotName, ResolvedGateSteps } from "./gate-slots.js";
import type { IdentityVerifier } from "./identity.js";
import type { OrganizationDirectory } from "./organization-directory.js";
import type { ResourceAuthorizationLifecycle } from "./resource-authorization.js";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionStatusHooks,
  AgentExecutionStatusObserver,
} from "./status-hooks.js";

/**
 * Registers one or more ConnectRPC services on a router. Runs inside the
 * ONE `routes` closure, so both the serving router and the in-process
 * transport see the services automatically (blueprint §2a — a missed
 * in-process wiring silently skipping extension services on cross-domain
 * calls is exactly the bug this placement makes impossible).
 */
export type ExtensionServiceRegistration = (router: ConnectRouter) => void;

/**
 * One named extension unit — a package's whole contribution to the server
 * composition. All fields but `name` are optional; an omitted field is
 * the point's empty state.
 */
export interface ServerExtension {
  /**
   * Unique across the composed set; names the unit in boot logs and every
   * registration error (`extension 'billing' …`).
   */
  readonly name: string;
  /**
   * The served edition (single-declaration point). Exactly one unit may
   * declare it; undeclared compositions serve ServerEdition.oss. The
   * cloud composition's first-party unit declares `cloud` — the D4
   * addendum on blueprint §11 item 11.
   */
  readonly edition?: ServerEdition;
  /** The authorization decision seam (single-instance point; consumed by O2). */
  readonly authorizer?: Authorizer;
  /** Ordered verifier-chain entries, appended in unit order (consumed by O2). */
  readonly identityVerifiers?: ReadonlyArray<IdentityVerifier>;
  /**
   * Gate-step registrations per declared slot (consumed by O4). Every key
   * must name a declared slot — an unknown slot is a boot throw, the §2b
   * contract that keeps a composition and its pinned server honest.
   */
  readonly gateSteps?: ReadonlyMap<
    GateSlotName,
    ReadonlyArray<PipelineStep<DescMessage>>
  >;
  /** Agent-execution status observers/decorators (consumed by O4). */
  readonly statusTransitionHooks?: AgentExecutionStatusHooks;
  /** Driver substitutions (the O5 kinds — see drivers.ts). */
  readonly drivers?: ExtensionDrivers;
  /** Service registrations, appended to the routes closure after the OSS set. */
  readonly services?: ReadonlyArray<ExtensionServiceRegistration>;
  /** Temporal worker factories, appended to the manager's OSS factory list. */
  readonly workers?: ReadonlyArray<WorkerFactory>;
}

/**
 * The merged registry the composition stages consume. Every point is
 * present with its explicit empty/default state — consumers never test
 * for undefined, they iterate or read.
 */
export interface ResolvedExtensions {
  /** Composed unit names, in order (boot-log material). */
  readonly unitNames: ReadonlyArray<string>;
  /** Defaults to ServerEdition.oss when no unit declares one. */
  readonly edition: ServerEdition;
  /**
   * The single composed Authorizer, or undefined when none is registered —
   * O2's consumption site installs the OSS permissive single-team default
   * for the undefined arm (the default lives with the consumer that
   * defines its semantics, not with this data holder).
   */
  readonly authorizer: Authorizer | undefined;
  readonly identityVerifiers: ReadonlyArray<IdentityVerifier>;
  /** Slot name → steps, validated against DECLARED_GATE_SLOTS. */
  readonly gateSteps: ResolvedGateSteps;
  readonly statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
  readonly responseDecorators: ReadonlyArray<AgentExecutionResponseDecorator>;
  readonly drivers: ResolvedExtensionDrivers;
  readonly services: ReadonlyArray<ExtensionServiceRegistration>;
  readonly workers: ReadonlyArray<WorkerFactory>;
}

/**
 * The merged driver points. The two providers follow the authorizer
 * shape — undefined when no unit declares one, and the compose.ts
 * consumption site installs the OSS default (the default lives with the
 * consumer that defines its semantics, not with this data holder).
 */
export interface ResolvedExtensionDrivers {
  readonly modelCatalogProvider: ModelCatalogProvider | undefined;
  readonly runnerCredentialProvider: RunnerCredentialProvider | undefined;
  /** The C2 tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly resourceAuthorizationLifecycle:
    | ResourceAuthorizationLifecycle
    | undefined;
  /** The C2 organization query directory — undefined = OSS behavior. */
  readonly organizationDirectory: OrganizationDirectory | undefined;
  /** Registered name → factory, validated against the built-in names. */
  readonly artifactStorageDrivers: ReadonlyMap<
    string,
    ArtifactStorageDriverFactory
  >;
  /** Registered name → factory, validated against the built-in names (§6d). */
  readonly sandboxProvisionerDrivers: ReadonlyMap<
    string,
    SandboxProvisionerFactory
  >;
  /**
   * The composed channel runtime, or undefined when none is registered —
   * the agentchannel consumption sites serve the byte-pinned refusal
   * posture for the undefined arm (the default lives with the consumer
   * that defines its semantics, not with this data holder).
   */
  readonly channelRuntime: ChannelRuntime | undefined;
  /** The 20260830.01 list read scope — undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
  /**
   * The 20260830.03 visitor error policy — undefined = the error
   * boundary runs only its structural raw-error conversion.
   */
  readonly visitorErrorPolicy: VisitorErrorPolicy | undefined;
  /**
   * Registered version token → codec (20260830.04 Stage 1), validated
   * against the built-in v1. Empty = the facade is v1-only, OSS behavior
   * byte-identical. The compose.ts keys stage merges the built-in v1
   * codec in and resolves the write version fail-fast.
   */
  readonly secretCodecs: ReadonlyMap<string, SecretCodec>;
}

/**
 * Merges the composed units, enforcing the §2b loud-fail rules. Runs
 * before any composition stage — a throw here aborts boot with zero side
 * effects. Plain Errors, not ConnectErrors: these are boot faults, the
 * same class as the composition root's wiring throws.
 */
export function resolveExtensions(
  units: ReadonlyArray<ServerExtension> = [],
): ResolvedExtensions {
  const unitNames: string[] = [];
  const identityVerifiers: IdentityVerifier[] = [];
  const gateSteps = new Map<string, ReadonlyArray<PipelineStep<DescMessage>>>();
  const statusObservers: AgentExecutionStatusObserver[] = [];
  const responseDecorators: AgentExecutionResponseDecorator[] = [];
  const services: ExtensionServiceRegistration[] = [];
  const workers: WorkerFactory[] = [];

  let edition: ServerEdition | undefined;
  let editionDeclaredBy: string | undefined;
  let authorizer: Authorizer | undefined;
  let authorizerDeclaredBy: string | undefined;
  let modelCatalogProvider: ModelCatalogProvider | undefined;
  let catalogDeclaredBy: string | undefined;
  let runnerCredentialProvider: RunnerCredentialProvider | undefined;
  let credentialDeclaredBy: string | undefined;
  let resourceAuthorizationLifecycle:
    | ResourceAuthorizationLifecycle
    | undefined;
  let authorizationLifecycleDeclaredBy: string | undefined;
  let organizationDirectory: OrganizationDirectory | undefined;
  let organizationDirectoryDeclaredBy: string | undefined;
  let channelRuntime: ChannelRuntime | undefined;
  let channelRuntimeDeclaredBy: string | undefined;
  let listReadScope: ListReadScope | undefined;
  let listReadScopeDeclaredBy: string | undefined;
  let visitorErrorPolicy: VisitorErrorPolicy | undefined;
  let visitorErrorPolicyDeclaredBy: string | undefined;
  const artifactStorageDrivers = new Map<
    string,
    ArtifactStorageDriverFactory
  >();
  const storageDriverDeclaredBy = new Map<string, string>();
  const sandboxProvisionerDrivers = new Map<
    string,
    SandboxProvisionerFactory
  >();
  const sandboxDriverDeclaredBy = new Map<string, string>();
  const secretCodecs = new Map<string, SecretCodec>();
  const secretCodecDeclaredBy = new Map<string, string>();

  for (const unit of units) {
    if (unit.name === "") {
      throw new Error(
        "extension unit with an empty name — every extension must be named (names carry every registration error and boot log)",
      );
    }
    if (unitNames.includes(unit.name)) {
      throw new Error(
        `duplicate extension name '${unit.name}' — extension names must be unique across the composed set`,
      );
    }
    unitNames.push(unit.name);

    if (unit.edition !== undefined) {
      if (unit.edition === ServerEdition.server_edition_unspecified) {
        throw new Error(
          `extension '${unit.name}' declares edition 'server_edition_unspecified' — declare a concrete edition or omit the field`,
        );
      }
      if (editionDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' declares the server edition, but '${editionDeclaredBy}' already did — exactly one extension may declare the edition`,
        );
      }
      edition = unit.edition;
      editionDeclaredBy = unit.name;
    }

    if (unit.authorizer !== undefined) {
      if (authorizerDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers an Authorizer, but '${authorizerDeclaredBy}' already did — exactly one Authorizer may be composed`,
        );
      }
      authorizer = unit.authorizer;
      authorizerDeclaredBy = unit.name;
    }

    if (unit.drivers?.modelCatalogProvider !== undefined) {
      if (catalogDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a ModelCatalogProvider, but '${catalogDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      modelCatalogProvider = unit.drivers.modelCatalogProvider;
      catalogDeclaredBy = unit.name;
    }

    if (unit.drivers?.runnerCredentialProvider !== undefined) {
      if (credentialDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a RunnerCredentialProvider, but '${credentialDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      runnerCredentialProvider = unit.drivers.runnerCredentialProvider;
      credentialDeclaredBy = unit.name;
    }

    if (unit.drivers?.resourceAuthorizationLifecycle !== undefined) {
      if (authorizationLifecycleDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a ResourceAuthorizationLifecycle, but '${authorizationLifecycleDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      resourceAuthorizationLifecycle =
        unit.drivers.resourceAuthorizationLifecycle;
      authorizationLifecycleDeclaredBy = unit.name;
    }

    if (unit.drivers?.organizationDirectory !== undefined) {
      if (organizationDirectoryDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers an OrganizationDirectory, but '${organizationDirectoryDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      organizationDirectory = unit.drivers.organizationDirectory;
      organizationDirectoryDeclaredBy = unit.name;
    }

    if (unit.drivers?.channelRuntime !== undefined) {
      if (channelRuntimeDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a ChannelRuntime, but '${channelRuntimeDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      channelRuntime = unit.drivers.channelRuntime;
      channelRuntimeDeclaredBy = unit.name;
    }

    if (unit.drivers?.listReadScope !== undefined) {
      if (listReadScopeDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a ListReadScope, but '${listReadScopeDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      listReadScope = unit.drivers.listReadScope;
      listReadScopeDeclaredBy = unit.name;
    }

    if (unit.drivers?.visitorErrorPolicy !== undefined) {
      if (visitorErrorPolicyDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a VisitorErrorPolicy, but '${visitorErrorPolicyDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      visitorErrorPolicy = unit.drivers.visitorErrorPolicy;
      visitorErrorPolicyDeclaredBy = unit.name;
    }

    if (unit.drivers?.artifactStorageDrivers !== undefined) {
      for (const [name, factory] of unit.drivers.artifactStorageDrivers) {
        if ((BUILT_IN_STORAGE_TYPES as ReadonlyArray<string>).includes(name)) {
          throw new Error(
            `extension '${unit.name}' registers artifact-storage driver '${name}', which shadows a built-in backend — built-in names are reserved`,
          );
        }
        const declaredBy = storageDriverDeclaredBy.get(name);
        if (declaredBy !== undefined) {
          throw new Error(
            `extension '${unit.name}' registers artifact-storage driver '${name}', but '${declaredBy}' already did — driver names must be unique across the composed set`,
          );
        }
        artifactStorageDrivers.set(name, factory);
        storageDriverDeclaredBy.set(name, unit.name);
      }
    }

    if (unit.drivers?.sandboxProvisionerDrivers !== undefined) {
      for (const [name, factory] of unit.drivers.sandboxProvisionerDrivers) {
        if (
          (
            BUILT_IN_SANDBOX_PROVISIONER_TYPES as ReadonlyArray<string>
          ).includes(name)
        ) {
          throw new Error(
            `extension '${unit.name}' registers sandbox provisioner '${name}', which shadows a built-in driver — built-in names are reserved`,
          );
        }
        const declaredBy = sandboxDriverDeclaredBy.get(name);
        if (declaredBy !== undefined) {
          throw new Error(
            `extension '${unit.name}' registers sandbox provisioner '${name}', but '${declaredBy}' already did — driver names must be unique across the composed set`,
          );
        }
        sandboxProvisionerDrivers.set(name, factory);
        sandboxDriverDeclaredBy.set(name, unit.name);
      }
    }

    if (unit.drivers?.secretCodecs !== undefined) {
      for (const [version, codec] of unit.drivers.secretCodecs) {
        if (version === V1_VERSION) {
          throw new Error(
            `extension '${unit.name}' registers secret codec '${version}', which shadows the built-in static-key codec — the v1 token is reserved`,
          );
        }
        if (!/^v\d+$/.test(version) || codec.version !== version) {
          // A registration read-dispatch could never route to must fail
          // loudly, not sit dark (the gateSteps rule): tokens are the
          // enc:v<N>: capture, and the key must equal the codec's own
          // version.
          throw new Error(
            `extension '${unit.name}' registers secret codec '${version}' (codec declares '${codec.version}') — version tokens must match v<digits> and key their own codec`,
          );
        }
        const declaredBy = secretCodecDeclaredBy.get(version);
        if (declaredBy !== undefined) {
          throw new Error(
            `extension '${unit.name}' registers secret codec '${version}', but '${declaredBy}' already did — codec versions must be unique across the composed set`,
          );
        }
        secretCodecs.set(version, codec);
        secretCodecDeclaredBy.set(version, unit.name);
      }
    }

    if (unit.gateSteps !== undefined) {
      for (const [slot, steps] of unit.gateSteps) {
        if (!DECLARED_GATE_SLOTS.has(slot)) {
          const declared =
            DECLARED_GATE_SLOTS.size > 0
              ? [...DECLARED_GATE_SLOTS].sort().join("', '")
              : "";
          throw new Error(
            `extension '${unit.name}' registered gate steps into unknown slot '${slot}' — declared slots: ${
              declared === "" ? "(none in this build)" : `'${declared}'`
            }`,
          );
        }
        const existing = gateSteps.get(slot) ?? [];
        gateSteps.set(slot, [...existing, ...steps]);
      }
    }

    identityVerifiers.push(...(unit.identityVerifiers ?? []));
    statusObservers.push(...(unit.statusTransitionHooks?.observers ?? []));
    responseDecorators.push(
      ...(unit.statusTransitionHooks?.responseDecorators ?? []),
    );
    services.push(...(unit.services ?? []));
    workers.push(...(unit.workers ?? []));
  }

  return {
    unitNames,
    edition: edition ?? ServerEdition.oss,
    authorizer,
    identityVerifiers,
    gateSteps,
    statusObservers,
    responseDecorators,
    drivers: {
      modelCatalogProvider,
      runnerCredentialProvider,
      resourceAuthorizationLifecycle,
      organizationDirectory,
      artifactStorageDrivers,
      sandboxProvisionerDrivers,
      channelRuntime,
      listReadScope,
      visitorErrorPolicy,
      secretCodecs,
    },
    services,
    workers,
  };
}
