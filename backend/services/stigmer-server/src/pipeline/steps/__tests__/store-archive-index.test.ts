/**
 * StoreArchiveIndex never fails a push: an index already stored is left as
 * it is, one the store cannot read is built again, and one that cannot be
 * written is logged for the first read to build.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { buildZip } from "@stigmer/zip-structure/testing";
import { PushSkillRequestSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/io_pb";
import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { IndexedArchiveStore } from "../../../archive/content-store.js";
import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import { ARTIFACT_BYTES_KEY } from "../resolve-artifact-source.js";
import { newStoreArchiveIndexStep } from "../store-archive-index.js";

function recordingLogger() {
  const lines: string[] = [];
  return { lines, logger: createLogger({ level: "warn", pretty: false, write: (line) => lines.push(line) }) };
}

function storeWith(overrides: Partial<IndexedArchiveStore>): { store: IndexedArchiveStore; stored: string[] } {
  const stored: string[] = [];
  const store = {
    loadIndex: async () => undefined,
    storeIndex: async (hash: string) => {
      stored.push(hash);
    },
    ...overrides,
  } as unknown as IndexedArchiveStore;
  return { store, stored };
}

async function run(store: IndexedArchiveStore, logger = recordingLogger().logger): Promise<void> {
  const archive = buildZip([{ name: "SKILL.md", content: "---\nname: a\n---\nbody" }]);
  const ctx = new RequestContext(PushSkillRequestSchema, create(PushSkillRequestSchema, { org: "acme" }), testCallerIdentity(), ApiResourceKind.skill);
  ctx.set(ARTIFACT_BYTES_KEY, archive);
  const hash = createHash("sha256").update(archive).digest("hex");
  await newStoreArchiveIndexStep<typeof PushSkillRequestSchema>(store, "skill", logger, () => hash).execute(ctx);
}

describe("StoreArchiveIndex", () => {
  it("leaves an index already stored as it is", async () => {
    const { store, stored } = storeWith({ loadIndex: async () => new Uint8Array([1]) });
    await run(store);
    expect(stored).toEqual([]);
  });

  it("builds one the store cannot read, saying so", async () => {
    const { lines, logger } = recordingLogger();
    const { store, stored } = storeWith({ loadIndex: async () => Promise.reject(new Error("EIO")) });
    await run(store, logger);
    expect(stored).toHaveLength(1);
    expect(lines.join("\n")).toContain("could not be read at push; building it again");
  });

  it("logs, never throws, an index it cannot write", async () => {
    const { lines, logger } = recordingLogger();
    const { store } = storeWith({ storeIndex: async () => Promise.reject(new Error("disk full")) });
    await expect(run(store, logger)).resolves.toBeUndefined();
    expect(lines.join("\n")).toContain("could not be stored at push; the first read builds it");
  });
});
