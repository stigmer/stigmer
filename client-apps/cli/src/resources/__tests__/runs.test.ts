// Unit tests for the run helpers behind `get run`, `list runs` and the `runs`
// group: the run-ID check, the single-run read, the cursor-paged list read
// with the organization it scopes to, the list table (friendly phase label, a
// dash for an unset field), and the human phase labels. Reads run against a
// client double that records what it was asked.

import { create, isMessage, type Message } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { AgentRunListSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { ListAgentRunsRequest } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";
import {
  formatAgentPhase,
  getRun,
  isAgentRunId,
  isRunAlias,
  isTerminalAgentPhase,
  listAgentRuns,
  renderRunList,
} from "../runs.js";

describe("isAgentRunId", () => {
  it.each([
    ["aex_01ARZ3NDEKTSV4RRFFQ69G5FAV", true],
    ["aex-01ARZ3NDEKTSV4RRFFQ69G5FAV", true],
    ["aex_", true],
    ["AEX_run", false], // case-sensitive
    ["agt_abc", false], // different kind
  ])("%j -> %s", (ref, expected) => {
    expect(isAgentRunId(ref)).toBe(expected);
  });
});

describe("isRunAlias", () => {
  it.each([
    ["run", true],
    ["runs", true],
    ["  Runs  ", true],
    ["execution", false],
    ["executions", false],
    ["exec", false],
    ["agent", false],
    ["session", false],
  ])("%j -> %s", (type, expected) => {
    expect(isRunAlias(type)).toBe(expected);
  });
});

describe("renderRunList", () => {
  const list = create(AgentRunListSchema, {
    totalPages: 1,
    entries: [
      create(AgentRunSchema, {
        metadata: { id: "aex_1" },
        status: {
          agentId: "agt_1",
          phase: RunPhase.RUN_IN_PROGRESS,
          startedAt: "2026-03-01T10:00:00Z",
        },
      }),
      // Nothing recorded yet: every unset column is a dash.
      create(AgentRunSchema, { metadata: { id: "aex_2" } }),
    ],
  });
  const result = { schema: AgentRunListSchema, message: list };

  it("renders the full list envelope as protojson for json", () => {
    const json = JSON.parse(renderRunList(result, "json"));
    expect(json.total_pages).toBe(1);
    expect(json.entries[0].metadata.id).toBe("aex_1");
  });

  it("renders a table with a friendly phase label", () => {
    const table = renderRunList(result, "table");
    expect(table).toContain("AGENT");
    // The agent column is the agent the turn ran, as the server recorded it.
    expect(table).toMatch(/aex_1\s+agt_1\s+in-progress\s+2026-03-01T10:00:00Z/);
  });

  it("renders a dash for an unset agent, phase and start", () => {
    expect(renderRunList(result, "table")).toMatch(/aex_2\s+-\s+-\s+-/);
  });
});

/** Two list pages, recording each request. */
function listingClient(): {
  client: Stigmer;
  agentRequests: ListAgentRunsRequest[];
} {
  const agentRequests: ListAgentRunsRequest[] = [];
  const page = <T>(entries: T[], token: string) => ({ entries, nextPageToken: token });
  const client = {
    agentRun: {
      list: async (req: ListAgentRunsRequest) => {
        agentRequests.push(req);
        return req.pageToken === ""
          ? page([create(AgentRunSchema, { metadata: { id: "aex_1" } })], "p2")
          : page([create(AgentRunSchema, { metadata: { id: "aex_2" } })], "");
      },
      get: async (id: string) => create(AgentRunSchema, { metadata: { id } }),
    },
  } as unknown as Stigmer;
  return { client, agentRequests };
}

/** The run ids a run read or list result holds, in order. */
function runIds(message: Message): string[] {
  if (isMessage(message, AgentRunListSchema)) return message.entries.map((e) => e.metadata?.id ?? "");
  if (isMessage(message, AgentRunSchema)) return [message.metadata?.id ?? ""];
  throw new Error(`not a run message: ${message.$typeName}`);
}

describe("getRun", () => {
  it("reads a run through the agent-run controller, with its schema", async () => {
    const { client } = listingClient();
    const result = await getRun(client, "aex_9");
    expect(result.schema).toBe(AgentRunSchema);
    expect(runIds(result.message)).toEqual(["aex_9"]);
  });
});

describe("listAgentRuns", () => {
  it("reads agent run pages until the limit, scoped to the organization", async () => {
    const { client, agentRequests } = listingClient();
    const result = await listAgentRuns(client, 2, "acme");
    expect(result.schema).toBe(AgentRunListSchema);
    expect(runIds(result.message)).toEqual(["aex_1", "aex_2"]);
    expect(agentRequests.map((r) => [r.pageSize, r.pageToken, r.org])).toEqual([
      [2, "", "acme"],
      [1, "p2", "acme"],
    ]);
  });

  it("stops at the limit and names no organization by default", async () => {
    const { client, agentRequests } = listingClient();
    const result = await listAgentRuns(client, 1);
    expect(runIds(result.message)).toEqual(["aex_1"]);
    expect(agentRequests.map((r) => r.org)).toEqual([""]);
  });
});

describe("formatAgentPhase", () => {
  it.each([
    [RunPhase.RUN_PENDING, "pending"],
    [RunPhase.RUN_IN_PROGRESS, "running"],
    [RunPhase.RUN_WAITING_FOR_APPROVAL, "awaiting-approval"],
    [RunPhase.RUN_PAUSED, "paused"],
    [RunPhase.RUN_COMPLETED, "completed"],
    [RunPhase.RUN_FAILED, "failed"],
    [RunPhase.RUN_CANCELLED, "cancelled"],
    [RunPhase.RUN_TERMINATED, "terminated"],
    [RunPhase.RUN_PHASE_UNSPECIFIED, "unknown"],
  ])("%s -> %s", (phase, expected) => {
    expect(formatAgentPhase(phase)).toBe(expected);
  });
});

describe("isTerminalAgentPhase", () => {
  it.each([
    [RunPhase.RUN_COMPLETED, true],
    [RunPhase.RUN_FAILED, true],
    [RunPhase.RUN_CANCELLED, true],
    [RunPhase.RUN_TERMINATED, true],
    [RunPhase.RUN_IN_PROGRESS, false],
    [RunPhase.RUN_PAUSED, false],
    [RunPhase.RUN_WAITING_FOR_APPROVAL, false],
  ])("%s -> %s", (phase, expected) => {
    expect(isTerminalAgentPhase(phase)).toBe(expected);
  });
});
