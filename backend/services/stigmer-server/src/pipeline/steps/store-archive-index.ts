/**
 * StoreArchiveIndex: the step after CheckAndStoreArtifact in the skill and
 * plugin push chains, writing the archive's table of contents beside it
 * (`archive/file-index.ts`) so the first read of one of its files costs one
 * ranged storage read (`archive/file-reads.ts`).
 *
 * It never fails a push: an index that cannot be built or stored is
 * logged, and the first read builds it from the archive, as the push
 * already degrades a failed archive of its version. An archive pushed
 * again finds its index stored and writes nothing; one stored before
 * indexes existed gains its index here.
 *
 * Proven by the skill and plugin domains' push tests.
 */
import type { DescMessage } from "@bufbuild/protobuf";

import type { IndexedArchiveStore } from "../../archive/content-store.js";
import type { IndexedArchiveKind } from "../../archive/file-index.js";
import { storeIndexAtPush } from "../../archive/file-reads.js";
import type { Logger } from "../../boot/logger.js";
import type { PipelineStep } from "../pipeline.js";
import type { RequestContext } from "../request-context.js";
import { ARTIFACT_BYTES_KEY } from "./resolve-artifact-source.js";

export function newStoreArchiveIndexStep<Req extends DescMessage>(
  store: IndexedArchiveStore,
  kind: IndexedArchiveKind,
  logger: Logger,
  hashOf: (ctx: RequestContext<Req>) => string,
): PipelineStep<Req> {
  return {
    name: "StoreArchiveIndex",
    async execute(ctx: RequestContext<Req>): Promise<void> {
      const hash = hashOf(ctx);
      try {
        if ((await store.loadIndex(hash)) !== undefined) return;
      } catch (error) {
        logger.warn(`${kind} archive index ${hash} could not be read at push; building it again`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await storeIndexAtPush(store, kind, hash, ctx.get(ARTIFACT_BYTES_KEY) as Uint8Array, logger);
    },
  };
}
