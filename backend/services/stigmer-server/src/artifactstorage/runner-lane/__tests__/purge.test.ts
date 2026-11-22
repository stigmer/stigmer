/**
 * Pins the runner artifact lane's purge stage (purge.ts) over an in-memory
 * bucket: each of the organization's runs' folders is emptied and nothing
 * else (a sibling run's folder whose id shares a prefix is kept), past the
 * first page of the organization's runs too; a second
 * call removes nothing; past the batch the stage answers `more`; an id that
 * could escape its folder is skipped; a store fault is thrown for the purge
 * to retry.
 */
import { describe, expect, it } from "vitest";

import { createLogger } from "../../../boot/logger.js";
import type { OrganizationPurgeContext, OrganizationRows } from "../../../extensions/organization-purge.js";
import type { PrefixRemoval } from "../../artifact-storage.js";
import { newRunArtifactPurgeStage, RUN_ARTIFACT_PURGE_BATCH, RUN_ARTIFACT_PURGE_STAGE } from "../purge.js";

const logger = createLogger({ level: "error", pretty: false, write: () => {} });

function bucketOf(keys: string[]) {
  const objects = new Set(keys);
  return {
    objects,
    deletePrefix(prefix: string, limit: number): Promise<PrefixRemoval> {
      const under = [...objects].filter((k) => k.startsWith(prefix)).sort();
      const doomed = under.slice(0, limit);
      for (const key of doomed) objects.delete(key);
      return Promise.resolve({ deleted: doomed.length, more: under.length > limit });
    },
  };
}

function contextOf(runIds: string[]): OrganizationPurgeContext {
  const rows: OrganizationRows = {
    ids: (_kind, _schema, page) => {
      const start = page.after === "" ? 0 : Number(page.after);
      const ids = runIds.slice(start, start + page.limit);
      const end = start + ids.length;
      return Promise.resolve({ ids, next: end < runIds.length ? String(end) : undefined });
    },
  };
  return {
    org: { id: "acme", parentOrg: "" },
    logger,
    caller: { identityId: "internal", callerClass: "internal", issuer: "", rawToken: "" },
    rows,
  };
}

describe("the run artifact purge stage", () => {
  it("is named for the deletion record", () => {
    expect(newRunArtifactPurgeStage(bucketOf([])).name).toBe(RUN_ARTIFACT_PURGE_STAGE);
  });

  it("empties only the organization's runs' folders, and a second call removes nothing", async () => {
    const bucket = bucketOf(["artifacts/run_1/a", "artifacts/run_1/b/c", "artifacts/run_10/a", "files/acme/f"]);
    const stage = newRunArtifactPurgeStage(bucket);
    expect(await stage.run(contextOf(["run_1"]))).toEqual({ more: false });
    expect([...bucket.objects].sort()).toEqual(["artifacts/run_10/a", "files/acme/f"]);
    expect(await stage.run(contextOf(["run_1"]))).toEqual({ more: false });
  });

  it("reads every page of the organization's runs, emptying the folders past the first", async () => {
    const runIds = Array.from({ length: 501 }, (_, i) => `run_${String(i).padStart(3, "0")}`);
    const bucket = bucketOf([...runIds.map((id) => `artifacts/${id}/out.txt`), "artifacts/run_other/kept"]);
    expect(await newRunArtifactPurgeStage(bucket).run(contextOf(runIds))).toEqual({ more: false });
    expect([...bucket.objects]).toEqual(["artifacts/run_other/kept"]);
  });

  it("answers more past one batch", async () => {
    const keys = Array.from({ length: RUN_ARTIFACT_PURGE_BATCH + 5 }, (_, i) => `artifacts/run_1/${i}`);
    const bucket = bucketOf(keys);
    const stage = newRunArtifactPurgeStage(bucket);
    expect(await stage.run(contextOf(["run_1"]))).toEqual({ more: true });
    expect(await stage.run(contextOf(["run_1"]))).toEqual({ more: false });
    expect(bucket.objects.size).toBe(0);
  });

  it("skips an id that could escape its folder", async () => {
    const bucket = bucketOf(["artifacts/x"]);
    expect(await newRunArtifactPurgeStage(bucket).run(contextOf(["", "a/b"]))).toEqual({ more: false });
    expect(bucket.objects.size).toBe(1);
  });

  it("throws a store fault for the purge to retry", async () => {
    const failing = { deletePrefix: () => Promise.reject(new Error("list refused")) };
    await expect(newRunArtifactPurgeStage(failing).run(contextOf(["run_1"]))).rejects.toThrow("list refused");
  });
});
