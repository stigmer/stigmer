/**
 * Pins writtenServerNames (written-servers.ts): the servers an evaluated
 * agent version and each subagent it lists write themselves, the subagent
 * read at the version the agent pinned (not its head), each name once. A
 * subagent whose pinned version is gone adds nothing, and refuses nothing:
 * the try's own run is refused naming it. A store fault is thrown, never
 * taken for a subagent gone.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { namingSaves } from "../../../store/__tests__/named-saves.js";
import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { writtenServerNames } from "../written-servers.js";

const ORG = "acme";
const HEAD = "a".repeat(64);
const PINNED = "b".repeat(64);

let dir: string;
let store: Store;

function serversOf(...names: string[]): Array<{ name: string; url: string }> {
  return names.map((name) => ({ name, url: `https://${name}.example.com/mcp` }));
}

function triage(versionHash: string, servers: string[]) {
  return create(AgentSchema, {
    metadata: { id: "agt_triage", org: ORG, slug: "triage", name: "triage" },
    spec: { instructions: "Triage the ticket.", mcpServers: serversOf(...servers) },
    status: { versionHash },
  });
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "written-servers-test-"));
  store = namingSaves(SqliteStore.open(path.join(dir, "stigmer.db")));
  await store.saveResource(ApiResourceKind.agent, "agt_triage", AgentSchema, triage(HEAD, ["crm", "added-since"]));
  await store.saveAudit(ApiResourceKind.agent, "agt_triage", AgentSchema, triage(PINNED, ["crm", "zendesk"]), PINNED, "");
});

afterAll(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

function parent(subagentVersion: string): AgentSpec {
  return create(AgentSpecSchema, {
    instructions: "Help the customer.",
    mcpServers: serversOf("zendesk"),
    subagents: [{ kind: ApiResourceKind.agent, org: ORG, id: "agt_triage", version: subagentVersion }],
  });
}

describe("writtenServerNames", () => {
  it("names the version's own servers, then each subagent's at its pinned version, each once", async () => {
    expect(await writtenServerNames(store, parent(PINNED), ORG)).toEqual(["zendesk", "crm"]);
  });

  it("adds nothing for a subagent whose pinned version is gone", async () => {
    expect(await writtenServerNames(store, parent("c".repeat(64)), ORG)).toEqual(["zendesk"]);
  });

  it("throws a store fault rather than reading it as a subagent gone", async () => {
    const faulty = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "getResource" || property === "getResourceByName") {
          return () => Promise.reject(new Error("disk unavailable"));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(writtenServerNames(faulty, parent(PINNED), ORG)).rejects.toThrow();
  });

  it("names nothing for no agent", async () => {
    expect(await writtenServerNames(store, undefined, ORG)).toEqual([]);
  });
});
