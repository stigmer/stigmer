/**
 * Pins the purge runner (../runner.ts) over a real SQLite store and stages
 * that record what they are asked: the store's deletion table is the
 * runner's only state, so the arms read it back.
 *
 * What it pins:
 *   - an accepted purge runs every stage in order, a stage again while it
 *     answers `more`, and releases nothing itself (the final stage does);
 *   - a purge resumes at the stage its record names;
 *   - a stage that answers `wait` ends the purge's turn, and the next
 *     pass of the same pod goes on although its own heartbeat is fresh;
 *   - a fault records the stage and the fixed copy, backs off, and the
 *     purge runs again once the backoff has passed;
 *   - a pending mark older than the stale age is unmarked, a younger one
 *     is left; an accepted purge another pod heartbeat recently is left
 *     alone until its heartbeat is stale;
 *   - two stages of one name refuse to compose; stop waits for the pass.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  OrganizationPurgeProgress,
  OrganizationPurgeStage,
} from "../../../../extensions/organization-purge.js";
import { silentLogger } from "../../../../extensions/__tests__/composed-support.js";
import { SqliteStore } from "../../../../store/sqlite/store.js";
import {
  OrganizationPurgeRunner,
  PURGE_FAULT_MESSAGE,
  RETRY_BASE_MS,
  STALE_HEARTBEAT_MS,
  STALE_PENDING_MS,
} from "../runner.js";

const ORG = "org_01kpurgepurgepurgepurgepurg";
const T0 = new Date("2026-10-05T10:00:00.000Z");

let dir: string;
let store: SqliteStore;
let clock: Date;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "purge-runner-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  clock = T0;
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A stage that answers from a script and records each call. */
function scripted(
  name: string,
  calls: string[],
  answers: Array<OrganizationPurgeProgress | Error> = [],
): OrganizationPurgeStage {
  return {
    name,
    async run(context) {
      calls.push(`${name}:${context.org.id}`);
      const answer = answers.shift() ?? { more: false };
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
}

function runner(stages: OrganizationPurgeStage[]): OrganizationPurgeRunner {
  return new OrganizationPurgeRunner({
    store,
    logger: silentLogger,
    stages,
    now: () => clock,
  });
}

async function accepted(org = ORG): Promise<void> {
  await store.organizationDeletions.mark(org, T0.toISOString());
  await store.organizationDeletions.accept(org, T0.toISOString());
}

describe("the organization purge runner", () => {
  it("runs every stage in order, a stage again while it has more", async () => {
    await accepted();
    const calls: string[] = [];
    await runner([
      scripted("a", calls, [{ more: true }, { more: false }]),
      scripted("b", calls),
    ]).runPass();
    expect(calls).toEqual([`a:${ORG}`, `a:${ORG}`, `b:${ORG}`]);
    expect((await store.organizationDeletions.get(ORG))?.stage).toBe("b");
  });

  it("resumes at the stage its record names", async () => {
    await accepted();
    await store.organizationDeletions.heartbeat(ORG, "b", T0.toISOString());
    clock = new Date(T0.getTime() + STALE_HEARTBEAT_MS);
    const calls: string[] = [];
    await runner([scripted("a", calls), scripted("b", calls)]).runPass();
    expect(calls).toEqual([`b:${ORG}`]);
  });

  it("ends a waiting purge's turn and goes on at its own next pass", async () => {
    await accepted();
    const calls: string[] = [];
    const purge = runner([
      scripted("a", calls, [{ more: true, wait: true }, { more: false }]),
      scripted("b", calls),
    ]);
    await purge.runPass();
    expect(calls).toEqual([`a:${ORG}`]);
    await purge.runPass();
    expect(calls).toEqual([`a:${ORG}`, `a:${ORG}`, `b:${ORG}`]);
  });

  it("records a fault, backs off, and runs again once the backoff has passed", async () => {
    await accepted();
    const calls: string[] = [];
    const purge = runner([
      scripted("a", calls, [new Error("engine down"), { more: false }]),
    ]);
    await purge.runPass();
    expect(await store.organizationDeletions.get(ORG)).toMatchObject({
      stage: "a",
      lastError: PURGE_FAULT_MESSAGE,
    });
    await purge.runPass();
    expect(calls, "still backing off").toHaveLength(1);
    clock = new Date(T0.getTime() + RETRY_BASE_MS);
    await purge.runPass();
    expect(calls).toHaveLength(2);
    expect((await store.organizationDeletions.get(ORG))?.lastError).toBe("");
  });

  it("unmarks a stale pending mark and leaves a young one", async () => {
    await store.organizationDeletions.mark(ORG, T0.toISOString());
    const calls: string[] = [];
    const purge = runner([scripted("a", calls)]);
    clock = new Date(T0.getTime() + STALE_PENDING_MS - 1);
    await purge.runPass();
    expect(await store.organizationDeletions.isDeleting(ORG)).toBe(true);
    clock = new Date(T0.getTime() + STALE_PENDING_MS);
    await purge.runPass();
    expect(await store.organizationDeletions.isDeleting(ORG)).toBe(false);
    expect(calls, "a pending mark is never purged").toEqual([]);
  });

  it("leaves a purge another pod is working until its heartbeat is stale", async () => {
    await accepted();
    await store.organizationDeletions.heartbeat(ORG, "a", T0.toISOString());
    const calls: string[] = [];
    const purge = runner([scripted("a", calls)]);
    clock = new Date(T0.getTime() + STALE_HEARTBEAT_MS - 1);
    await purge.runPass();
    expect(calls).toEqual([]);
    clock = new Date(T0.getTime() + STALE_HEARTBEAT_MS);
    await purge.runPass();
    expect(calls).toEqual([`a:${ORG}`]);
  });

  it("refuses two stages of one name", () => {
    expect(() => runner([scripted("a", []), scripted("a", [])])).toThrow(
      "composed twice",
    );
  });

  it("stop waits for the pass in flight and nothing runs after it", async () => {
    await accepted();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const inStage = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const calls: string[] = [];
    const purge = new OrganizationPurgeRunner({
      store,
      logger: silentLogger,
      now: () => clock,
      intervalMs: 60_000,
      stages: [
        {
          name: "slow",
          async run() {
            calls.push("slow");
            entered();
            await gate;
            return { more: false };
          },
        },
      ],
    });
    purge.start();
    await inStage;
    const stopping = purge.stop();
    release();
    await stopping;
    purge.kick(ORG);
    expect(calls).toEqual(["slow"]);
  });
});
