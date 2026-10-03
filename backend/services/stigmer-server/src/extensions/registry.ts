/**
 * The extension registry — the ONE extension surface of the server.
 * `composeServer` gains an optional `extensions` list
 * of named contribution units; this module merges them into the resolved
 * registry the composition stages consume. With no units, OSS behaves
 * byte-identically to today — every point resolves to an explicit empty
 * default, never a nullable surprise.
 *
 * Why a LIST of named units and not one flat object: the cloud composes
 * MANY extension packages (billing, IAM lifecycle, channel delivery, the
 * FGA authorizer, drivers), each contributing its piece.
 * Units give the collision rules something real to enforce — a second
 * Authorizer is representable and therefore rejectable — and every boot
 * error names its offending unit(s). Single-instance points share one
 * uniform merge rule (at most one declaring unit; a second throws naming
 * both); list points concatenate in unit order.
 *
 * Loud-fail discipline: resolution runs FIRST in
 * composeServer, before any stage has side effects. Registering into a
 * gate slot that does not exist, duplicating a unit name, or doubling a
 * single-instance point is a boot throw. Nothing degrades silently.
 *
 * Consumption map (each point's consumer): services + workers +
 * edition are consumed here; identity verifiers + authorizer where
 * compose.ts builds the chains; gate steps at the chain splice sites (the
 * gate-slots.ts slot table) and status hooks at the agentexecution
 * transition sites (status-observers.ts); the driver kinds
 * (catalog provider, artifact-storage registration, runner-credential
 * provider) and the sandbox provisioners are consumed at their
 * compose.ts construction sites; the require-authentication posture
 * is consumed where compose.ts builds the serving chain's
 * identity source, OR'd with the OIDC-issuer arm; the identity-account
 * points at the identity-accounts stage (the store driver,
 * ahead of the boot-time operator ensure) and the routes stage (the
 * federation capability and the provision slot's steps, into the
 * identity-account controller); the IamPolicy points at
 * the same two stages — the store driver where the grant path is built,
 * beside the identity-account store, and the grant scope and the query
 * engine into the IamPolicy controller at the routes stage.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import type { ArtifactStorageDriverFactory } from "../artifactstorage/artifact-storage.js";
import { BUILT_IN_STORAGE_TYPES } from "../artifactstorage/artifact-storage.js";
import type { ChannelRuntime } from "../domain/agentchannel/channel-runtime.js";
import type { IdentityAccountStore } from "../domain/identityaccount/store.js";
import type { IamPolicyStore } from "../domain/iampolicy/store.js";
import type { PlatformClientStore } from "../domain/platformclient/store.js";
import type { SecretCodec } from "../encryption/codec.js";
import { V1_VERSION } from "../encryption/v1-codec.js";
import type { PlatformTokenKeyRing } from "../platformtoken/key-ring.js";
import type { AuthorizationQueryEngine } from "./authorization-queries.js";
import type { GuestTokenMinting } from "./guest-token-minting.js";
import type { IdentityFederation } from "./identity-federation.js";
import type { LicenseStatusProvider } from "./license-status.js";
import type { OutboundEgressPolicy } from "./outbound-egress.js";
import type { ListReadScope } from "./list-read-scope.js";
import type { PolicyGrantScope } from "./policy-grant-scope.js";
import type { PrincipalDisplay } from "./principal-display.js";
import type { ModelCatalogProvider } from "../domain/workflow/registry/model-catalog-provider.js";
import {
  kindEnumName,
  kindServedByEdition,
} from "../pipeline/apiresource-meta.js";
import type { VisitorErrorPolicy } from "../pipeline/interceptors/error-boundary.js";
import type { PipelineStep } from "../pipeline/pipeline.js";
import type { RunnerCredentialProvider } from "../runnerauth/runner-credential-provider.js";
import type { SandboxProvisionerFactory } from "../sandbox/provisioner.js";
import type { ScheduleFireCallerMint } from "./schedule-fire-caller.js";
import type { VisitorClassifier } from "./visitor-classifier.js";
import { BUILT_IN_SANDBOX_PROVISIONER_TYPES } from "../sandbox/provisioner.js";
import type { WorkerFactory } from "../temporal/manager.js";
import type { Authorizer } from "./authorizer.js";
import type { CallerGuard } from "./caller-guards.js";
import type { ComposedServices } from "./composed-services.js";
import type { ExtensionDrivers } from "./drivers.js";
import { DECLARED_GATE_SLOTS } from "./gate-slots.js";
import type { GateSlotName, ResolvedGateSteps } from "./gate-slots.js";
import type { IdentityVerifier } from "./identity.js";
import type { OrganizationDirectory } from "./organization-directory.js";
import type { ResourceAuthorizationLifecycle } from "./resource-authorization.js";
import type { ResourceRowReader } from "./resource-row-reader.js";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionStatusHooks,
  AgentExecutionStatusObserver,
} from "./status-hooks.js";

/**
 * Registers one or more ConnectRPC services on a router. Runs inside the
 * ONE `routes` closure, so both the serving router and the in-process
 * transport see the services automatically (a missed
 * in-process wiring silently skipping extension services on cross-domain
 * calls is exactly the bug this placement makes impossible).
 */
