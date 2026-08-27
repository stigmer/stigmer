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
 *   - sandbox provisioners (§6d) — O6
 *
 * Merge rules (enforced by resolveExtensions, DD-006 §2b): the two
 * provider kinds are single-instance points — a second declaring unit is
 * a boot throw naming both units (the authorizer rule); artifact-storage
 * drivers merge as a name-keyed map — a duplicated name, or a name
 * shadowing a built-in backend, is a boot throw (the gateSteps rule: a
 * registration the factory could never reach must fail loudly, not sit
 * dark). OSS defaults install at the boot/compose.ts consumption sites,
 * never here (the default-lives-with-the-consumer doctrine).
 */
import type { ArtifactStorageDriverFactory } from "../artifactstorage/artifact-storage.js";
import type { ModelCatalogProvider } from "../domain/workflow/registry/model-catalog-provider.js";
import type { RunnerCredentialProvider } from "../runnerauth/runner-credential-provider.js";

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
}
