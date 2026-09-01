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
import type { SecretCodec } from "../encryption/codec.js";
import type { ModelCatalogProvider } from "../domain/workflow/registry/model-catalog-provider.js";
import type { VisitorErrorPolicy } from "../pipeline/interceptors/error-boundary.js";
import type { RunnerCredentialProvider } from "../runnerauth/runner-credential-provider.js";
import type { SandboxProvisionerFactory } from "../sandbox/provisioner.js";
import type { ListReadScope } from "./list-read-scope.js";
import type { OrganizationDirectory } from "./organization-directory.js";
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
   * UpdateVisibilityTuples) deliver resolved events to it; when absent,
   * those steps no-op — OSS behavior byte-identical.
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
   * the enumeration verb. When absent, the OSS full scan — byte-identical.
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
}