export type ExtensionServiceRegistration = (router: ConnectRouter) => void;

/**
 * A service registration with the unit that contributed it, so the routes
 * stage can name the unit when a registration shadows a core route
 * (compose.ts refuses that at boot: Connect's router keys handlers by
 * request path and the last registration wins, silently).
 */
export interface ResolvedServiceRegistration {
  readonly unit: string;
  readonly register: ExtensionServiceRegistration;
}

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
   * cloud composition's first-party unit declares `cloud`.
   */
  readonly edition?: ServerEdition;
  /**
   * The require-authentication admission posture (single-declaration
   * point, the edition's shape). Declaring it turns
   * the serving chain's tokenless-refusal arm on INDEPENDENTLY of the OSS
   * OIDC issuer: a request with no credential on a non-`is_public` method
   * is UNAUTHENTICATED "authentication token missing" (the Java
   * interceptor's copy), instead of falling to the trusted-local
   * single-operator identity. A composition whose own identity verifiers
   * resolve its users declares this — the OSS issuer arm cannot be reused
   * for it, because configuring the issuer also registers the OSS OIDC
   * verifier ahead of the composition's own (compose.ts). Declaring the
   * posture DOES compose the OSS API-key verifier, first in the chain
   * (stigmer#984): the apikey domain mints `stk_` keys in every
   * composition, and a server with an authentication posture honors the
   * keys it issues.
   *
   * Typed as the literal `true`: the field is declared or omitted, never
   * set to `false` — there is no "declared lenient" state to validate at
   * boot. Exactly one unit may declare it (a second throws naming both);
   * the declaring unit is named in the boot log and in the compose.ts
   * invariant that refuses a posture whose unit registers no verifier of
   * its own (the API-key lane alone cannot mint the first key).
   */
  readonly requireAuthentication?: true;
  /** The authorization decision seam (single-instance point). */
  readonly authorizer?: Authorizer;
  /** Ordered verifier-chain entries, appended in unit order. */
  readonly identityVerifiers?: ReadonlyArray<IdentityVerifier>;
  /**
   * Post-authentication caller guards, appended in unit order — run by the
   * serving chain's identity source
   * after the stamp, never by the in-process chain (caller-guards.ts).
   */
  readonly callerGuards?: ReadonlyArray<CallerGuard>;
  /**
   * Gate-step registrations per declared slot. Every key
   * must name a declared slot — an unknown slot is a boot throw, the
   * contract that keeps a composition and its pinned server honest.
   */
  readonly gateSteps?: ReadonlyMap<
    GateSlotName,
    ReadonlyArray<PipelineStep<DescMessage>>
  >;
  /** Agent-execution status observers/decorators. */
  readonly statusTransitionHooks?: AgentExecutionStatusHooks;
  /** Driver substitutions (see drivers.ts). */
  readonly drivers?: ExtensionDrivers;
  /** Service registrations, appended to the routes closure after the OSS set. */
  readonly services?: ReadonlyArray<ExtensionServiceRegistration>;
  /** Temporal worker factories, appended to the manager's OSS factory list. */
  readonly workers?: ReadonlyArray<WorkerFactory>;
  /**
   * Receives the composition's own instances — the Authorizer, the list
   * read scope, the policy check, the tuple lifecycle and the in-process
   * transport — once, in unit order, at the end of `composeServer`
   * (extensions/composed-services.ts carries the contract).
   */
  readonly onComposed?: (composed: ComposedServices) => void;
  /**
   * Boot work that must finish before anything serves, run in unit order
   * first in the server's `start()`; a throw fails the start.
   */
  readonly start?: () => Promise<void>;
}

