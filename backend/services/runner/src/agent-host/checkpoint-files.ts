/**
 * The open agent host's side of a locked host's saved state: each session's
 * checkpoint file (`shared/workspace/platform-dir.ts` `getCheckpointDbPath`,
 * the file the engine has always used), opened at a relayed turn's first
 * storage call and closed when the runner says the turn has settled, as the
 * engine opens and closes its own saver once per turn (`turn.ts`).
 *
 * The runner names the session and has already held every thread an op
 * names to the turn's own (`remote-adapter.ts`), so this only stores. The
 * file is today's: a conversation saved before keeps its history, sleep and
 * restore see the file they always did, and the runner never writes into the
 * agent's home as root, because this host runs as the agent. SQLite's WAL
 * and busy timeout make a second handle on the file safe
 * (`sqlite-saver.ts`).
 */

import { SqliteCheckpointRows } from "../shared/checkpointer/sqlite-saver.js";
import { serveCheckpointRowsOp, type CheckpointRowsOp, type CheckpointRowsReply } from "../shared/checkpointer/relayed-rows.js";
import { ensureCheckpointDbPath } from "../shared/workspace/platform-dir.js";

export class CheckpointFiles {
  private readonly open = new Map<string, Promise<SqliteCheckpointRows>>();

  /** Run `op` on `sessionId`'s file, opening it first when this turn has not. */
  async serve(sessionId: string, op: CheckpointRowsOp): Promise<CheckpointRowsReply> {
    let file = this.open.get(sessionId);
    if (file === undefined) {
      file = ensureCheckpointDbPath(sessionId).then((path) => new SqliteCheckpointRows(path));
      this.open.set(sessionId, file);
      // A file that could not be opened is not kept: the next call tries again.
      file.catch(() => this.open.delete(sessionId));
    }
    return serveCheckpointRowsOp(await file, op);
  }

  /** Close `sessionId`'s file, if a turn opened it. */
  close(sessionId: string): void {
    const file = this.open.get(sessionId);
    this.open.delete(sessionId);
    void file?.then((rows) => rows.close(), () => undefined);
  }

  closeAll(): void {
    for (const sessionId of [...this.open.keys()]) this.close(sessionId);
  }
}
