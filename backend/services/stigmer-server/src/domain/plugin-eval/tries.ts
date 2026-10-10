/**
 * An eval's tries' conversations, removed with the eval: each through the
 * session domain's own delete (in-process, as the server), which removes
 * its runs and their scores and releases its sandbox, so nothing an eval
 * created outlives it. The tries are found through the session index's
 * `plugin_eval` key, so a try whose session the workflow created but never
 * recorded on the eval is found too.
 *
 * Proven by __tests__/plugin-eval.test.ts (the delete lane and the
 * plugin's cascade).
 */
import { Code, ConnectError } from "@connectrpc/connect";

import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import type { Store } from "../../store/interface.js";
import { listTrySessionIds } from "./queries.js";

/** The session domain's delete, as the eval's delete calls it. */
export interface TrySessionDeleter {
  delete(sessionId: string): Promise<void>;
}

export async function deletePluginEvalTries(
  store: Store,
  sessions: TrySessionDeleter,
  logger: Logger,
  evalId: string,
): Promise<void> {
  let sessionIds: string[];
  try {
    sessionIds = await listTrySessionIds(store, logger, evalId);
  } catch (error) {
    throw internalError(error, "failed to list the plugin eval's tries");
  }
  for (const sessionId of sessionIds) {
    try {
      await sessions.delete(sessionId);
    } catch (error) {
      if (error instanceof ConnectError && error.code === Code.NotFound) {
        continue;
      }
      throw error;
    }
  }
}
