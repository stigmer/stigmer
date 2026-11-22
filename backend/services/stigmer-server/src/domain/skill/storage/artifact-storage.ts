/**
 * Skill artifact store — the `skills/` instance of the content-addressed
 * archive store (src/archive/content-store.ts). Artifacts live at
 * {storagePath}/skills/{sha256}.zip, a storage layout every stored
 * artifact sits at, so it never changes. Write-once, never
 * garbage-collected: there is deliberately NO delete method, so the
 * storage keys listVersions exposes stay downloadable.
 *
 * This is a DOMAIN PORT over the one ArtifactStorage blob driver; the
 * compose root hands it a PER-DOMAIN driver instance rooted at storagePath,
 * so
 * skill artifacts never silently follow the generic artifact store's
 * backend selection. The port's implementation is src/archive's, shared
 * with plugins under `plugins/`; the names exported here are the skill
 * domain's.
 *
 * Proven by __tests__/artifact-storage.test.ts and the skill conformance
 * suite's getArtifact/round-trip tests.
 */
import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import type { IndexedArchiveStore } from "../../../archive/content-store.js";
import { newIndexedArchiveStore } from "../../../archive/content-store.js";
import { fileIndexKeyPrefix } from "../../../archive/file-index.js";

export { ArtifactNotFoundError } from "../../../archive/content-store.js";

/** Storage abstraction for skill artifacts. */
export type SkillArtifactStorage = IndexedArchiveStore;

/** The key prefix shared with a bucket store and the download lane's containment check. */
export const SKILL_ARTIFACT_KEY_PREFIX = "skills/";

/** The skill store over a blob driver: "skills/<hash>.zip", each archive's file index beside it. */
export function newSkillArtifactStorage(
  driver: ArtifactStorage,
): SkillArtifactStorage {
  return newIndexedArchiveStore(driver, SKILL_ARTIFACT_KEY_PREFIX, fileIndexKeyPrefix("skill"));
}
