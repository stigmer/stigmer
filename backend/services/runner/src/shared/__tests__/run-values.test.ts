/**
 * Pins how a turn receives its values (run-values.ts): the fetch's answer
 * kept per declarer, a repository's token matched by its entry's name and
 * URL together, a refusal the person fixes kept apart from every other
 * failure, and the turn's credential presented on the fetch with no
 * fallback to a read without one.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { ExecutionValuesSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/values_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { mockStigmerClient } from "../../__test-utils__/mock-client.js";
import {
  fetchRunValues,
  fetchTurnValues,
  repositoryTokenFor,
  RunValuesRefusedError,
  runValuesOf,
} from "../run-values.js";

const ANSWER = create(ExecutionValuesSchema, {
  agent: { AGENT_KEY: { value: "agent-secret", isSecret: true }, LOG_LEVEL: { value: "debug", isSecret: false } },
  tools: [{ mcpServerId: "mcp_linear", url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: { value: "lin", isSecret: true } } }],
  repositories: [{ name: "app", url: "https://github.com/acme/app.git", token: "ghp_app" }],
});

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("runValuesOf", () => {
  it("keeps each declarer's values in its own group", () => {
    const values = runValuesOf(ANSWER);
    expect(values.agent).toEqual({ AGENT_KEY: "agent-secret", LOG_LEVEL: "debug" });
    expect(values.tools.get("mcp_linear")).toEqual({ url: "https://mcp.linear.app/mcp", values: { LINEAR_TOKEN: "lin" } });
    expect(values.repositories).toEqual([{ name: "app", url: "https://github.com/acme/app.git", token: "ghp_app" }]);
  });
});

describe("repositoryTokenFor", () => {
  it("matches a repository by its name and URL together, never by one alone", () => {
    const repositories = runValuesOf(ANSWER).repositories;
    expect(repositoryTokenFor(repositories, "app", "https://github.com/acme/app.git")).toBe("ghp_app");
    expect(repositoryTokenFor(repositories, "app", "https://github.com/acme/other.git")).toBeUndefined();
    expect(repositoryTokenFor(repositories, "web", "https://github.com/acme/app.git")).toBeUndefined();
  });
});

describe("fetchRunValues", () => {
  it("presents the token it is given and answers the values per declarer", async () => {
    const client = mockStigmerClient({ fetchExecutionValues: vi.fn().mockResolvedValue(ANSWER) });

    const values = await fetchRunValues(client, "run_1", "scoped");

    expect(client.fetchExecutionValues).toHaveBeenCalledWith("run_1", "scoped");
    expect(values.tools.size).toBe(1);
  });

  it("keeps a refusal the person fixes apart, carrying the server's sentence", async () => {
    const client = mockStigmerClient({
      fetchExecutionValues: vi.fn().mockRejectedValue(
        new ConnectError("LINEAR_TOKEN for Linear is gone from vault 'Support': fix it and recover", Code.FailedPrecondition),
      ),
    });

    const failure = fetchRunValues(client, "run_1");
    await expect(failure).rejects.toBeInstanceOf(RunValuesRefusedError);
    await expect(failure).rejects.toThrow("LINEAR_TOKEN for Linear is gone from vault 'Support': fix it and recover");
  });

  it("propagates every other failure as it is: a refused credential is the platform's", async () => {
    const denied = new ConnectError("not bound to this execution", Code.PermissionDenied);
    const client = mockStigmerClient({ fetchExecutionValues: vi.fn().mockRejectedValue(denied) });

    await expect(fetchRunValues(client, "run_1")).rejects.toBe(denied);
  });
});

describe("fetchTurnValues", () => {
  it("presents the turn's own credential on the fetch", async () => {
    const client = mockStigmerClient({
      acquireScopedRunnerToken: vi.fn().mockResolvedValue("run-credential"),
      fetchExecutionValues: vi.fn().mockResolvedValue(ANSWER),
    });

    await fetchTurnValues(client, "run_1");

    expect(client.acquireScopedRunnerToken).toHaveBeenCalledWith({ agentExecutionId: "run_1" });
    expect(client.fetchExecutionValues).toHaveBeenCalledWith("run_1", "run-credential");
  });

  it("fetches nothing when no credential can be had: there is no read without one", async () => {
    const client = mockStigmerClient({
      acquireScopedRunnerToken: vi.fn().mockRejectedValue(new Error("Server minted no scoped runner token")),
    });

    await expect(fetchTurnValues(client, "run_1")).rejects.toThrow("Server minted no scoped runner token");
    expect(client.fetchExecutionValues).not.toHaveBeenCalled();
  });
});
