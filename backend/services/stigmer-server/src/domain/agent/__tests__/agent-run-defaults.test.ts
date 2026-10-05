/**
 * Pins readRunAgentSpec (run-defaults.ts) over a real SQLite store: the
 * spec of the version a turn runs, for its run defaults.
 *
 *   - no agent reads nothing;
 *   - an empty version hash reads the agent as it is now;
 *   - the head's hash reads the head, an archived hash the archived spec
 *     (not the head's);
 *   - a version the agent does not hold, and an agent that is gone, are
 *     NotFound; any other store fault is Internal.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { LIST_INDEXES } from "../../../boot/list-indexes.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { readRunAgentSpec } from "../run-defaults.js";

const AGENT = "agt_1";
const HEAD = "a".repeat(64);
const OLD = "b".repeat(64);

let dir: string;
let store: Store;

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agent-run-defaults-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: LIST_INDEXES,
  });
  const agent = (model: string, versionHash: string) =>
    create(AgentSchema, {
      metadata: { id: AGENT, org: "acme", slug: "reviewer" },
      spec: { harness: Harness.NATIVE, runConfig: { modelName: model } },
      status: { versionHash },
    });
  await store.saveAudit(ApiResourceKind.agent, AGENT, AgentSchema, agent("old-model", OLD), OLD, "");
  await store.saveResource(ApiResourceKind.agent, AGENT, AgentSchema, agent("head-model", HEAD));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

async function code(read: Promise<unknown>): Promise<Code | undefined> {
  try {
    await read;
  } catch (error) {
    return error instanceof ConnectError ? error.code : undefined;
  }
  return undefined;
}

describe("readRunAgentSpec", () => {
  it("reads nothing for no agent", async () => {
    expect(await readRunAgentSpec(store, "", HEAD)).toBeUndefined();
  });

  it("reads the agent as it is now when the turn names no version", async () => {
    expect((await readRunAgentSpec(store, AGENT, ""))?.runConfig?.modelName).toBe("head-model");
  });

  it("reads the head by its hash and an archived version by its own", async () => {
    expect((await readRunAgentSpec(store, AGENT, HEAD))?.runConfig?.modelName).toBe("head-model");
    expect((await readRunAgentSpec(store, AGENT, OLD))?.runConfig?.modelName).toBe("old-model");
  });

  it("answers NotFound for a version the agent does not hold, and for an agent that is gone", async () => {
    expect(await code(readRunAgentSpec(store, AGENT, "f".repeat(64)))).toBe(Code.NotFound);
    expect(await code(readRunAgentSpec(store, "agt_gone", ""))).toBe(Code.NotFound);
  });

  it("answers Internal for a store fault reading the head", async () => {
    const faulty = {
      getResource: () => Promise.reject(new Error("disk on fire")),
    } as unknown as Store;
    expect(await code(readRunAgentSpec(faulty, AGENT, ""))).toBe(Code.Internal);
  });
});
