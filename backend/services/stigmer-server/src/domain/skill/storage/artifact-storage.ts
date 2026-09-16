/**
 * Skill artifact store — the `skills/` instance of the content-addressed
 * archive store (src/archive/content-store.ts). Artifacts live at
 * {storagePath}/skills/{sha256}.zip, byte-identical to the retired Go
 * server's paths: at cutover the TS server inherited a Go-written storage
 * directory and serves its artifacts in place. Write-once, never
 * garbage-collected (OD-5): there is deliberately NO delete method, so the
 * storage keys listVersions exposes stay downloadable.
 *
 * Since O5 (20260827.02, blueprint 03 §6b) this is a DOMAIN PORT over the
 * one ArtifactStorage blob driver (the Q2 gate ruling); the compose root
 * hands it a PER-DOMAIN driver instance rooted at storagePath (Q2b), so
 * skill artifacts never silently follow the generic artifact store's
 * backend selection. The port's implementation moved to src/archive when
 * plugins needed the identical shape under `plugins/`; the names exported
 * here are the skill domain's and every consumer keeps them.
 *
 * Proven by __tests__/artifact-storage.test.ts and the skill conformance
 * suite's getArtifact/round-trip tests.
 */
import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import type { ContentAddressedArchiveStore } from "../../../archive/content-store.js";
import { newContentAddressedArchiveStore } from "../../../archive/content-store.js";

export { ArtifactNotFoundError } from "../../../archive/content-store.js";

/** Storage abstraction for skill artifacts (Go ArtifactStorage). */
export type SkillArtifactStorage = ContentAddressedArchiveStore;

/** The key prefix shared with cloud R2 and the download lane's containment check. */
export const SKILL_ARTIFACT_KEY_PREFIX = "skills/";

/** The skill store over a blob driver: "skills/<hash>.zip". */
export function newSkillArtifactStorage(
  driver: ArtifactStorage,
): SkillArtifactStorage {
  return newContentAddressedArchiveStore(driver, SKILL_ARTIFACT_KEY_PREFIX);
}
