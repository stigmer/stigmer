/**
 * Pins the subagents a run's agent lists (run-subagents.ts), over a real
 * SQLite store holding an agent's head and an archived version:
 *   - each reference is read by the id it holds at the version its parent
 *     pinned: the head when the pin is the head's hash, an archived version
 *     by its hash; each carries its name in the turn (the agent's current
 *     slug) and its organization, the run's when the reference names none;
 *   - two listed agents that answer to one name now (a rename in another
 *     organization brought them together) refuse the run
 *     FAILED_PRECONDITION naming the name;
 *   - a listed agent that is gone, and a pinned version it no longer has,
 *     refuse the create FAILED_PRECONDITION naming it; a listed agent
 *     deleted and remade under its name is gone, never the new agent;
 *   - no agent, an agent listing none, and a reference naming nothing read
 *     nothing;
 *   - a store fault, reading the agent or its pinned version, is
 *     INTERNAL, never mistaken for a gone subagent or version.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { runSubagents, subagentGoneMessage, subagentNamesClashMessage } from "../run-subagents.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";

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
  store = namingSaves(SqliteStore.open(path.join(dir, "stigmer.db")));
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
    agentRow("agt_theirs", OTHER_ORG, "their-researcher", "Their researcher.", HEAD),
  );
  await store.saveResource(
    ApiResourceKind.agent,
    "agt_theirs_renamed",
    AgentSchema,
    agentRow("agt_theirs_renamed", OTHER_ORG, "researcher", "Renamed onto ours.", HEAD),
  );
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** An agent spec listing subagents as a stored row holds them: by id. */
function listing(...refs: Array<{ id: string; version: string; org?: string }>): AgentSpec {
  return create(AgentSpecSchema, {
    subagents: refs.map((ref) => ({ kind: ApiResourceKind.agent, org: ref.org ?? "", id: ref.id, version: ref.version })),
  });
}

describe("runSubagents", () => {
  it("reads each subagent at its pinned version, by its id, in its organization, named by its slug", async () => {
    const subagents = await runSubagents(
      store,
      listing({ id: "agt_researcher", version: OLDER, org: ORG }, { id: "agt_theirs", version: HEAD, org: OTHER_ORG }),
      ORG,
    );
    expect(subagents.map((s) => [s.name, s.org, s.spec.instructions])).toEqual([
      ["researcher", ORG, "Research, as it was."],
      ["their-researcher", OTHER_ORG, "Their researcher."],
    ]);
    expect(Object.keys(subagents[0]!.spec.env)).toEqual(["RESEARCHER_KEY"]);
  });

  it("refuses two listed agents that answer to one name now, naming it", async () => {
    const error = await runSubagents(
      store,
      listing({ id: "agt_researcher", version: HEAD, org: ORG }, { id: "agt_theirs_renamed", version: HEAD, org: OTHER_ORG }),
      ORG,
    ).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(subagentNamesClashMessage("researcher"));
  });

  it("reads the head when the pin is its hash, in the run's organization when the reference names none", async () => {
    const [only, ...rest] = await runSubagents(store, listing({ id: "agt_researcher", version: HEAD }), ORG);
    expect(rest).toEqual([]);
    expect([only?.org, only?.spec.instructions]).toEqual([ORG, "Research, as it is now."]);
  });

  it("refuses a listed agent that is gone, naming the id its reference holds", async () => {
    const error = await runSubagents(store, listing({ id: "agt_departed", version: HEAD }), ORG).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(subagentGoneMessage("agt_departed", HEAD));
    expect((error as ConnectError).rawMessage).toBe(
      `this conversation's agent lists subagent 'agt_departed' at version ${HEAD.slice(0, 12)}, which no longer exists; save the agent again to list a version it has, or remove 'agt_departed' from its subagents`,
    );
  });

  it("delete and remake: a listed agent deleted since is gone, though another agent now holds its name", async () => {
    // agt_researcher holds "researcher"; the listing names the agent that
    // held it before, in the same organization.
    const error = await runSubagents(store, listing({ id: "agt_researcher_before", version: HEAD, org: ORG }), ORG).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(subagentGoneMessage("agt_researcher_before", HEAD));
  });

  it("refuses a pinned version the agent no longer has, naming it", async () => {
    const gone = "c".repeat(64);
    const error = await runSubagents(store, listing({ id: "agt_researcher", version: gone }), ORG).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(subagentGoneMessage("researcher", gone));
  });

  it("reads nothing for no agent, an agent listing none, or a reference naming nothing", async () => {
    expect(await runSubagents(store, undefined, ORG)).toEqual([]);
    expect(await runSubagents(store, create(AgentSpecSchema), ORG)).toEqual([]);
    expect(await runSubagents(store, listing({ id: "", version: HEAD }), ORG)).toEqual([]);
  });

  it("answers a store fault INTERNAL, never a gone subagent", async () => {
    const failing = {
      getResource: () => Promise.reject(new Error("disk gone")),
    } as unknown as Store;
    const error = await runSubagents(failing, listing({ id: "agt_researcher", version: HEAD }), ORG).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("answers a store fault reading the pinned version INTERNAL, never a gone version", async () => {
    const versionReadFails = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "getAuditRecordByHash") {
          return () => Promise.reject(new Error("disk gone"));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const error = await runSubagents(versionReadFails, listing({ id: "agt_researcher", version: OLDER }), ORG).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});
