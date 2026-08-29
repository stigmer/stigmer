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
 *   - execution read scope (the summary tenant-isolation fork) — landed
 *     with C2 Stage 4 (20260827.10, gate ruling)
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
import type { ModelCatalogProvider } from "../domain/workflow/registry/model-catalog-provider.js";
import type { RunnerCredentialProvider } from "../runnerauth/runner-credential-provider.js";
import type { SandboxProvisionerFactory } from "../sandbox/provisioner.js";
import type { ExecutionReadScope } from "./execution-read-scope.js";
import type { OrganizationDirectory } from "./organization-directory.js";
import type { ResourceAuthorizationLifecycle } from "./resource-authorization.js";

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
   * The execution read scope (C2 Stage 4; single-instance point). When
   * composed, both getExecutionSummary handlers aggregate only the
   * caller's authorized executions intersected with the requested org;
   * when absent, the OSS full scan — byte-identical.
   */
  readonly executionReadScope?: ExecutionReadScope;
}