/** A unit's hand-over or start hook with the unit that contributed it, so a failing start names its unit. */
export interface ResolvedUnitHook<T> {
  readonly unit: string;
  readonly hook: T;
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
   * The unit-declared require-authentication posture, or undefined when
   * no unit declares it (the OSS trusted-local posture — unless the OIDC
   * issuer arm turns it on; compose.ts ORs the two). Carries the
   * declaring unit's name: the boot log and the zero-verifier invariant
   * both name it.
   */
  readonly requireAuthentication: { readonly declaredBy: string } | undefined;
  /**
   * The single composed Authorizer, or undefined when none is registered —
   * the consumption site in compose.ts installs the OSS default
   * for the undefined arm (the default lives with the consumer that
   * defines its semantics, not with this data holder).
   */
  readonly authorizer: Authorizer | undefined;
  readonly identityVerifiers: ReadonlyArray<IdentityVerifier>;
  readonly callerGuards: ReadonlyArray<CallerGuard>;
  /** Slot name → steps, validated against DECLARED_GATE_SLOTS. */
  readonly gateSteps: ResolvedGateSteps;
  readonly statusObservers: ReadonlyArray<AgentExecutionStatusObserver>;
  readonly responseDecorators: ReadonlyArray<AgentExecutionResponseDecorator>;
  readonly drivers: ResolvedExtensionDrivers;
  readonly services: ReadonlyArray<ResolvedServiceRegistration>;
  readonly workers: ReadonlyArray<WorkerFactory>;
  /** The units' hand-over hooks, in unit order. */
  readonly onComposed: ReadonlyArray<
    ResolvedUnitHook<(composed: ComposedServices) => void>
  >;
  /** The units' start hooks, in unit order. */
  readonly start: ReadonlyArray<ResolvedUnitHook<() => Promise<void>>>;
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
  /** The tuple-lifecycle driver — undefined = the shared steps no-op. */
  readonly resourceAuthorizationLifecycle:
    | ResourceAuthorizationLifecycle
    | undefined;
  /** The organization query directory — undefined = OSS behavior. */
  readonly organizationDirectory: OrganizationDirectory | undefined;
  /** Registered name → factory, validated against the built-in names. */
  readonly artifactStorageDrivers: ReadonlyMap<
    string,
    ArtifactStorageDriverFactory
  >;
  /** Registered name → factory, validated against the built-in names. */
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
  /** The list read scope — undefined = the OSS full scan. */
  readonly listReadScope: ListReadScope | undefined;
  /**
   * The visitor error policy — undefined = the error
   * boundary runs only its structural raw-error conversion.
   */
  readonly visitorErrorPolicy: VisitorErrorPolicy | undefined;
  /**
   * The schedule-fire caller mint — undefined =
   * schedule fires enter the create pipeline as the `internal` class,
   * OSS behavior byte-identical.
   */
  readonly scheduleFireCaller: ScheduleFireCallerMint | undefined;
  /**
   * Registered version token → codec, validated
   * against the built-in v1. Empty = the facade is v1-only, OSS behavior
   * byte-identical. The compose.ts keys stage merges the built-in v1
   * codec in and resolves the write version fail-fast.
   */
  readonly secretCodecs: ReadonlyMap<string, SecretCodec>;
  /**
   * The identity-account store driver — undefined = the
   * compose.ts identity-accounts stage installs the OSS adapter over the
   * generic Store, OSS behavior byte-identical.
   */
  readonly identityAccountStore: IdentityAccountStore | undefined;
  /**
   * The identity-federation capability — undefined = the
   * four federated RPCs refuse UNIMPLEMENTED with the edition reason.
   */
  readonly identityFederation: IdentityFederation | undefined;
  /**
   * The IamPolicy store driver — undefined = the compose.ts
   * stage that builds the grant path installs the OSS adapter over the
   * generic Store, OSS behavior byte-identical.
   */
  readonly iamPolicyStore: IamPolicyStore | undefined;
  /**
   * The policy grant scope — undefined = compose.ts installs
   * open source's organization-only default.
   */
  readonly policyGrantScope: PolicyGrantScope | undefined;
  /**
   * The authorization-query engine — undefined = the
   * tuple-half RPC arms refuse UNIMPLEMENTED with the edition reason.
   */
  readonly authorizationQueries: AuthorizationQueryEngine | undefined;
  /**
   * The principal display — undefined = an access list names a grantee
   * that is not a person by its id (the fallback shape).
   */
  readonly principalDisplay: PrincipalDisplay | undefined;
  /**
   * The license-status provider — undefined = compose.ts installs the
   * built-in `absent` answer, so every edition serves getLicenseStatus.
   */
  readonly licenseStatus: LicenseStatusProvider | undefined;
  /**
   * The outbound-egress policy — undefined = compose.ts installs open
   * source's relaxed posture (only the link-local range refused).
   */
  readonly outboundEgress: OutboundEgressPolicy | undefined;
  /**
   * The platform-client store driver — undefined = compose.ts installs the
   * OSS adapter over the generic Store.
   */
  readonly platformClientStore: PlatformClientStore | undefined;
  /**
   * The platform-token key ring — undefined = compose.ts composes open
   * source's ring under an authentication posture, and refuses to boot a
   * non-open-source edition that supplied none.
   */
  readonly platformTokenKeys: PlatformTokenKeyRing | undefined;
  /**
   * The guest-token capability — undefined = `mintGuestToken` refuses
   * UNIMPLEMENTED with the edition sentence.
   */
  readonly guestTokenMinting: GuestTokenMinting | undefined;
  /**
   * The visitor classifier — undefined = nobody is a visitor, so every
   * run carries its organization's standing context.
   */
  readonly visitorClassifier: VisitorClassifier | undefined;
  /**
   * Kind → the reader of that kind's rows (extensions/resource-row-reader.ts),
   * validated against the kinds open source keeps itself. Empty = the
   * built-in authorizer reads every row from the generic Store and identity
   * accounts through the account port, OSS behavior byte-identical.
   */
  readonly resourceRowReaders: ReadonlyMap<ApiResourceKind, ResourceRowReader>;
}

