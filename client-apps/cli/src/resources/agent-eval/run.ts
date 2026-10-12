// `agent eval` dispatch: resolve the agent, start its eval, follow it to
// the end, and print or write the result.
//
// The start, the follow loop, Ctrl+C, the deadlines, the exit on a lost
// eval and the exit codes are the loop `plugin eval` runs
// (resources/plugin-eval/follow.ts, whose header holds those rules); this
// module is the agent's part in it: the agent read, the create, and the
// report and document.
//
// The agent is read first, by id or by reference in the organization, so
// the eval is created in the agent's own organization and the output names
// it by slug; reading it is part of the start, so its refusal exits 1, as
// create's does. The version is not read here: create resolves a tag,
// refuses a version that does not exist, and stamps the hash, which the
// tables show. The eval is sent with no name: the server names it by its
// id. `--json` writes the SDK's agent eval result document with the
// agent's slug, and `stillRunning: true` when the command could not cancel
// an eval it stopped following.

import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { toAgentEvalResultDocument, type AgentEvalResultDocument, type Stigmer } from "@stigmer/sdk";
import { requireOrganization } from "../../client/single-org.js";
import { asStartRefusal, runEval, type EvalIo } from "../plugin-eval/follow.js";
import type { EvalExit } from "../plugin-eval/report.js";
import { idPrefixesFor, parseReference } from "../reference.js";
import type { AgentEvalOptions, AgentTarget } from "./options.js";
import { agentEvalExitCode, agentFinishedTries, renderAgentEvalReport } from "./report.js";

/** The result document the command writes: the SDK's, and whether the eval may still run. */
interface CliAgentEvalDocument extends AgentEvalResultDocument {
  /**
   * Present, and true, only when the command stopped following the eval and
   * could not cancel it: the eval may still be running and spending.
   */
  readonly stillRunning?: true;
}

/** Runs `stigmer agent eval` and returns the code to exit with. */
export async function runAgentEval(
  client: Stigmer,
  org: string,
  target: AgentTarget,
  options: AgentEvalOptions,
  io: EvalIo,
): Promise<EvalExit> {
  const agent = await resolveAgent(client, target.ref, org).catch(asStartRefusal);
  const slug = agent.metadata?.slug || agent.metadata?.name || target.ref;
  return runEval<AgentEval>(
    {
      cancelCommand: "stigmer agent eval cancel",
      getCommand: "stigmer get agent-eval",
      cancelElsewhere: "cancel it from the agent's Evals tab in the console",
      on: target.version === "" ? slug : `${slug}@${target.version}`,
      create: () => startEval(client, agent, target, options),
      get: (id) => client.agenteval.get(id),
      cancel: (id) => client.agenteval.cancel(id),
      finishedTries: agentFinishedTries,
      report: (agentEval, interrupted, stillRunning) =>
        renderAgentEvalReport(agentEval, {
          agentSlug: slug,
          interrupted,
          durationSeconds: toAgentEvalResultDocument(agentEval, { interrupted, nowMs: io.now() }).durationSeconds,
          stillRunning,
        }),
      document: (agentEval, interrupted, stillRunning) => documentOf(agentEval, slug, interrupted, io.now(), stillRunning),
      exitCode: (agentEval, interrupted) => agentEvalExitCode(agentEval, { interrupted }),
    },
    options,
    io,
  );
}

/** Cancels an agent eval and says what happened. */
export async function cancelAgentEval(client: Stigmer, id: string, io: Pick<EvalIo, "stderr">): Promise<void> {
  const cancelled = await client.agenteval.cancel(id);
  const status = cancelled.status;
  io.stderr.write(
    `Cancelled ${id}: tries in flight stop; ${status?.triesFinished ?? 0} of ${status?.triesTotal ?? 0} tries had finished.\n`,
  );
}

async function resolveAgent(client: Stigmer, ref: string, org: string): Promise<Agent> {
  const parsed = parseReference(ref, org, idPrefixesFor(ApiResourceKind.agent));
  if (parsed.kind === "id") {
    return client.agent.get(parsed.id);
  }
  await requireOrganization(client, parsed.org, [
    "stigmer config context set --org <org>",
    "stigmer agent eval --org <org> ...",
  ]);
  return client.agent.getByReference({ org: parsed.org, slug: parsed.slug });
}

async function startEval(client: Stigmer, agent: Agent, target: AgentTarget, options: AgentEvalOptions): Promise<AgentEval> {
  try {
    return await client.agenteval.create({
      name: "",
      org: agent.metadata?.org ?? "",
      agentId: agent.metadata?.id ?? "",
      agentVersion: target.version,
      plugins: [...options.plugins],
      targets: [...options.targets],
      runs: options.runs,
      ...(options.threshold !== undefined && { threshold: options.threshold }),
      caseGlob: options.caseGlob,
      caseTags: [...options.caseTags],
      judgeModel: options.judgeModel,
      maxCostUsd: options.maxCostUsd,
      concurrency: options.concurrency,
      allowTools: [...options.allowTools],
      realMcpServers: options.realMcpServers,
      allowRealServers: options.allowRealServers,
      skipScaffold: options.skipScaffold,
    });
  } catch (error) {
    return asStartRefusal(error);
  }
}

function documentOf(
  agentEval: AgentEval,
  agentSlug: string,
  interrupted: boolean,
  nowMs: number,
  stillRunning: boolean,
): CliAgentEvalDocument {
  return {
    ...toAgentEvalResultDocument(agentEval, { agentSlug, interrupted, nowMs }),
    ...(stillRunning && { stillRunning: true as const }),
  };
}
