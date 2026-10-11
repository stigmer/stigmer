/**
 * Pins the subagents a run's agent lists (run-subagents.ts), over a real
 * SQLite store holding an agent's head and an archived version:
 *   - each reference is read at the version its parent pinned: the head
 *     when the pin is the head's hash, an archived version by its hash;
 *     each carries its name in the turn (its slug) and its organization,
 *     the run's when the reference names none;
 *   - a listed agent that is gone, and a pinned version it no longer has,
 *     refuse the create FAILED_PRECONDITION naming it;
 *   - no agent, an agent listing none, and a reference with no slug read
 *     nothing;
 *   - a store fault is INTERNAL, never mistaken for a gone subagent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { runSubagents, subagentGoneMessage } from "../run-subagents.js";

const ORG = "acme";
const OTHER_ORG = "elsewhere";
const HEAD = "a".repeat(64);
const OLDER = "b".repeat(64);

let dir: string;
let store: SqliteStore;

function agentRow(id: string, org: string, slug: string, instructions: string, versionHash: string) {
  return create(AgentSchema, {
    metadata: { id, org, slug, name: slug },
    spec: { instructions, env: { [`${slug.toUpperCase()}_KEY`]: { isSecret: true } } },
    status: { versionHash },
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "run-subagents-test-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"));
  await store.saveResource(
    ApiResourceKind.agent,
    "agt_researcher",
    AgentSchema,
    agentRow("agt_researcher", ORG, "researcher", "Research, as it is now.", HEAD),
  );
  await store.saveAudit(
    ApiResourceKind.agent,
    "agt_researcher",
    AgentSchema,
    agentRow("agt_researcher", ORG, "researcher", "Research, as it was.", OLDER),
    OLDER,
    "",
  );
  await store.saveResource(
    ApiResourceKind.agent,
    "agt_theirs",
    AgentSchema,
    agentRow("agt_theirs", OTHER_ORG, "researcher", "Their researcher.", HEAD),
  );
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

function listing(...refs: Array<{ slug: string; version: string; org?: string }>): AgentSpec {
  return create(AgentSpecSchema, {
    subagents: refs.map((ref) => ({ kind: ApiResourceKind.agent, org: ref.org ?? "", slug: ref.slug, version: ref.version })),
  });
}

describe("runSubagents", () => {
  it("reads each subagent at its pinned version, by its slug, in its organization", async () => {
    const subagents = await runSubagents(
      store,
      listing({ slug: "researcher", version: OLDER, org: ORG }, { slug: "researcher", version: HEAD, org: OTHER_ORG }),
      ORG,
    );
    expect(subagents.map((s) => [s.name, s.org, s.spec.instructions])).toEqual([
      ["researcher", ORG, "Research, as it was."],
      ["researcher", OTHER_ORG, "Their researcher."],
    ]);
    expect(Object.keys(subagents[0]!.spec.env)).toEqual(["RESEARCHER_KEY"]);
  });

  it("reads the head when the pin is its hash, in the run's organization when the reference names none", async () => {
    const [only, ...rest] = await runSubagents(store, listing({ slug: "researcher", version: HEAD }), ORG);
    expect(rest).toEqual([]);
    expect([only?.org, only?.spec.instructions]).toEqual([ORG, "Research, as it is now."]);
  });

  it("refuses a listed agent that is gone, naming it", async () => {
    const error = await runSubagents(store, listing({ slug: "departed", version: HEAD }), ORG).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(subagentGoneMessage("departed", HEAD));
    expect((error as ConnectError).rawMessage).toBe(
      `this conversation's agent lists subagent 'departed' at version ${HEAD.slice(0, 12)}, which no longer exists; save the agent again to list a version it has, or remove 'departed' from its subagents`,
    );
  });

  it("refuses a pinned version the agent no longer has, naming it", async () => {
    const gone = "c".repeat(64);
    const error = await runSubagents(store, listing({ slug: "researcher", version: gone }), ORG).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(subagentGoneMessage("researcher", gone));
  });

  it("reads nothing for no agent, an agent listing none, or a reference with no slug", async () => {
    expect(await runSubagents(store, undefined, ORG)).toEqual([]);
    expect(await runSubagents(store, create(AgentSpecSchema), ORG)).toEqual([]);
    expect(await runSubagents(store, listing({ slug: "", version: HEAD }), ORG)).toEqual([]);
  });

  it("answers a store fault INTERNAL, never a gone subagent", async () => {
    const failing = {
      listResources: () => Promise.reject(new Error("disk gone")),
    } as unknown as Store;
    const error = await runSubagents(failing, listing({ slug: "researcher", version: HEAD }), ORG).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});
