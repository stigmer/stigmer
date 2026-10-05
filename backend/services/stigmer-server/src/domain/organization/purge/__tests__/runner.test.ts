/**
 * Pins the purge runner (../runner.ts) over a real SQLite store and stages
 * that record what they are asked: the store's deletion table is the
 * runner's only state, so the arms read it back.
 *
 * What it pins:
 *   - an accepted purge runs every stage in order, a stage again while it
 *     answers `more`, and releases nothing itself (the final stage does);
 *   - a purge resumes at the stage its record names;
 *   - a stage's context reads the organization's rows through the
 *     composition's list indexes;
 *   - a stage that answers `wait` ends the purge's turn, and the next
 *     pass of the same pod goes on although its own heartbeat is fresh;
 *   - a fault records the stage and the fixed copy, backs off, and the
 *     purge runs again once the backoff has passed;
 *   - a pending mark older than the stale age is unmarked, a younger one
 *     is left; an accepted purge another pod heartbeat recently is left
 *     alone until its heartbeat is stale;
 *   - two stages of one name refuse to compose; stop waits for the pass;
 *   - a second start is a no-op; the interval and a kick during a pass ask
 *     for one more pass, which runs when the first ends; a stop during a
 *     pass ends it before the next batch and the next organization;
 *   - a deletion table that cannot be listed, a stale mark that cannot be
 *     removed and a fault that cannot be recorded are logged, never thrown;
 *     an organization row that cannot be read is the stage's fault.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  OrganizationPurgeProgress,
  OrganizationPurgeStage,
} from "../../../../extensions/organization-purge.js";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import { sessionListIndex } from "../../../session/list-index.js";
import type { ListIndexQuery } from "../../../../store/list-index.js";
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

  it("hands each stage a row reader over the composition's list indexes", async () => {
    await accepted();
    const queries: Array<{ index: string; query: ListIndexQuery }> = [];
    const spied = Object.create(store) as SqliteStore;
    spied.queryResources = (declaration, query) => {
      queries.push({ index: String(declaration.kind), query });
      return Promise.resolve([]);
    };
    spied.findResourcesRawOrderedAfter = () =>
      Promise.reject(new Error("an indexed kind was scanned"));
    let read: unknown;
    await new OrganizationPurgeRunner({
      store: spied,
      logger: silentLogger,
      listIndexes: [sessionListIndex],
      stages: [
        {
          name: "reads",
          async run(context) {
            read = await context.rows.ids(ApiResourceKind.session, SessionSchema, {
              after: "",
              limit: 5,
            });
            return { more: false };
          },
        },
      ],
      now: () => clock,
    }).runPass();
    expect(read).toEqual({ ids: [], next: undefined });
    expect(queries).toEqual([
      { index: String(sessionListIndex.kind), query: { org: ORG, limit: 5 } },
    ]);
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

  it("runs one more pass for a kick or an interval that came during one, and ignores a second start", async () => {
    await accepted();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const inStage = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let runs = 0;
    const purge = new OrganizationPurgeRunner({
      store,
      logger: silentLogger,
      now: () => clock,
      intervalMs: 5,
      stages: [
        {
          name: "slow",
          async run() {
            runs += 1;
            entered();
            await gate;
            // Waiting here keeps the purge this pod's, so the next pass takes it again.
            return { more: true, wait: true };
          },
        },
      ],
    });
    purge.start();
    purge.start();
    await inStage;
    purge.kick(ORG);
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await vi.waitFor(() => expect(runs).toBeGreaterThanOrEqual(2));
    await purge.stop();
  });

  it("ends a pass at a stop, before the next batch and the next organization", async () => {
    await accepted("org_01kfirstfirstfirstfirstfirst");
    await accepted("org_01ksecondsecondsecondsecond");
    const calls: string[] = [];
    const purge: OrganizationPurgeRunner = new OrganizationPurgeRunner({
      store,
      logger: silentLogger,
      now: () => clock,
      stages: [
        {
          name: "a",
          async run(context) {
            calls.push(context.org.id);
            void purge.stop();
            return { more: true };
          },
        },
      ],
    });
    await purge.runPass();
    expect(calls).toEqual(["org_01kfirstfirstfirstfirstfirst"]);
  });

  it("logs, never throws, when the table cannot be listed, a stale mark cannot be removed, or a fault cannot be recorded", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", pretty: false, write: (line) => lines.push(line) });
    const purge = new OrganizationPurgeRunner({
      store,
      logger,
      now: () => clock,
      stages: [scripted("a", [], [new Error("stage down")])],
    });
    vi.spyOn(store.organizationDeletions, "list").mockRejectedValueOnce(new Error("store down"));
    await purge.runPass();
    expect(lines.join("\n")).toContain("could not read the deletion table");

    await store.organizationDeletions.mark(ORG, T0.toISOString());
    clock = new Date(T0.getTime() + STALE_PENDING_MS);
    vi.spyOn(store.organizationDeletions, "unmark").mockRejectedValueOnce(new Error("store down"));
    await purge.runPass();
    expect(lines.join("\n")).toContain("could not remove a stale organization delete mark");

    await store.organizationDeletions.accept(ORG, T0.toISOString());
    vi.spyOn(store.organizationDeletions, "recordError").mockRejectedValueOnce(new Error("store down"));
    await purge.runPass();
    expect(lines.join("\n")).toContain("could not record an organization purge fault");
  });

  it("records a fault when the organization's row cannot be read", async () => {
    await accepted();
    vi.spyOn(store, "getResource").mockRejectedValueOnce(new Error("store down"));
    const calls: string[] = [];
    await runner([scripted("a", calls)]).runPass();
    expect(calls).toEqual([]);
    expect((await store.organizationDeletions.get(ORG))?.lastError).toBe(PURGE_FAULT_MESSAGE);
  });
});

