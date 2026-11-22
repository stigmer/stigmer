/**
 * What a turn without a computer sets aside from its context, kept in the
 * runner's artifact storage instead of on a disk the turn does not have:
 * a tool result too long to keep whole (`middleware/tool-truncation.ts`,
 * and deepagents' own eviction) and the summarized conversation each
 * compaction writes (`middleware/compaction.ts`). The engine tells the
 * model where to read each one back, and a later turn may.
 *
 * Not in the conversation's saved state: the cloud's store caps one saved
 * step at 4 MiB, and a single long tool result would end the conversation
 * there. The state keeps only each path's key (the engine's offload route,
 * `execute-deep-agent/computerless-files.ts`); the bytes are here.
 *
 * Keys are content-addressed under the run that wrote them, as the
 * runner's other artifacts are (`status-offload.ts`), with the session in
 * the key: `artifacts/<run>/offloads/<session>/<sha256>`. The artifact
 * lane admits a run's credential for its own run's keys and its session's
 * other runs' (`artifact-storage.ts`); the runner reads only a key that
 * names this turn's session, and checks the bytes it reads against the
 * key's hash.
 */

import { createHash } from "node:crypto";

import type { ArtifactStorage } from "./artifact-storage.js";

/** The largest result set aside: far above what a tool returns, and a bound on what one turn stores. */
export const MAX_OFFLOAD_BYTES = 16 * 1024 * 1024;

/** What the engine's offload route stores and reads results through. */
export interface TurnOffloads {
  /** Store `bytes`; answers the key the route keeps. */
  put(bytes: Uint8Array): Promise<string>;
  /** The bytes under a key this turn's session wrote; {@link OffloadKeyError} for any other key. */
  read(key: string): Promise<Uint8Array>;
}

/** A key that is not one of this session's offloads, or whose bytes do not match it. */
export class OffloadKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffloadKeyError";
  }
}

const KEY_SHAPE = /^artifacts\/[A-Za-z0-9_.-]+\/offloads\/([A-Za-z0-9_.-]+)\/([0-9a-f]{64})$/;

/** The offload store of one turn of `sessionId`, run `executionId`. */
export function newTurnOffloads(storage: ArtifactStorage, executionId: string, sessionId: string): TurnOffloads {
  return {
    async put(bytes) {
      if (bytes.length > MAX_OFFLOAD_BYTES) {
        throw new OffloadKeyError(`the result is ${bytes.length} bytes, over the ${MAX_OFFLOAD_BYTES}-byte bound on what a turn sets aside`);
      }
      const sha = createHash("sha256").update(bytes).digest("hex");
      const key = `artifacts/${executionId}/offloads/${sessionId}/${sha}`;
      await storage.upload(key, Buffer.from(bytes), "text/plain; charset=utf-8");
      return key;
    },
    async read(key) {
      const match = KEY_SHAPE.exec(key);
      if (match === null || match[1] !== sessionId) throw new OffloadKeyError(`'${key}' is not one of this conversation's set-aside results`);
      const bytes = new Uint8Array(await storage.download(key));
      if (createHash("sha256").update(bytes).digest("hex") !== match[2]) {
        throw new OffloadKeyError(`'${key}' does not hold what was set aside under it`);
      }
      return bytes;
    },
  };
}
