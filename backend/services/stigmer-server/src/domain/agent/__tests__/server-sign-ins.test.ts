/**
 * Pins RecordAgentServerSignIns (server-sign-ins.ts), an agent's save's one
 * question to its own MCP servers. A new server that says nothing about
 * authentication is asked, and its answer recorded with the address it was
 * asked at: a sign-in for an OAuth challenge, none for any other answer. A
 * server saved again unchanged carries its stored answer and is not asked.
 * A server whose address changed is asked again, and so is one with no
 * answer recorded at its address. A server that did not answer is left out
 * (asked again at the next save), and the save never fails on it. A server
 * that speaks about authentication itself is never asked. Answers a client
 * sends in the status are never kept: the step writes the list whole.
 *
 * The fetch is a fake counting each call, so no test touches the network.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentServerSignInSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { McpServerSignInSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { OutboundFetch } from "@stigmer/outbound/egress";

import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { newRecordAgentServerSignInsStep } from "../server-sign-ins.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

interface ServerInit {
  readonly name: string;
  readonly url: string;
  readonly headers?: Record<string, string>;
}

const OAUTH = (): Promise<Response> =>
  Promise.resolve(
    new Response(null, {
      status: 401,
      headers: { "www-authenticate": 'Bearer resource_metadata="https://tools.acme.test/.well-known/oauth-protected-resource"' },
    }),
  );
const OPEN = (): Promise<Response> => Promise.resolve(new Response("{}", { status: 200 }));
const DOWN = (): Promise<Response> => Promise.reject(new TypeError("fetch failed"));

/** A fetch answering each URL with its own answer, counting the calls to each. */
function fakeFetch(answers: Record<string, () => Promise<Response>>): { readonly fetch: OutboundFetch; readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: (url) => {
      calls.push(String(url));
      const answer = answers[String(url)];
      return answer === undefined ? DOWN() : answer();
    },
  };
}

function agentWith(servers: readonly ServerInit[], answers: readonly { name: string; url: string; signIn: boolean }[] = []): Agent {
  return create(AgentSchema, {
    metadata: { name: "Helper", org: "acme" },
    spec: {
      instructions: "help",
      mcpServers: servers.map((server) => ({ name: server.name, url: server.url, headers: server.headers ?? {} })),
    },
    status: {
      serverSignIns: answers.map((answer) =>
        create(AgentServerSignInSchema, {
          name: answer.name,
          url: answer.url,
          ...(answer.signIn ? { signIn: create(McpServerSignInSchema, { oauthOnly: true }) } : {}),
        }),
      ),
    },
  });
}

async function save(
  requested: Agent,
  stored: Agent | undefined,
  answers: Record<string, () => Promise<Response>>,
): Promise<{ readonly recorded: { name: string; url: string; signIn: boolean }[]; readonly calls: string[] }> {
  const fake = fakeFetch(answers);
  const ctx = new RequestContext(AgentSchema, requested, testCallerIdentity(), ApiResourceKind.agent);
  if (stored !== undefined) ctx.set(EXISTING_RESOURCE_KEY, stored);
  await newRecordAgentServerSignInsStep({ outboundFetch: fake.fetch, logger: silentLogger }).execute(ctx);
  return {
    recorded: (ctx.newState.status?.serverSignIns ?? []).map((answer) => ({
      name: answer.name,
      url: answer.url,
      signIn: answer.signIn?.oauthOnly === true,
    })),
    calls: fake.calls,
  };
}

const TOOLS = { name: "app-tools", url: "https://tools.acme.test/mcp" };
const DOCS = { name: "docs", url: "https://docs.acme.test/mcp" };

describe("RecordAgentServerSignIns", () => {
  it("asks a new server and records a sign-in for an OAuth challenge, none for any other answer", async () => {
    const { recorded, calls } = await save(agentWith([TOOLS, DOCS]), undefined, { [TOOLS.url]: OAUTH, [DOCS.url]: OPEN });
    expect(calls.sort()).toEqual([DOCS.url, TOOLS.url]);
    expect(recorded).toEqual([
      { ...TOOLS, signIn: true },
      { ...DOCS, signIn: false },
    ]);
  });

  it("carries the stored answer of a server saved again unchanged, asking nothing", async () => {
    const stored = agentWith([TOOLS], [{ ...TOOLS, signIn: true }]);
    const { recorded, calls } = await save(agentWith([TOOLS]), stored, { [TOOLS.url]: OPEN });
    expect(calls).toEqual([]);
    expect(recorded).toEqual([{ ...TOOLS, signIn: true }]);
  });

  it("asks again when the server's address changed", async () => {
    const moved = { name: TOOLS.name, url: "https://tools2.acme.test/mcp" };
    const stored = agentWith([TOOLS], [{ ...TOOLS, signIn: true }]);
    const { recorded, calls } = await save(agentWith([moved]), stored, { [moved.url]: OPEN });
    expect(calls).toEqual([moved.url]);
    expect(recorded).toEqual([{ ...moved, signIn: false }]);
  });

  it("asks an unchanged server that has no answer recorded at its address", async () => {
    const stored = agentWith([TOOLS], [{ name: TOOLS.name, url: "https://old.acme.test/mcp", signIn: true }]);
    const { recorded, calls } = await save(agentWith([TOOLS]), stored, { [TOOLS.url]: OAUTH });
    expect(calls).toEqual([TOOLS.url]);
    expect(recorded).toEqual([{ ...TOOLS, signIn: true }]);
  });

  it("leaves out a server that did not answer, and the save goes on", async () => {
    const { recorded, calls } = await save(agentWith([TOOLS, DOCS]), undefined, { [DOCS.url]: OPEN });
    expect(calls.sort()).toEqual([DOCS.url, TOOLS.url]);
    expect(recorded).toEqual([{ ...DOCS, signIn: false }]);
  });

  it("never asks a server that speaks about authentication itself", async () => {
    const keyed = { ...TOOLS, headers: { "X-Api-Key": "${TOOLS_KEY}" } };
    const bearer = { ...DOCS, headers: { authorization: "Bearer abc" } };
    const { recorded, calls } = await save(agentWith([keyed, bearer]), undefined, { [TOOLS.url]: OAUTH, [DOCS.url]: OAUTH });
    expect(calls).toEqual([]);
    expect(recorded).toEqual([]);
  });

  it("drops answers a client sent in the status for a server it never asked", async () => {
    const requested = agentWith([TOOLS], [{ ...TOOLS, signIn: true }]);
    const { recorded, calls } = await save(requested, undefined, { [TOOLS.url]: OPEN });
    expect(calls).toEqual([TOOLS.url]);
    expect(recorded).toEqual([{ ...TOOLS, signIn: false }]);
  });

  it("records nothing for an agent with no servers", async () => {
    const { recorded, calls } = await save(agentWith([]), agentWith([TOOLS], [{ ...TOOLS, signIn: true }]), {});
    expect(calls).toEqual([]);
    expect(recorded).toEqual([]);
  });
});
