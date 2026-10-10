/**
 * The plugin eval kind's shared reads, through the list indexes: a
 * plugin's evals, newest first (listByPlugin, the plugin-delete cascade),
 * and an eval's tries' sessions (its delete), found through the session
 * index's `plugin_eval` key. Every row is re-checked against what it was
 * asked for, whatever the index returned; undecodable rows are skipped and
 * logged, as the evaluator's reads do (domain/evaluator/queries.ts); a
 * store fault is thrown as it came.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import { sessionListIndex } from "../session/list-index.js";
import { PLUGIN_EVAL_LABEL } from "./constants.js";
import { pluginEvalListIndex } from "./list-index.js";

/** Every eval of one plugin, newest first. */
export async function listPluginEvals(
  store: Store,
  logger: Logger,
  pluginId: string,
): Promise<PluginEval[]> {
  const rows = await store.queryResources(pluginEvalListIndex, {
    anyKey: [{ name: "plugin", value: pluginId }],
  });
  const evals: PluginEval[] = [];
  for (const row of rows) {
    try {
      evals.push(fromBinary(PluginEvalSchema, row.data));
    } catch (error) {
      logger.warn("skipped a plugin eval row that does not decode", {
        evalId: row.id,
        pluginId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return evals.filter((pluginEval) => pluginEval.spec?.pluginId === pluginId);
}

/** The ids of an eval's tries' sessions: the sessions carrying its label. */
export async function listTrySessionIds(
  store: Store,
  logger: Logger,
  evalId: string,
): Promise<string[]> {
  const rows = await store.queryResources(sessionListIndex, {
    anyKey: [{ name: "plugin_eval", value: evalId }],
  });
  const ids: string[] = [];
  for (const row of rows) {
    try {
      const session = fromBinary(SessionSchema, row.data);
      if (session.metadata?.labels[PLUGIN_EVAL_LABEL] === evalId) {
        ids.push(row.id);
      }
    } catch (error) {
      logger.warn("skipped a session row that does not decode", {
        sessionId: row.id,
        evalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return ids;
}
