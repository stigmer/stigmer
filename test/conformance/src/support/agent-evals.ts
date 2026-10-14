// Agent-eval fixtures, the eval follower and the agent-eval lanes' contract
// copy for the conformance suites.
// Domain: conformance support.
//
// An AgentEval runs the eval cases of the plugins an agent attaches, on the
// agent itself: each plugin's `evals/` cases, written by the plugin-eval
// fixtures (support/plugin-evals.ts, reused here whole: the case layout, the
// graders, the install), at the version the agent attaches, every try a
// conversation on the agent pinned to the version the eval stamped. So an
// agent eval needs an agent that lists installed plugins: `createAgentWith`
// saves one, its delete deferred after the plugins' (the tracker runs in
// reverse, so the agent goes before the plugins it lists and every eval made
// after it goes before the agent).
//
// `makeAgentEval` defaults to the smallest eval: one try per case, one try
// at a time, within ten dollars, the agent as it runs (no targets, so a try
// names no model). A suite narrows it further where the target runs an
// engine (the CRUD suite's header says why).
//
// The follower polls an eval by id until a condition holds, failing loudly
// with what it last read once its budget is spent; `agentEvalTriesOf` walks
// the status in plugin, case and target order. The copy constants are
// cross-edition contract strings, byte-pinned in the server
// (domain/agent-eval/constants.ts) and asserted over the wire.
//
// Pinned by support/__tests__/agent-evals.test.ts: the eval's defaults, the
// agent fixture, the follower's polling and failure message, the tries walk,
// the copy, and the cleanup's order.
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type {
  AgentEval,
  AgentEvalSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginEvalTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { PluginEvalTry } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import { makeAgent, type AgentSpecOptions } from "./agents";
import type { InitShape } from "./init-shape";
import { isActivePhase, isFinishedPhase, PLUGIN_EVAL_API_VERSION } from "./plugin-evals";

export const AGENT_EVAL_KIND = "AgentEval";

// ─── Contract copy (byte-pinned in the server) ─────────────────────────────

export const AGENT_EVAL_CREATE_DENIED_MESSAGE = "unauthorized to run evals of agent";

export function agentEvalOrgMismatchMessage(agentOrg: string): string {
  return `metadata.org must be the agent's organization (${agentOrg})`;
}

export const AGENT_EVAL_NO_PLUGINS_MESSAGE =
  "this agent version attaches no plugin, and an agent's eval cases are its plugins': attach a plugin with eval cases, then run the eval";

export function agentEvalUnknownPluginMessage(slug: string): string {
  return `spec.plugins names '${slug}', which this agent version does not attach`;
}

export const AGENT_EVAL_NO_CASES_MESSAGE =
  "none of the plugins this eval runs has eval cases at the version the agent attaches";

export function agentEvalOtherPluginToolMessage(entry: string, server: string): string {
  return `allow_tools entry '${entry}' names MCP server '${server}', which is none of the agent's own servers or its plugins'`;
}

/** The not-run reason of an attached plugin spec.plugins leaves out. */
export const PLUGIN_NOT_SELECTED_REASON = "not selected";

/** The not-run reason of an attached plugin with no eval cases at the version the agent attaches. */
export const PLUGIN_NO_CASES_REASON = "no eval cases at this version";

export function agentEvalActiveDeleteMessage(evalId: string): string {
  return `agent eval ${evalId} is still running: cancel it first, then delete it`;
}

export function agentEvalActiveOnAgentDeleteMessage(evalId: string): string {
  return `this agent has a running eval (${evalId}): cancel it first, then delete the agent`;
}

// ─── The agent ─────────────────────────────────────────────────────────────

export interface AgentWithOptions extends Omit<AgentSpecOptions, "plugins"> {
  /** The agent's name; its slug derives from it. */
  readonly name: string;
  /** The visibility it is saved at; the kind's default (organization) otherwise. */
  readonly visibility?: ApiResourceVisibility;
}

/**
 * Saves an agent in `org` that lists `plugins`, in order, by slug (no
 * version, so a turn runs each one's installed version), and defers its
 * delete, which removes the evals made of it.
 */
export async function createAgentWith(
  clients: Pick<ConformanceClients, "agentCommand">,
  fixtures: FixtureTracker,
  org: string,
  plugins: readonly Plugin[],
  opts: AgentWithOptions,
): Promise<Agent> {
  const { visibility, name, ...spec } = opts;
  const input = makeAgent({
    org,
    name,
    ...spec,
    plugins: plugins.map((plugin) => plugin.metadata!.slug),
  });
  if (visibility !== undefined) {
    input.metadata = { ...input.metadata, visibility };
  }
  const agent = await clients.agentCommand.create(input);
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agent;
}

// ─── The eval ──────────────────────────────────────────────────────────────

export interface AgentEvalOptions {
  readonly org: string;
  readonly agentId: string;
  /** A version hash or a tag of the agent; empty evaluates its current version. */
  readonly agentVersion?: string;
  /** The slugs of the attached plugins whose cases run; empty runs every one's. */
  readonly plugins?: readonly string[];
  readonly targets?: ReadonlyArray<InitShape<typeof PluginEvalTargetSchema>>;
  readonly runs?: number;
  readonly caseGlob?: string;
  readonly maxCostUsd?: number;
  readonly concurrency?: number;
  readonly allowTools?: readonly string[];
  readonly name?: string;
}

/**
 * A complete, valid agent eval ready to hand to create: the agent's current
 * version, every attached plugin's cases, the agent as it runs (no targets),
 * one try per case, one at a time, ten dollars at most.
 */
export function makeAgentEval(opts: AgentEvalOptions): InitShape<typeof AgentEvalSchema> {
  return {
    apiVersion: PLUGIN_EVAL_API_VERSION,
    kind: AGENT_EVAL_KIND,
    metadata: {
      org: opts.org,
      ...(opts.name === undefined ? {} : { name: opts.name }),
    },
    spec: {
      agentId: opts.agentId,
      agentVersion: opts.agentVersion ?? "",
      plugins: [...(opts.plugins ?? [])],
      targets: [...(opts.targets ?? [])],
      runs: opts.runs ?? 1,
      caseGlob: opts.caseGlob ?? "",
      maxCostUsd: opts.maxCostUsd ?? 10,
      concurrency: opts.concurrency ?? 1,
      allowTools: [...(opts.allowTools ?? [])],
    },
  };
}

function describeEval(agentEval: AgentEval): string {
  const status = agentEval.status;
  return (
    `phase ${PluginEvalPhase[status?.phase ?? 0]}, tries ${status?.triesFinished ?? 0}/${status?.triesTotal ?? 0}` +
    (status?.error ? `, error "${status.error}"` : "")
  );
}

/**
 * The follower: polls agent eval `id` until `until` holds and answers it,
 * or fails once `timeoutMs` pass, naming what it waited for and what it
 * last read.
 */
export async function followAgentEval(
  clients: Pick<ConformanceClients, "agentEvalQuery">,
  id: string,
  until: (agentEval: AgentEval) => boolean,
  what: string,
  timeoutMs = 120_000,
): Promise<AgentEval> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const last = await clients.agentEvalQuery.get({ value: id });
    if (until(last)) {
      return last;
    }
    if (Date.now() > deadline) {
      throw new Error(`agent eval ${id} did not reach ${what} within ${timeoutMs} ms; last read: ${describeEval(last)}`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
}

/** The eval once it has ended: completed, partial or failed. */
export function awaitAgentEvalEnd(
  clients: Pick<ConformanceClients, "agentEvalQuery">,
  id: string,
  timeoutMs?: number,
): Promise<AgentEval> {
  return followAgentEval(clients, id, (e) => isFinishedPhase(e.status?.phase), "an end", timeoutMs);
}

/**
 * Cleanup for an eval a test created: cancel it if it may still run, wait
 * for it to end, then delete it (its tries' conversations with it). The
 * agent's delete would refuse while one of its evals runs.
 */
export async function cancelAndDeleteAgentEval(
  clients: Pick<ConformanceClients, "agentEvalQuery" | "agentEvalCommand">,
  id: string,
): Promise<void> {
  const current = await clients.agentEvalQuery.get({ value: id });
  if (isActivePhase(current.status?.phase)) {
    await clients.agentEvalCommand.cancel({ value: id });
    await awaitAgentEvalEnd(clients, id, 60_000);
  }
  await clients.agentEvalCommand.delete({ value: id });
}

/** One try of an agent eval, with where it sits: its plugin, case and target. */
export interface LocatedAgentTry {
  readonly pluginSlug: string;
  readonly caseName: string;
  readonly targetIndex: number;
  readonly attempt: PluginEvalTry;
}

/** Every try of `agentEval`, in its status's order: plugin, case, target, try. */
export function agentEvalTriesOf(agentEval: AgentEval): LocatedAgentTry[] {
  const out: LocatedAgentTry[] = [];
  for (const plugin of agentEval.status?.plugins ?? []) {
    for (const evalCase of plugin.cases) {
      evalCase.targets.forEach((target, targetIndex) => {
        for (const attempt of target.withPlugin?.tries ?? []) {
          out.push({ pluginSlug: plugin.pluginSlug, caseName: evalCase.caseName, targetIndex, attempt });
        }
      });
    }
  }
  return out;
}
