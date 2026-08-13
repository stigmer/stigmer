/**
 * Unit tests for the GenerateSessionSubject activity core.
 *
 * The LLM seam (model registry + chat model) is module-mocked; the backend
 * client is injected through SessionSubjectClient, so every skip branch,
 * the agent-resolution chain, and both fallback classes are pinned without
 * Temporal or network coupling. Behavioral contract mirrors the cloud
 * GenerateSessionSubjectActivityImpl (see the activity header).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";

vi.mock("../../shared/model-registry.js", () => ({
  getSummarizationModel: vi.fn(async (primary: string) => primary),
}));
vi.mock("../../shared/model-client.js", () => ({
  buildChatModel: vi.fn(),
}));
vi.mock("../../shared/llm-backend.js", () => ({
  checkDirectCredentials: vi.fn(() => null),
}));
vi.mock("../../shared/llm-proxy.js", () => ({
  tryInferProvider: vi.fn(() => "anthropic"),
}));

import {
  AUTO_CREATED_SUBJECT,
  generateSessionSubject,
  resolveAgentId,
  heuristicSubject,
  cleanSubject,
  buildUserPrompt,
  type SessionSubjectClient,
  type GenerateSessionSubjectOptions,
} from "../generate-session-subject.js";
import { buildChatModel } from "../../shared/model-client.js";
import { checkDirectCredentials } from "../../shared/llm-backend.js";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const EXECUTION_ID = "aex_test123";
const SESSION_ID = "ses_test456";
const AGENT_ID = "agt_test789";
const INSTANCE_ID = "ain_test012";

function fakeExecution(overrides: Record<string, unknown> = {}): AgentExecution {
  return {
    spec: {
      sessionId: SESSION_ID,
      agentId: AGENT_ID,
      message: "Explain how database indexing works for PostgreSQL",
      ...overrides,
    },
  } as unknown as AgentExecution;
}

function fakeSession(subject: string = AUTO_CREATED_SUBJECT, agentInstanceId = ""): Session {
  return {
    spec: { subject, agentInstanceId },
  } as unknown as Session;
}

function fakeAgent(): Agent {
  return {
    metadata: { name: "test-agent" },
    spec: { description: "A helpful test assistant" },
  } as unknown as Agent;
}

function fakeInstance(agentId: string): AgentInstance {
  return { spec: { agentId } } as unknown as AgentInstance;
}

function notFound(): ConnectError {
  return new ConnectError("not found", Code.NotFound);
}

interface ClientBehavior {
  execution?: AgentExecution | Error;
  session?: Session | Error;
  agent?: Agent | Error;
  instance?: AgentInstance | Error;
  updateError?: Error;
}

function fakeClient(behavior: ClientBehavior = {}) {
  const updated: Array<{ sessionId: string; subject: string }> = [];
  const resolve = <T>(value: T | Error | undefined, fallback: T): Promise<T> => {
    if (value instanceof Error) return Promise.reject(value);
    return Promise.resolve(value ?? fallback);
  };
  const client: SessionSubjectClient = {
    getExecution: vi.fn(() => resolve(behavior.execution, fakeExecution())),
    getSession: vi.fn(() => resolve(behavior.session, fakeSession())),
    getAgent: vi.fn(() => resolve(behavior.agent, fakeAgent())),
    getAgentInstance: vi.fn(() => resolve(behavior.instance, fakeInstance(AGENT_ID))),
    updateSessionSubject: vi.fn((sessionId: string, subject: string) => {
      if (behavior.updateError) return Promise.reject(behavior.updateError);
      updated.push({ sessionId, subject });
      return Promise.resolve(fakeSession(subject));
    }),
  };
  return { client, updated };
}

const OPTIONS: GenerateSessionSubjectOptions = {
  proxyEndpoint: null,
  stigmerToken: null,
  primaryModel: "claude-sonnet-4.5",
};

function mockLlmReturning(content: unknown): void {
  vi.mocked(buildChatModel).mockResolvedValue({
    model: { invoke: vi.fn(async () => ({ content })) },
  } as never);
}

beforeEach(() => {
  vi.mocked(buildChatModel).mockReset();
  vi.mocked(checkDirectCredentials).mockReturnValue(null);
  mockLlmReturning("PostgreSQL B-tree Indexing");
});

// ─────────────────────────────────────────────────────────────────────────────
// Happy path + persistence
// ─────────────────────────────────────────────────────────────────────────────

describe("generateSessionSubject", () => {
  it("replaces the sentinel subject with the LLM title", async () => {
    const { client, updated } = fakeClient();
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(updated).toEqual([{ sessionId: SESSION_ID, subject: "PostgreSQL B-tree Indexing" }]);
  });

  it("titles a session whose subject is empty (not just the sentinel)", async () => {
    const { client, updated } = fakeClient({ session: fakeSession("") });
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(updated).toHaveLength(1);
  });

  it("passes executionId into the proxy header scope for billing attribution", async () => {
    const { client } = fakeClient();
    await generateSessionSubject(EXECUTION_ID, client, {
      ...OPTIONS,
      proxyEndpoint: "https://proxy.example",
      stigmerToken: "tok",
    });
    expect(vi.mocked(buildChatModel)).toHaveBeenCalledWith(
      expect.objectContaining({ headerScope: { executionId: EXECUTION_ID } }),
    );
  });

  it("swallows a persistence failure (non-critical contract)", async () => {
    const { client } = fakeClient({ updateError: new Error("write refused") });
    await expect(generateSessionSubject(EXECUTION_ID, client, OPTIONS)).resolves.toBeUndefined();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Skip branches (cloud-parity semantics)
  // ───────────────────────────────────────────────────────────────────────────

  it("skips when the subject was already set by a human", async () => {
    const { client, updated } = fakeClient({ session: fakeSession("My renamed chat") });
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(updated).toHaveLength(0);
    expect(vi.mocked(buildChatModel)).not.toHaveBeenCalled();
  });

  it("skips when the execution has no session id", async () => {
    const { client, updated } = fakeClient({ execution: fakeExecution({ sessionId: "" }) });
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(updated).toHaveLength(0);
  });

  it("skips when the execution has no user message", async () => {
    const { client, updated } = fakeClient({ execution: fakeExecution({ message: "" }) });
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(updated).toHaveLength(0);
  });

  it.each([
    ["execution", { execution: notFound() }],
    ["session", { session: notFound() }],
    ["agent", { agent: notFound() }],
  ] as const)("skips (does not throw) when the %s is NOT_FOUND", async (_what, behavior) => {
    const { client, updated } = fakeClient(behavior);
    await expect(generateSessionSubject(EXECUTION_ID, client, OPTIONS)).resolves.toBeUndefined();
    expect(updated).toHaveLength(0);
  });

  it("propagates non-NOT_FOUND lookup failures as activity failures", async () => {
    const { client } = fakeClient({
      execution: new ConnectError("backend down", Code.Unavailable),
    });
    await expect(generateSessionSubject(EXECUTION_ID, client, OPTIONS)).rejects.toThrow(
      "backend down",
    );
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Fallbacks
  // ───────────────────────────────────────────────────────────────────────────

  it("falls back to the heuristic title when the LLM call throws", async () => {
    vi.mocked(buildChatModel).mockRejectedValue(new Error("provider 500"));
    const { client, updated } = fakeClient();
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(updated).toEqual([
      { sessionId: SESSION_ID, subject: "Explain how database indexing works for PostgreSQL" },
    ]);
  });

  it("falls back to the heuristic title when the LLM returns empty content", async () => {
    mockLlmReturning("");
    const { client, updated } = fakeClient();
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(updated[0]?.subject).toBe("Explain how database indexing works for PostgreSQL");
  });

  it("falls back to the heuristic in direct mode with no credential path", async () => {
    vi.mocked(checkDirectCredentials).mockReturnValue("ANTHROPIC_API_KEY is missing");
    const { client, updated } = fakeClient();
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(vi.mocked(buildChatModel)).not.toHaveBeenCalled();
    expect(updated[0]?.subject).toBe("Explain how database indexing works for PostgreSQL");
  });

  it("does NOT run the credential pre-check in proxy mode", async () => {
    vi.mocked(checkDirectCredentials).mockReturnValue("ANTHROPIC_API_KEY is missing");
    const { client, updated } = fakeClient();
    await generateSessionSubject(EXECUTION_ID, client, {
      ...OPTIONS,
      proxyEndpoint: "https://proxy.example",
    });
    expect(updated[0]?.subject).toBe("PostgreSQL B-tree Indexing");
  });

  it("joins array-of-parts LLM content into a single title", async () => {
    mockLlmReturning([{ type: "text", text: "Postgres " }, { type: "text", text: "Index Tuning" }]);
    const { client, updated } = fakeClient();
    await generateSessionSubject(EXECUTION_ID, client, OPTIONS);
    expect(updated[0]?.subject).toBe("Postgres Index Tuning");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Agent resolution (direct + instance chain)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveAgentId", () => {
  it("prefers the execution's direct agent_id", async () => {
    const { client } = fakeClient();
    const id = await resolveAgentId(fakeExecution(), fakeSession(), client);
    expect(id).toBe(AGENT_ID);
    expect(client.getAgentInstance).not.toHaveBeenCalled();
  });

  it("resolves through the session's agent-instance chain", async () => {
    const { client } = fakeClient({ instance: fakeInstance("agt_from_instance") });
    const id = await resolveAgentId(
      fakeExecution({ agentId: "" }),
      fakeSession(AUTO_CREATED_SUBJECT, INSTANCE_ID),
      client,
    );
    expect(id).toBe("agt_from_instance");
    expect(client.getAgentInstance).toHaveBeenCalledWith(INSTANCE_ID);
  });

  it("returns empty when neither a direct id nor an instance exists", async () => {
    const { client } = fakeClient();
    const id = await resolveAgentId(fakeExecution({ agentId: "" }), fakeSession(), client);
    expect(id).toBe("");
  });

  it("returns empty when the instance row is NOT_FOUND", async () => {
    const { client } = fakeClient({ instance: notFound() });
    const id = await resolveAgentId(
      fakeExecution({ agentId: "" }),
      fakeSession(AUTO_CREATED_SUBJECT, INSTANCE_ID),
      client,
    );
    expect(id).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Title shaping helpers (lockstep with the cloud activity)
// ─────────────────────────────────────────────────────────────────────────────

describe("heuristicSubject", () => {
  it("takes at most the first 7 words", () => {
    expect(heuristicSubject("one two three four five six seven eight nine")).toBe(
      "one two three four five six seven",
    );
  });

  it("keeps short messages whole", () => {
    expect(heuristicSubject("  fix the build  ")).toBe("fix the build");
  });

  it("truncates to 50 chars with an ellipsis", () => {
    const long = "supercalifragilistic expialidocious antidisestablishmentarianism words";
    const subject = heuristicSubject(long);
    expect(subject.length).toBeLessThanOrEqual(50);
    expect(subject.endsWith("...")).toBe(true);
  });
});

describe("cleanSubject", () => {
  it("strips one layer of wrapping double quotes", () => {
    expect(cleanSubject('"Postgres Index Tuning"')).toBe("Postgres Index Tuning");
  });

  it("strips one layer of wrapping single quotes", () => {
    expect(cleanSubject("'Postgres Index Tuning'")).toBe("Postgres Index Tuning");
  });

  it("caps at 50 chars with an ellipsis", () => {
    const cleaned = cleanSubject("x".repeat(80));
    expect(cleaned.length).toBe(50);
    expect(cleaned.endsWith("...")).toBe(true);
  });

  it("trims whitespace inside stripped quotes", () => {
    expect(cleanSubject('" Postgres "')).toBe("Postgres");
  });
});

describe("buildUserPrompt", () => {
  it("includes the message, agent name, and purpose", () => {
    const prompt = buildUserPrompt("fix my build", "builder", "builds things");
    expect(prompt).toContain('User\'s first message:\n"fix my build"');
    expect(prompt).toContain("Agent: builder");
    expect(prompt).toContain("Agent purpose: builds things");
    expect(prompt.endsWith("Generate the title:")).toBe(true);
  });

  it("omits the purpose line when the description is empty", () => {
    expect(buildUserPrompt("m", "a", "")).not.toContain("Agent purpose:");
  });
});
