// Unit arms for the run-values support seams.
// - runSourcesOf: the run's stored source manifest, empty for a run that
//   records none.
// - sourcesFor / agentSourceOf: the entries for one key, narrowed to one
//   declarer kind; an agent's key named twice is red at the helper.
// - runCredentialOf: the exchange's minted credential for the run; an
//   exchange that mints none is red, naming the run.
// - fetchRunValues: the fetch for the run, asked as the given runner.
// Pure: hand-built resources and stubbed clients, no target.
// Domain: conformance support (execution engine).
import { create } from "@bufbuild/protobuf";
import { RunSchema, RunValueSourceSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ExecutionValuesSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import {
  RunValueDeclarerKind,
  RunValueOrigin,
  agentSourceOf,
  fetchRunValues,
  runCredentialOf,
  runSourcesOf,
  sourcesFor,
} from "../run-values";

function source(key: string, kind: RunValueDeclarerKind, origin = RunValueOrigin.VAULT) {
  return create(RunValueSourceSchema, { key, declarer: { kind, name: "x" }, origin });
}

const AGENT_KEY = source("API_KEY", RunValueDeclarerKind.AGENT);
const TOOL_KEY = source("API_KEY", RunValueDeclarerKind.TOOL);
const OTHER = source("OTHER", RunValueDeclarerKind.AGENT, RunValueOrigin.MY_VAULT);

function clientsWith(parts: Partial<Record<keyof ConformanceClients, unknown>>): ConformanceClients {
  return parts as unknown as ConformanceClients;
}

describe("runSourcesOf", () => {
  it("reads the run's stored manifest, and none for a run that records none", async () => {
    const get = vi.fn(async ({ value }: { value: string }) =>
      value === "run_with"
        ? create(RunSchema, { status: { credentials: { sources: [AGENT_KEY, OTHER] } } })
        : create(RunSchema, {}),
    );
    const clients = clientsWith({ agentExecutionQuery: { get } });
    expect(await runSourcesOf(clients, "run_with")).toEqual([AGENT_KEY, OTHER]);
    expect(await runSourcesOf(clients, "run_without")).toEqual([]);
  });
});

describe("sourcesFor and agentSourceOf", () => {
  it("narrows a key's entries to one declarer kind", () => {
    const sources = [AGENT_KEY, TOOL_KEY, OTHER];
    expect(sourcesFor(sources, "API_KEY")).toEqual([AGENT_KEY, TOOL_KEY]);
    expect(sourcesFor(sources, "API_KEY", RunValueDeclarerKind.TOOL)).toEqual([TOOL_KEY]);
    expect(agentSourceOf(sources, "API_KEY")).toBe(AGENT_KEY);
    expect(agentSourceOf(sources, "MISSING")).toBeUndefined();
  });

  it("is red when the agent's key is named twice", () => {
    expect(() => agentSourceOf([AGENT_KEY, AGENT_KEY], "API_KEY")).toThrow(/names API_KEY for the agent 2 times/);
  });
});

describe("runCredentialOf", () => {
  it("returns the credential the exchange minted for the run", async () => {
    const getRunnerScopedToken = vi.fn(async () => ({ runnerScopedToken: "tok" }));
    expect(await runCredentialOf(clientsWith({ platformQuery: { getRunnerScopedToken } }), "run_1")).toBe("tok");
    expect(getRunnerScopedToken).toHaveBeenCalledWith({ scope: { case: "runId", value: "run_1" } });
  });

  it("is red, naming the run, when the exchange mints none", async () => {
    const getRunnerScopedToken = vi.fn(async () => ({ runnerScopedToken: "" }));
    await expect(runCredentialOf(clientsWith({ platformQuery: { getRunnerScopedToken } }), "run_1")).rejects.toThrow(
      /minted no credential for run run_1/,
    );
  });
});

describe("fetchRunValues", () => {
  it("asks the fetch for the run as the given runner", async () => {
    const answer = create(ExecutionValuesSchema, { agent: { API_KEY: "v" } });
    const fetchValues = vi.fn(async () => answer);
    expect(await fetchRunValues(clientsWith({ vaultValue: { fetchValues } }), "run_1")).toBe(answer);
    expect(fetchValues).toHaveBeenCalledWith({ executionId: "run_1" });
  });
});
