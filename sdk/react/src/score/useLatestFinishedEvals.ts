"use client";

/**
 * The latest finished agent eval of each version a view shows, read for
 * the quality report's version table.
 *
 * The evals list pages newest first, and the eval that answers a version
 * may sit on any page, so the hook walks the pages, keeping each version's
 * first finished eval, and stops as soon as every version asked about has
 * one, or the list ends. A version with no finished eval is simply absent.
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
import { create } from "@bufbuild/protobuf";
import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { ListAgentEvalsByAgentRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/io_pb";
import { everyEntry } from "@stigmer/sdk";
import { agentEvalVersionOf } from "../agent-eval/agent-eval-view.js";
import { useStigmer } from "../hooks.js";
import { LIST_PAGE_MAX } from "../internal/everyPage.js";
import { useFetch } from "../internal/useFetch.js";
import { isFinishedEval, latestFinishedEvalByVersion } from "./quality-view.js";

const NONE: ReadonlyMap<string, AgentEval> = new Map();

/**
 * @param agentId  The agent; empty asks nothing.
 * @param versions The version hashes the view shows.
 */
export function useLatestFinishedEvals(
  agentId: string,
  versions: readonly string[],
): ReadonlyMap<string, AgentEval> {
  const stigmer = useStigmer();
  const wanted = versions.join("\n");
  const { data } = useFetch(
    agentId !== "" && versions.length > 0
      ? async () => {
          const missing = new Set(versions);
          const read: AgentEval[] = [];
          for await (const agentEval of everyEntry((pageToken) =>
            stigmer.agenteval.listByAgent(
              create(ListAgentEvalsByAgentRequestSchema, { agentId, pageSize: LIST_PAGE_MAX, pageToken }),
            ),
          )) {
            read.push(agentEval);
            if (isFinishedEval(agentEval)) missing.delete(agentEvalVersionOf(agentEval));
            if (missing.size === 0) break;
          }
          return latestFinishedEvalByVersion(read);
        }
      : null,
    [agentId, wanted, stigmer],
    NONE,
  );
  return data;
}
