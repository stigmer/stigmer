/**
 * The drivers extension point — infrastructure substitution seams of the
 * convergence blueprint (20260826.02 blueprint/03 §6, DD-006 §2a). The
 * point exists from O1 (20260826.09); the registrable KINDS join with
 * their extraction entries, each adding a field here as an owner-visible
 * surface change:
 *
 *   - model-catalog provider (§6a) and artifact-storage driver
 *     registration + runner-credential provider (§6b/§6c) — landed, O5
 *     (20260827.02)
 *   - sandbox provisioners (§6d) — landed, O6 (20260827.05)
 *   - resource-authorization lifecycle + organization directory —
 *     landed with C2 (20260827.10, rulings Q2/Q7)
 *   - channel runtime (DD-004's serving seam) — landed with C3
 *     (20260827.11, plan-gate ruling Q1)
 *   - list read scope (the list-shaped tenant-isolation fork) — landed
 *     with 20260830.01.sp.list-read-scoping, generalizing C2 Stage 4's
 *     ExecutionReadScope (absorbed, gate ruling Q2)
 *   - visitor error policy (the transport-boundary sanitizer's
 *     edition semantics) — landed with 20260830.03, gate ruling Q1
 *   - secret codecs (the versioned secret-value wire formats) — landed
 *     with 20260830.04 Stage 1, gate ruling Q2
 *   - schedule-fire caller (who a schedule fire acts as) — landed with
 *     the stigmer-cloud#572 fix (the Java schedule-token mechanism's
 *     seam; ruled 2026-09-01)
 *   - identity-account store + identity federation (the first domain
 *     whose persistence is a PORT, and the four federated RPC arms only
 *     one edition serves) — landed with 20260911.11, gate ruling Q-IA-9
 *   - IamPolicy store + policy grant scope + authorization queries (the
 *     IamPolicy domain's row half served in every edition; the store
 *     port, which kinds an edition grants on, and the tuple-half query
 *     engine only an authorization backend can answer) — landed with
 *     20260913.01, gate ruling Q-OR-10
 *   - outbound egress (which addresses the control plane may dial when
 *     it reaches a URL a user supplied: the MCP endpoint it probes at save
 *     time and the login server it reaches on Sign in) — landed with the
 *     save-time OAuth completion for URL-only MCP servers, 2026-09-19
 *   - platform-client store + platform-token keys + guest-token minting
 *     (PlatformClient served in every edition: the port the cloud's
 *     `cloud.iam_platform_client` driver fills, the RS256 key ring every
 *     self-signed token rides, and the one token method only an edition
 *     that hosts shared-agent pages serves) — landed 2026-09-23
 *
 * Merge rules (enforced by resolveExtensions, DD-006 §2b): the two
 * provider kinds are single-instance points — a second declaring unit is
 * a boot throw naming both units (the authorizer rule); artifact-storage
 * and sandbox-provisioner drivers merge as name-keyed maps — a
 * duplicated name, or a name shadowing a built-in, is a boot throw (the
 * gateSteps rule: a registration the factory could never reach must fail
 * loudly, not sit dark). OSS defaults install at the boot/compose.ts
 * consumption sites, never here (the default-lives-with-the-consumer
 * doctrine).
 */
import type { ArtifactStorageDriverFactory } from "../artifactstorage/artifact-storage.js";
import type { ChannelRuntime } from "../domain/agentchannel/channel-runtime.js";
import type { IdentityAccountStore } from "../domain/identityaccount/store.js";
import type { IamPolicyStore } from "../domain/iampolicy/store.js";
import type { PlatformClientStore } from "../domain/platformclient/store.js";
import type { SecretCodec } from "../encryption/codec.js";
import type { ModelCatalogProvider } from "../domain/workflow/registry/model-catalog-provider.js";
import type { VisitorErrorPolicy } from "../pipeline/interceptors/error-boundary.js";
import type { PlatformTokenKeyRing } from "../platformtoken/key-ring.js";
import type { RunnerCredentialProvider } from "../runnerauth/runner-credential-provider.js";
import type { SandboxProvisionerFactory } from "../sandbox/provisioner.js";
import type { AuthorizationQueryEngine } from "./authorization-queries.js";
import type { GuestTokenMinting } from "./guest-token-minting.js";
import type { IdentityFederation } from "./identity-federation.js";
import type { LicenseStatusProvider } from "./license-status.js";
import type { OutboundEgressPolicy } from "./outbound-egress.js";
import type { ListReadScope } from "./list-read-scope.js";
import type { OrganizationDirectory } from "./organization-directory.js";
import type { PolicyGrantScope } from "./policy-grant-scope.js";
import type { ResourceAuthorizationLifecycle } from "./resource-authorization.js";
import type { ScheduleFireCallerMint } from "./schedule-fire-caller.js";

