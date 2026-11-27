/**
 * RecordAgentServerSignIns: an agent's own MCP server signs in as a
 * plugin's does. A plugin's install asks each of the plugin's servers that
 * says nothing about authentication whether it wants a sign-in
 * (domain/plugin/probe-sign-in.ts); this step asks the same question of the
 * servers an agent writes itself, at its save, and keeps the answers on the
 * agent's status (`AgentStatus.server_sign_ins`). The server's and the
 * kit's agent-server adapters read them (domain/vault/agent-servers.ts), so
 * a server that asked for a sign-in is a required login at its address: a
 * run without one is refused with "sign in to …", and the chat offers Sign
 * in.
 *
 * Who is asked: an `http` server with no `Authorization` header and no
 * `${VAR}` in a header (`authorShapeUrl`). A server that is new, whose
 * address or headers changed (`mcpServerMutations`, the admin guard's own
 * rule), or that has no answer recorded at its current address is asked
 * once, through the shared probe (domain/mcp/sign-in-probe.ts: one
 * `initialize`, egress-guarded, 3 s), servers in parallel. Every other
 * server carries its stored answer and costs no call.
 *
 * What is kept: one entry per answered server, with the address it was
 * asked at; a sign-in when the answer was an OAuth challenge, none for any
 * other answer. A server that did not answer is left out, so the next save
 * asks it again; the save never fails on a probe. The step writes the list
 * whole, so answers a client sends in the status are never kept.
 *
 * Status, never spec: the version hash is the spec's, so an answer that
 * appears or changes moves no version.
 *
 * Pipeline position: after RecordAgentWarnings, before Persist, in create
 * and update; update chains carry the stored agent under
 * EXISTING_RESOURCE_KEY.
 *
 * Proven by __tests__/server-sign-ins.test.ts.
 */
import { create } from "@bufbuild/protobuf";

import type { Agent, AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentServerSignInSchema, AgentStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import type { AgentServerSignIn } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/status_pb";
import { McpServerSignInSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { askSignIn, authorShapeUrl } from "../mcp/sign-in-probe.js";
import type { SignInProbeDeps } from "../mcp/sign-in-probe.js";
import { agentServerEntry } from "../vault/agent-servers.js";
import { mcpServerMutations } from "./guard-mcp-servers.js";

export function newRecordAgentServerSignInsStep(deps: SignInProbeDeps): PipelineStep<typeof AgentSchema> {
  return {
    name: "RecordAgentServerSignIns",
    async execute(ctx: RequestContext<typeof AgentSchema>): Promise<void> {
      const agent = ctx.newState;
      const servers = agent.spec?.mcpServers ?? [];
      const existing = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      const stored = existing?.status?.serverSignIns ?? [];
      const changed = new Set(mcpServerMutations(existing?.spec?.mcpServers ?? [], servers));
      const answers = await Promise.all(
        servers.map(async (server): Promise<AgentServerSignIn | undefined> => {
          const url = authorShapeUrl(agentServerEntry(server));
          if (url === undefined) {
            return undefined;
          }
          const kept = stored.find((answer) => answer.name === server.name && answer.url === url);
          if (kept !== undefined && !changed.has(server.name)) {
            return kept;
          }
          const answer = await askSignIn(url, server.headers, deps);
          if (answer === "unreachable") {
            return undefined;
          }
          return create(AgentServerSignInSchema, {
            name: server.name,
            url,
            ...(answer === "oauth" ? { signIn: create(McpServerSignInSchema, { oauthOnly: true }) } : {}),
          });
        }),
      );
      agent.status ??= create(AgentStatusSchema);
      agent.status.serverSignIns = answers.filter((answer) => answer !== undefined);
    },
  };
}
