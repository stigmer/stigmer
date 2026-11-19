/**
 * The runner artifact lane's part of an organization's purge: every object
 * a run of the organization stored under `artifacts/<run id>/` goes with
 * the organization.
 *
 * Those objects are the runner's: offloaded tool output, file-review
 * content and its blobs, at keys the runner chose and the lane presigned
 * (lane.ts). Nothing records those keys, so each of the organization's
 * runs' folders is listed and emptied (`ArtifactStorage.deletePrefix`).
 * The runs are read from the store, which still holds them while this
 * stage runs: it runs before the content stage. Files are not this stage's:
 * the content stage deletes every File and its blob by row.
 *
 * A call deletes at most `RUN_ARTIFACT_PURGE_BATCH` objects and answers
 * `more` while any are left; it is idempotent, since an emptied folder
 * lists nothing. A fault (a refused listing included) is logged with its
 * cause and thrown, so the purge retries the stage.
 *
 * Registered only when the composed store can delete by prefix.
 *
 * Proven by __tests__/purge.test.ts.
 */
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type {
  OrganizationPurgeProgress,
  OrganizationPurgeStage,
  OrganizationRows,
} from "../../extensions/organization-purge.js";
import type { ArtifactStorage } from "../artifact-storage.js";
import { ARTIFACT_KEY_PREFIX } from "./key-rules.js";

/** The stage's name in the deletion record and the logs. */
export const RUN_ARTIFACT_PURGE_STAGE = "execution-artifacts";

/** The most objects one call deletes. */
export const RUN_ARTIFACT_PURGE_BATCH = 1000;

/** How many run ids one page of the organization's runs reads. */
const RUN_ID_PAGE = 500;

export function newRunArtifactPurgeStage(
  storage: Required<Pick<ArtifactStorage, "deletePrefix">>,
): OrganizationPurgeStage {
  return {
    name: RUN_ARTIFACT_PURGE_STAGE,
    async run({ org, rows, logger }): Promise<OrganizationPurgeProgress> {
      let budget = RUN_ARTIFACT_PURGE_BATCH;
      try {
        for (const runId of await allRunIds(rows)) {
          if (runId === "" || runId.includes("/")) {
            continue;
          }
          const removed = await storage.deletePrefix(`${ARTIFACT_KEY_PREFIX}${runId}/`, budget);
          budget -= removed.deleted;
          if (removed.more || budget <= 0) {
            return { more: true };
          }
        }
        return { more: false };
      } catch (error) {
        logger.error("Removing an organization's run artifacts failed; the purge retries", {
          org: org.id,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
  };
}

async function allRunIds(rows: OrganizationRows): Promise<string[]> {
  const ids: string[] = [];
  let after = "";
  for (;;) {
    const page = await rows.ids(ApiResourceKind.run, RunSchema, { after, limit: RUN_ID_PAGE });
    ids.push(...page.ids);
    if (page.next === undefined) {
      return ids;
    }
    after = page.next;
  }
}