/**
 * Merges the composed units, enforcing the loud-fail rules. Runs
 * before any composition stage — a throw here aborts boot with zero side
 * effects. Plain Errors, not ConnectErrors: these are boot faults, the
 * same class as the composition root's wiring throws.
 */
export function resolveExtensions(
  units: ReadonlyArray<ServerExtension> = [],
): ResolvedExtensions {
  const unitNames: string[] = [];
  const identityVerifiers: IdentityVerifier[] = [];
  const callerGuards: CallerGuard[] = [];
  const gateSteps = new Map<string, ReadonlyArray<PipelineStep<DescMessage>>>();
  const statusObservers: AgentExecutionStatusObserver[] = [];
  const responseDecorators: AgentExecutionResponseDecorator[] = [];
  const services: ResolvedServiceRegistration[] = [];
  const workers: WorkerFactory[] = [];
  const onComposed: ResolvedUnitHook<(composed: ComposedServices) => void>[] =
    [];
  const start: ResolvedUnitHook<() => Promise<void>>[] = [];

  let edition: ServerEdition | undefined;
  let editionDeclaredBy: string | undefined;
  let requireAuthenticationDeclaredBy: string | undefined;
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
  let scheduleFireCaller: ScheduleFireCallerMint | undefined;
  let scheduleFireCallerDeclaredBy: string | undefined;
  let identityAccountStore: IdentityAccountStore | undefined;
  let identityAccountStoreDeclaredBy: string | undefined;
  let identityFederation: IdentityFederation | undefined;
  let identityFederationDeclaredBy: string | undefined;
  let iamPolicyStore: IamPolicyStore | undefined;
  let iamPolicyStoreDeclaredBy: string | undefined;
  let policyGrantScope: PolicyGrantScope | undefined;
  let policyGrantScopeDeclaredBy: string | undefined;
  let authorizationQueries: AuthorizationQueryEngine | undefined;
  let authorizationQueriesDeclaredBy: string | undefined;
  let principalDisplay: PrincipalDisplay | undefined;
  let principalDisplayDeclaredBy: string | undefined;
  let licenseStatus: LicenseStatusProvider | undefined;
  let licenseStatusDeclaredBy: string | undefined;
  let outboundEgress: OutboundEgressPolicy | undefined;
  let outboundEgressDeclaredBy: string | undefined;
  let platformClientStore: PlatformClientStore | undefined;
  let platformClientStoreDeclaredBy: string | undefined;
  let platformTokenKeys: PlatformTokenKeyRing | undefined;
  let platformTokenKeysDeclaredBy: string | undefined;
  let guestTokenMinting: GuestTokenMinting | undefined;
  let guestTokenMintingDeclaredBy: string | undefined;
  let visitorClassifier: VisitorClassifier | undefined;
  let visitorClassifierDeclaredBy: string | undefined;
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
  const resourceRowReaders = new Map<ApiResourceKind, ResourceRowReader>();
  const rowReaderDeclaredBy = new Map<ApiResourceKind, string>();

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

    if (unit.requireAuthentication !== undefined) {
      if (requireAuthenticationDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' declares the require-authentication posture, but '${requireAuthenticationDeclaredBy}' already did — exactly one extension may declare it`,
        );
      }
      requireAuthenticationDeclaredBy = unit.name;
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

    if (unit.drivers?.scheduleFireCaller !== undefined) {
      if (scheduleFireCallerDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a ScheduleFireCallerMint, but '${scheduleFireCallerDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      scheduleFireCaller = unit.drivers.scheduleFireCaller;
      scheduleFireCallerDeclaredBy = unit.name;
    }

    if (unit.drivers?.identityAccountStore !== undefined) {
      if (identityAccountStoreDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers an IdentityAccountStore, but '${identityAccountStoreDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      identityAccountStore = unit.drivers.identityAccountStore;
      identityAccountStoreDeclaredBy = unit.name;
    }

    if (unit.drivers?.identityFederation !== undefined) {
      if (identityFederationDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers an IdentityFederation, but '${identityFederationDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      identityFederation = unit.drivers.identityFederation;
      identityFederationDeclaredBy = unit.name;
    }

    if (unit.drivers?.iamPolicyStore !== undefined) {
      if (iamPolicyStoreDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers an IamPolicyStore, but '${iamPolicyStoreDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      iamPolicyStore = unit.drivers.iamPolicyStore;
      iamPolicyStoreDeclaredBy = unit.name;
    }

    if (unit.drivers?.policyGrantScope !== undefined) {
      if (policyGrantScopeDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a PolicyGrantScope, but '${policyGrantScopeDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      policyGrantScope = unit.drivers.policyGrantScope;
      policyGrantScopeDeclaredBy = unit.name;
    }

    if (unit.drivers?.authorizationQueries !== undefined) {
      if (authorizationQueriesDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers an AuthorizationQueryEngine, but '${authorizationQueriesDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      authorizationQueries = unit.drivers.authorizationQueries;
      authorizationQueriesDeclaredBy = unit.name;
    }

    if (unit.drivers?.principalDisplay !== undefined) {
      if (principalDisplayDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a PrincipalDisplay, but '${principalDisplayDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      principalDisplay = unit.drivers.principalDisplay;
      principalDisplayDeclaredBy = unit.name;
    }

    if (unit.drivers?.licenseStatus !== undefined) {
      if (licenseStatusDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a LicenseStatusProvider, but '${licenseStatusDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      licenseStatus = unit.drivers.licenseStatus;
      licenseStatusDeclaredBy = unit.name;
    }

    if (unit.drivers?.outboundEgress !== undefined) {
      if (outboundEgressDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers an OutboundEgressPolicy, but '${outboundEgressDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      outboundEgress = unit.drivers.outboundEgress;
      outboundEgressDeclaredBy = unit.name;
    }

    if (unit.drivers?.platformClientStore !== undefined) {
      if (platformClientStoreDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a PlatformClientStore, but '${platformClientStoreDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      platformClientStore = unit.drivers.platformClientStore;
      platformClientStoreDeclaredBy = unit.name;
    }

    if (unit.drivers?.platformTokenKeys !== undefined) {
      if (platformTokenKeysDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a PlatformTokenKeyRing, but '${platformTokenKeysDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      platformTokenKeys = unit.drivers.platformTokenKeys;
      platformTokenKeysDeclaredBy = unit.name;
    }

    if (unit.drivers?.guestTokenMinting !== undefined) {
      if (guestTokenMintingDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a GuestTokenMinting capability, but '${guestTokenMintingDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      guestTokenMinting = unit.drivers.guestTokenMinting;
      guestTokenMintingDeclaredBy = unit.name;
    }

    if (unit.drivers?.visitorClassifier !== undefined) {
      if (visitorClassifierDeclaredBy !== undefined) {
        throw new Error(
          `extension '${unit.name}' registers a VisitorClassifier, but '${visitorClassifierDeclaredBy}' already did — exactly one may be composed`,
        );
      }
      visitorClassifier = unit.drivers.visitorClassifier;
      visitorClassifierDeclaredBy = unit.name;
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

    if (unit.drivers?.resourceRowReaders !== undefined) {
      for (const [kind, reader] of unit.drivers.resourceRowReaders) {
        if (kind === ApiResourceKind.api_resource_kind_unknown) {
          throw new Error(
            `extension '${unit.name}' registers a row reader for the unknown kind — a reader names the kind whose rows it reads`,
          );
        }
        const name = kindEnumName(kind);
        if (kind === ApiResourceKind.identity_account) {
          // Accounts are read through the account port, the binding every
          // other reader of accounts follows; a composition substitutes it
          // as drivers.identityAccountStore, never as a second reader.
          throw new Error(
            `extension '${unit.name}' registers a row reader for '${name}', which is reserved — identity accounts are read through the account port (drivers.identityAccountStore)`,
          );
        }
        if (kindServedByEdition(kind, ServerEdition.oss)) {
          // Open source keeps its own kinds' rows in its own store; a
          // reader would answer checks from rows its lanes never wrote.
          throw new Error(
            `extension '${unit.name}' registers a row reader for '${name}', which open source serves from its own store — readers are for kinds a unit keeps itself`,
          );
        }
        const declaredBy = rowReaderDeclaredBy.get(kind);
        if (declaredBy !== undefined) {
          throw new Error(
            `extension '${unit.name}' registers a row reader for '${name}', but '${declaredBy}' already did — one reader per kind across the composed set`,
          );
        }
        resourceRowReaders.set(kind, reader);
        rowReaderDeclaredBy.set(kind, unit.name);
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
    callerGuards.push(...(unit.callerGuards ?? []));
    statusObservers.push(...(unit.statusTransitionHooks?.observers ?? []));
    responseDecorators.push(
      ...(unit.statusTransitionHooks?.responseDecorators ?? []),
    );
    services.push(
      ...(unit.services ?? []).map((register) => ({
        unit: unit.name,
        register,
      })),
    );
    workers.push(...(unit.workers ?? []));
    if (unit.onComposed !== undefined) {
      onComposed.push({ unit: unit.name, hook: unit.onComposed });
    }
    if (unit.start !== undefined) {
      start.push({ unit: unit.name, hook: unit.start });
    }
  }

  return {
    unitNames,
    edition: edition ?? ServerEdition.oss,
    requireAuthentication:
      requireAuthenticationDeclaredBy !== undefined
        ? { declaredBy: requireAuthenticationDeclaredBy }
        : undefined,
    authorizer,
    identityVerifiers,
    callerGuards,
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
      scheduleFireCaller,
      identityAccountStore,
      identityFederation,
      iamPolicyStore,
      policyGrantScope,
      authorizationQueries,
      principalDisplay,
      licenseStatus,
      outboundEgress,
      platformClientStore,
      platformTokenKeys,
      guestTokenMinting,
      visitorClassifier,
      resourceRowReaders,
    },
    services,
    workers,
    onComposed,
    start,
  };
}