/** The driver contributions of one extension unit. */
export interface ExtensionDrivers {
  /**
   * The model-catalog data source (DD-008; single-instance point). When
   * composed, it replaces the OSS ModelRegistryStore everywhere — the
   * OSS store and its upstream refresh are then never constructed.
   */
  readonly modelCatalogProvider?: ModelCatalogProvider;
  /**
   * The runner-credential mint/verify seam (§6c; single-instance point).
   * When composed, it replaces the OSS execution-scoped HS256 default at
   * every consumer (platform exchange, mcpserver connect, the
   * executioncontext decrypt lane).
   */
  readonly runnerCredentialProvider?: RunnerCredentialProvider;
  /**
   * Blob-storage backends registrable by name (§6b), selectable through
   * the ARTIFACT_STORAGE_TYPE / SKILL_ARTIFACT_STORAGE_TYPE config knobs.
   * Factories, not instances — an unselected driver constructs nothing.
   */
  readonly artifactStorageDrivers?: ReadonlyMap<
    string,
    ArtifactStorageDriverFactory
  >;
  /**
   * Sandbox provisioners registrable by name (§6d), selectable through
   * the SANDBOX_PROVISIONER_TYPE config knob. Factories, not instances —
   * an unselected driver constructs nothing. The built-in names
   * (local-process, docker, kubernetes — src/sandbox/provisioner.ts) are
   * reserved.
   */
  readonly sandboxProvisionerDrivers?: ReadonlyMap<
    string,
    SandboxProvisionerFactory
  >;
  /**
   * The resource-authorization lifecycle seam (C2, ruling Q2;
   * single-instance point). When composed, the three shared tuple steps
   * (CreateAuthorizationTuples / CleanupIamPolicies /
   * UpdateVisibilityTuples) deliver resolved events to it, and the
   * IamPolicy grant path delivers the two policy hooks. Corrected
   * 2026-09-13 (20260913.01 Q-OR-6): when absent, the steps no-op, but
   * open source is no longer record-less — the composition root installs
   * the built-in role lifecycle (domain/iampolicy/role-lifecycle.ts, the
   * entry's slice 4), which writes IamPolicy rows, whenever no extension
   * registers an Authorizer (resource-authorization.ts header).
   */
  readonly resourceAuthorizationLifecycle?: ResourceAuthorizationLifecycle;
  /**
   * The organization query directory (C2, ruling Q7; single-instance
   * point). When composed, the organization controller consults it for
   * the three edition forks (enumeration posture, my-orgs filtering,
   * external-org lookup); when absent, OSS behavior byte-identical.
   */
  readonly organizationDirectory?: OrganizationDirectory;
  /**
   * The channel delivery runtime (DD-004's serving seam; single-instance
   * point). When composed, the agentchannel install arms, the whole
   * messaging and conversation surfaces, and the two write/delete hooks
   * delegate to it; with none, the byte-pinned refusal posture serves
   * (src/domain/agentchannel/channel-runtime.ts carries the contract).
   */
  readonly channelRuntime?: ChannelRuntime;
  /**
   * The list read scope (20260830.01; single-instance point; absorbs C2
   * Stage 4's ExecutionReadScope). When composed, every ruled list-shaped
   * read — the census of docs/authorization-coverage.md — narrows to the
   * caller's authorized rows: post-scan lanes through
   * restrictListByReadScope, the search/activity/summary lanes through
   * the enumeration verb. When absent under the built-in authorization
   * posture, open source composes its own (src/authorization/
   * list-read-scope.ts — the model evaluated per candidate); when absent
   * under trusted-local, the OSS full scan — byte-identical.
   */
  readonly listReadScope?: ListReadScope;
  /**
   * The visitor error policy (20260830.03; single-instance point) — the
   * edition semantics of the serving chain's error boundary: WHO is on
   * the anonymous surface and WHAT copy replaces a leak-prone
   * description. When absent, the boundary runs only its structural
   * raw-error conversion — OSS wire behavior otherwise byte-identical.
   */
  readonly visitorErrorPolicy?: VisitorErrorPolicy;
  /**
   * Secret codecs registrable by wire-format version token (20260830.04
   * Stage 1, gate ruling Q2) — one entry per enc:v<N>: format the
   * composition can read and (when selected by
   * STIGMER_ENCRYPTION_WRITE_VERSION) write. Instances, not factories:
   * the Java posture is "registration IS the ability to encrypt" — a
   * codec exists exactly when its key machinery does. The built-in "v1"
   * token is reserved (the OSS static-key codec installs at the
   * compose.ts consumption site); registering it, or duplicating a
   * version across units, is a boot throw. When absent, the facade is
   * v1-only — OSS behavior byte-identical.
   */
  readonly secretCodecs?: ReadonlyMap<string, SecretCodec>;
  /**
   * The schedule-fire caller mint (stigmer-cloud#572; single-instance
   * point) — the identity a schedule fire acts as when it re-enters the
   * execution create pipeline. When composed, the RunStarter propagates
   * the minted caller through the R5 in-process header on every fire
   * (cron tick and manual trigger alike); when absent, fires enter as
   * the `internal` class — OSS behavior byte-identical.
   */
  readonly scheduleFireCaller?: ScheduleFireCallerMint;
  /**
   * The identity-account store driver (20260911.11, Q-IA-9;
   * single-instance point). The identity-account domain is the first
   * whose persistence is a PORT rather than the generic Store: when
   * composed, the domain's every read and write — the create path, the
   * provisioner, the boot-time operator ensure and BOTH OSS verifiers'
   * subject resolution — goes through this driver (the cloud serves the
   * domain over its own `cloud.iam_identity_account` table this way).
   * When absent, the OSS adapter over the generic Store installs at the
   * compose.ts consumption site — OSS behavior byte-identical.
   */
  readonly identityAccountStore?: IdentityAccountStore;
  /**
   * The identity-federation capability (20260911.11, Q-IA-9;
   * single-instance point): the four federated-account RPC arms plus the
   * IdP-exists probe their shared precondition rides. When composed, the
   * identity-account controller dispatches to it after its own shared
   * checks; when absent, the four RPCs refuse UNIMPLEMENTED with the
   * edition reason — the organizationDirectory absent-method shape.
   */
  readonly identityFederation?: IdentityFederation;
  /**
   * The IamPolicy store driver (20260913.01, Q-OR-10; single-instance
   * point). The IamPolicy domain's persistence is a PORT like the
   * identity-account domain's: when composed, every row the one grant
   * path writes, deletes or reads — user grants, the structural
   * bootstrap lanes, the access lists and counts — goes through this
   * driver (the cloud serves the domain over its own `cloud.iam_policy`
   * table this way, legacy random ids included). When absent, the OSS
   * adapter over the generic Store installs at the compose.ts
   * consumption site — OSS behavior byte-identical.
   */
  readonly iamPolicyStore?: IamPolicyStore;
  /**
   * The policy grant scope (20260913.01, Q-OR-3; single-instance point):
   * which kinds a user may grant a role on in this edition, with which
   * roles. Narrows the proto's `grantable_roles`, total over the enum,
   * synchronous (policy-grant-scope.ts carries the reasons). When
   * composed, ValidateGrantableRole and checkMyPermission's
   * `can_grant_access` arm read it; when absent, open source's
   * organization-only default installs at the compose.ts consumption
   * site — the organization grants its four proto roles, nothing else
   * grants anything.
   */
  readonly policyGrantScope?: PolicyGrantScope;
  /**
   * The authorization-query engine (20260913.01, Q-OR-8; single-instance
   * point): the tuple-half questions — checkAuthorization, the two
   * listAuthorized*Ids, a checkMyPermission with contextual policies —
   * only an authorization backend can answer over its own graph. When
   * composed, the IamPolicy query controller dispatches to it after its
   * own trust checks; when absent, those RPC arms refuse UNIMPLEMENTED
   * with the edition reason — the identityFederation absent shape.
   */
  readonly authorizationQueries?: AuthorizationQueryEngine;
  /**
   * The license-status provider (single-instance point): what license
   * this server holds, answered by PlatformQueryController.getLicenseStatus
   * in every edition. An Enterprise unit registers the provider that
   * verifies its configured ticket; when absent, the built-in `absent`
   * answer installs at the compose.ts consumption site, so open source
   * and the cloud (which hold no key) answer the same question the same
   * way (extensions/license-status.ts carries the contract).
   */
  readonly licenseStatus?: LicenseStatusProvider;
  /**
   * The outbound-egress policy (single-instance point): which addresses
   * this edition's control plane may dial when it reaches a URL a user
   * supplied. The composition root builds one guarded fetch from it and
   * hands it to the McpServer connect slice, the only fetch its OAuth code
   * and its save-time endpoint probe hold. When absent, open source's
   * `relaxedEgressPolicy()` installs at the compose.ts consumption site:
   * everything but the link-local (cloud metadata) range is allowed, so a
   * server beside a self-hosted control plane keeps working
   * (extensions/outbound-egress.ts carries the contract).
   */
  readonly outboundEgress?: OutboundEgressPolicy;
  /**
   * The platform-client store driver (single-instance point). The
   * platform-client domain's persistence is a PORT like the
   * identity-account domain's: when composed, every chain, the mint and
   * the verifier's liveness read go through this driver (the cloud serves
   * the domain over its own `cloud.iam_platform_client` table this way,
   * legacy `pc_` ids included). When absent, the OSS adapter over the
   * generic Store installs at the compose.ts consumption site.
   */
  readonly platformClientStore?: PlatformClientStore;
  /**
   * The platform-token key ring (single-instance point): the RS256 keys
   * every token the server signs for itself rides
   * (platformtoken/key-ring.ts). Consumed only under an authentication
   * posture — nothing verifies a token on a server that trusts every
   * request. When absent there, open source composes its own ring on the
   * key-manager ladder; a composition declaring an edition other than
   * open source must supply one (compose.ts refuses to boot without it,
   * so a hosted edition never signs with a generated key).
   */
  readonly platformTokenKeys?: PlatformTokenKeyRing;
  /**
   * The guest-token capability (single-instance point): the one
   * PlatformClientTokenController method only an edition hosting
   * shared-agent pages serves. When absent, `mintGuestToken` refuses
   * UNIMPLEMENTED with the edition sentence
   * (extensions/guest-token-minting.ts carries the contract).
   */
  readonly guestTokenMinting?: GuestTokenMinting;
}
